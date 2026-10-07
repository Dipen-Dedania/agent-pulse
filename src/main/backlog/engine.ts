// Backlog Scheduler engine. Mirrors the Cowork Scheduler's lifecycle
// (constructor → init → start/stop/applyConfig/getStatus + broadcast) but
// schedules window EDGES instead of fire instants: a single unref'd timer is
// armed for the next window start or the current window's end, and inside a
// window the loop is completion-driven — each settled card immediately tries
// to claim the next one. See backlog.md (Phase 1).

import fs from 'fs';
import path from 'path';
import { BrowserWindow, powerMonitor } from 'electron';
import { logger } from '../../common/logger';
import {
  BACKLOG_AGENTS,
  BacklogAgent,
  BacklogArtifactKind,
  BacklogAttemptOutcome,
  BacklogCard,
  BacklogSchedulerConfig,
  BacklogSchedulerStatus,
  agentLabel,
  countUnmetPrereqs,
} from '../../common/backlog-types';
import { BacklogStore } from './store';
import { activeWindow, nextWindowStart, pickNextCard, cardBudgetMs, forecastNextWindow, isPickableState } from './timing';
import { buildExecutionPrompt, buildQaPrompt, buildResearchPrompt } from './prompt';
import { executeCard, RunnerHandle, RunnerResult } from './runner';
import { adapterFor } from './agents';
import { captureDiff, createWorktree, reconcileWorktrees, unwindCommits } from './worktree';
import { runQa } from './qa';
import { ensureCodexQaProfile } from './codex-qa-profile';
import { sendWebhook } from '../notifications/webhook';

// Grace period a still-running card gets after its window closes.
const GRACE_MS = 10 * 60_000;
// requireIdle gate: minimum seconds without keyboard/mouse input.
const IDLE_REQUIRED_SECONDS = 5 * 60;
// How often to re-check idleness while waiting inside a window.
const IDLE_RECHECK_MS = 60_000;
// A card whose runs keep exceeding the time budget would otherwise cycle
// paused → re-picked first → killed again, silently burning credit every
// window. After this many back-to-back budget kills it escalates to Blocked.
const MAX_CONSECUTIVE_BUDGET_KILLS = 2;
// Same shape for QA: one bounded auto-retry via Rework, then Blocked.
const MAX_CONSECUTIVE_QA_FAILS = 2;
const ARTIFACT_PREVIEW_CHARS = 500;
// Proactive usage gate default (used only if a config somehow lacks the field).
// The live threshold is user-configurable via config.usageGatePercent.
const USAGE_GATE_UTILIZATION_DEFAULT = 95;
// When the usage snapshot can't say when the window resets, re-check on this cadence.
const USAGE_RECHECK_FALLBACK_MS = 30 * 60_000;
// Screenshot evidence a QA card's browser saved (take_screenshot filePath) —
// swept into artifacts after the run.
const SCREENSHOT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

/**
 * First human-meaningful line of a report, for the attempt's one-line `reason`.
 * Skips blank lines, markdown heading hashes / bold, and the STATUS marker so
 * the reason reads as the agent's own opening sentence.
 */
function firstReportLine(report: string | undefined): string | null {
  if (!report) return null;
  for (const raw of report.split(/\r?\n/)) {
    const line = raw.trim().replace(/^#+\s*/, '').replace(/^\*\*|\*\*$/g, '');
    if (!line) continue;
    if (/^STATUS:\s*(completed|partial|blocked)\b/i.test(line)) continue;
    return line.slice(0, 200);
  }
  return null;
}

export interface UsageWindowSnapshot {
  utilization: number;
  resetsAt: number;
}

export interface BacklogEngineDeps {
  store: BacklogStore;
  /** Ask the agent's usage poller to re-poll (a run just spent window credit). */
  refreshUsage: (agent: BacklogAgent) => void;
  artifactsDir: string;  // userData/backlog-artifacts
  worktreesDir: string;  // userData/backlog-worktrees
  /**
   * The agent's CURRENT usage window (Claude 5-hour / Codex primary) for the
   * proactive gate and the latch; null = unknown (no gating).
   */
  getUsage?: (agent: BacklogAgent) => UsageWindowSnapshot | null;
  /** Injectable for tests; defaults to Electron's powerMonitor. */
  getIdleSeconds?: () => number;
  /**
   * A card just reached `done` under the engine. Observational only (the
   * GitHub star nudge's "first backlog card" milestone listens here); must
   * never throw into the run path.
   */
  onCardDone?: (card: BacklogCard) => void;
}

interface RunningCard {
  cardId: string;
  cardTitle: string;
  agent: BacklogAgent;
  attemptId: string;
  startedAt: number;
  handle: RunnerHandle;
}

export class BacklogEngine {
  private config: BacklogSchedulerConfig;
  private readonly store: BacklogStore;
  private readonly refreshUsage: (agent: BacklogAgent) => void;
  private readonly artifactsDir: string;
  private readonly worktreesDir: string;
  private readonly getUsage: (agent: BacklogAgent) => UsageWindowSnapshot | null;
  private readonly getIdleSeconds: () => number;
  private readonly onCardDone: ((card: BacklogCard) => void) | null;

  private edgeTimer: NodeJS.Timeout | null = null;   // next window start/end
  private graceTimer: NodeJS.Timeout | null = null;  // window-end grace kill
  private idleTimer: NodeJS.Timeout | null = null;   // requireIdle recheck
  // Usage-latch expiry rechecks, one per latched agent.
  private usageTimers = new Map<BacklogAgent, NodeJS.Timeout>();
  private running: RunningCard | null = null;
  // Guards the async gap in runCard (worktree creation) — `running` is only
  // set after the spawn, so without this two claims could interleave.
  private claiming = false;
  // Cards the user stopped mid-window. Paused cards are picked FIRST, so
  // without this a just-stopped card would be re-claimed immediately by the
  // next tryClaimNext. Cleared at window end; manual Run-now ignores it.
  private stoppedThisWindow = new Set<string>();
  private waitingForIdle = false;
  // Usage latches, per agent: a run died on (or the snapshot shows) that
  // agent's exhausted usage window — none of ITS cards auto-claim until the
  // timestamp. Independent per agent, so an exhausted Codex window never
  // blocks Claude cards (or vice versa). Manual Run-now bypasses.
  private usageExhaustedUntil = new Map<BacklogAgent, number>();
  private lastRun: BacklogSchedulerStatus['lastRun'] = null;
  private stopped = true;

  constructor(config: BacklogSchedulerConfig, deps: BacklogEngineDeps) {
    this.config = config;
    this.store = deps.store;
    this.refreshUsage = deps.refreshUsage;
    this.artifactsDir = deps.artifactsDir;
    this.worktreesDir = deps.worktreesDir;
    this.getUsage = deps.getUsage ?? (() => null);
    this.getIdleSeconds = deps.getIdleSeconds ?? (() => powerMonitor.getSystemIdleTime());
    this.onCardDone = deps.onCardDone ?? null;
  }

  public start() {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info(`[Backlog] engine starting, enabled=${this.config.enabled}, slots=${this.config.slots.length}`);
    // Crash cleanup: worktree dirs no card references anymore (crash between
    // create and card update, or cards deleted while the app was closed).
    const referenced = new Set(
      this.store.listCards().map((c) => c.worktreePath).filter((p): p is string => !!p),
    );
    void reconcileWorktrees(this.worktreesDir, referenced, this.store.listProjects().map((p) => p.path))
      .catch((e) => logger.warn('[Backlog] worktree reconciliation failed:', e?.message ?? e));
    this.reschedule();
  }

  /**
   * Stop the engine. Kills a running card (recorded as paused — same as a
   * crash recovery would); the store writes are synchronous so the card's
   * final state lands before the app quits.
   */
  public stop() {
    logger.info('[Backlog] engine stopping');
    this.stopped = true;
    this.clearTimers();
    if (this.running) {
      const { cardId, attemptId, handle } = this.running;
      this.running = null;
      // Blocking kill: before-quit is synchronous, so an async taskkill could
      // be abandoned mid-flight and orphan the CLI subtree.
      handle.killSync('app quitting');
      this.store.finishAttempt(attemptId, { outcome: 'paused', reason: 'app quit while running' });
      this.store.setCardState(cardId, 'paused');
    }
  }

  public applyConfig(config: BacklogSchedulerConfig) {
    this.config = config;
    if (!this.stopped) this.reschedule();
    else this.broadcast();
  }

  public getStatus(): BacklogSchedulerStatus {
    return this.computeStatus();
  }

  /**
   * True while a card is executing — the Cowork scheduler skips its opener
   * ping then (the run already spends and anchors that agent's window). With
   * `agent` set, only a card of THAT agent counts: a Codex card running must
   * not suppress the Claude opener, and vice versa.
   */
  public isRunningCard(agent?: BacklogAgent): boolean {
    if (!this.running) return false;
    return agent === undefined || this.running.agent === agent;
  }

  /**
   * Manual "Run now": any tier, any time (no window required; bypasses the
   * usage latch — the user is explicitly spending). The card must be in
   * Todo, Paused, or Rework — the atomic claim enforces that.
   */
  public runNow(cardId: string): Promise<{ ok: boolean; reason?: string }> {
    if (this.stopped) return Promise.resolve({ ok: false, reason: 'engine is not running' });
    if (this.running || this.claiming) {
      return Promise.resolve({ ok: false, reason: `"${this.running?.cardTitle ?? 'another card'}" is already running — one card at a time` });
    }
    const card = this.store.getCard(cardId);
    if (!card) return Promise.resolve({ ok: false, reason: 'card not found' });
    // Blocked is manual-run-only: a human just addressed the blocker and wants
    // an immediate retry. It stays out of PICKABLE_RANK so autorun never
    // claims a card that needs attention.
    if (!isPickableState(card.state) && card.state !== 'blocked') {
      return Promise.resolve({ ok: false, reason: 'only Todo, Paused, Rework, or Blocked cards can be run — move it to Todo first' });
    }
    return this.runCard(card, /*manual*/ true);
  }

  /**
   * User-initiated stop of the running card. The kill flows through the
   * runner's close handler, so the normal finalization path records the
   * attempt as paused and lands the card in Paused (re-runnable).
   */
  public stopCurrent(): { ok: boolean; reason?: string } {
    if (!this.running) return { ok: false, reason: 'no card is running' };
    logger.info(`[Backlog] user stopped "${this.running.cardTitle}"`);
    this.stoppedThisWindow.add(this.running.cardId);
    this.running.handle.kill('stopped by user', 'paused');
    return { ok: true };
  }

  /** Board data changed (card created/moved/reordered) — re-evaluate the queue. */
  public onQueueChanged() {
    if (this.stopped) return;
    this.broadcast();
    this.tryClaimNext();
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /** Recompute where we are relative to the slots and arm the edge timer. */
  private reschedule() {
    if (this.stopped) return;
    this.clearEdgeTimer();

    if (!this.config.enabled) {
      this.broadcast();
      return;
    }

    const now = Date.now();
    const win = activeWindow(this.config.slots, now);
    if (win) {
      // Inside a window: arm the end edge, then try to work.
      this.armEdgeTimer(win.end - now, () => this.onWindowEnd());
      this.broadcast();
      this.tryClaimNext();
    } else {
      const startAt = nextWindowStart(this.config.slots, now);
      if (startAt !== null) {
        this.armEdgeTimer(startAt - now, () => this.reschedule());
        logger.info(`[Backlog] next window opens in ${Math.round((startAt - now) / 1000)}s`);
      }
      this.broadcast();
    }
  }

  /** Claim and run the next fitting card, honoring the idle and usage gates. */
  private tryClaimNext() {
    if (this.stopped || !this.config.enabled || this.running || this.claiming) return;
    const now = Date.now();
    const win = activeWindow(this.config.slots, now);
    if (!win) return;

    if (this.config.requireIdle && this.getIdleSeconds() < IDLE_REQUIRED_SECONDS) {
      if (!this.waitingForIdle) {
        this.waitingForIdle = true;
        logger.info('[Backlog] window open but user is active — waiting for idle');
      }
      this.broadcast();
      this.armIdleTimer();
      return;
    }
    this.waitingForIdle = false;

    // Per-agent usage gates. An agent is unavailable this pass when (a) its
    // latch is still armed — a previous run died on an exhausted window — or
    // (b) the proactive gate trips: its window is already at/above the
    // threshold, so a card started now would just be killed mid-task. The
    // threshold is user-configurable and shared; 100 disables it (only the
    // reactive latch stops runs once a window is truly spent). Cards of a
    // latched agent are skipped; the other agent's cards still run.
    const gatePercent = this.config.usageGatePercent ?? USAGE_GATE_UTILIZATION_DEFAULT;
    const latched = new Set<BacklogAgent>();
    for (const agent of BACKLOG_AGENTS) {
      const until = this.usageExhaustedUntil.get(agent);
      if (until !== undefined) {
        if (now < until) { latched.add(agent); continue; }
        this.usageExhaustedUntil.delete(agent);
      }
      const usage = this.getUsage(agent);
      if (usage && usage.utilization >= gatePercent) {
        this.engageUsageLatch(agent, `${agentLabel(agent)} window at ${Math.round(usage.utilization)}% (limit ${gatePercent}%) — waiting for reset`);
        latched.add(agent);
      }
    }

    const candidates = this.store.listCards().filter((c) => !this.stoppedThisWindow.has(c.id));
    const card = pickNextCard(candidates, win.end - now, latched);
    if (!card) {
      this.broadcast();
      return;
    }
    void this.runCard(card, /*manual*/ false).then((res) => {
      if (!res.ok) logger.warn(`[Backlog] failed to start "${card.title}": ${res.reason}`);
    });
  }

  /**
   * Stop auto-claiming THAT agent's cards until its usage window resets (plus
   * a small buffer so the poller has re-polled by the time we retry). Falls
   * back to a periodic recheck when the snapshot can't say when that is.
   */
  private engageUsageLatch(agent: BacklogAgent, logReason: string) {
    const now = Date.now();
    const usage = this.getUsage(agent);
    const until = usage && usage.resetsAt > now ? usage.resetsAt + 60_000 : now + USAGE_RECHECK_FALLBACK_MS;
    this.usageExhaustedUntil.set(agent, until);
    logger.info(`[Backlog] ${agent} usage latch engaged (${logReason}) — resuming ${new Date(until).toLocaleTimeString()}`);
    this.refreshUsage(agent);
    const prior = this.usageTimers.get(agent);
    if (prior) clearTimeout(prior);
    const timer = setTimeout(() => {
      this.usageTimers.delete(agent);
      this.usageExhaustedUntil.delete(agent);
      this.tryClaimNext();
    }, until - now);
    timer.unref?.();
    this.usageTimers.set(agent, timer);
    this.broadcast();
  }

  /** Claim → (worktree) → spawn → track. Shared by the window loop and manual Run-now. */
  private async runCard(card: BacklogCard, manual: boolean): Promise<{ ok: boolean; reason?: string }> {
    if (this.claiming || this.running) return { ok: false, reason: 'another card is already starting or running' };
    this.claiming = true;
    try {
      if (!this.store.claimCard(card.id)) {
        return { ok: false, reason: 'card was already claimed or moved' };
      }
      const project = this.store.listProjects().find((p) => p.id === card.projectId);
      if (!project) {
        this.store.setCardState(card.id, 'blocked', 'project no longer registered');
        this.broadcastChanged();
        return { ok: false, reason: 'project no longer registered' };
      }

      let cwd = project.path;
      let resumeSessionId: string | null = null;
      if (card.taskType === 'execution') {
        const wt = await createWorktree(project.path, this.worktreesDir, card.id);
        if (!wt.ok) {
          this.store.setCardState(card.id, 'blocked', wt.reason);
          this.broadcastChanged();
          return { ok: false, reason: wt.reason };
        }
        this.store.setWorktree(card.id, wt.worktreePath, wt.baseSha);
        cwd = wt.worktreePath;
        if (wt.reused) {
          // Resume ONLY a conversation that is worth continuing: a QA rework
          // (the work landed, the gate failed) or a usage-limit pause (cut off
          // mid-task). A run that CONCLUDED — blocked / no-changes / failed —
          // must start fresh instead: resuming replays the old "can't proceed"
          // context, and the resume path never delivers the rebuilt prompt
          // (with updated description/attachments) — the continuation constant
          // goes on argv and stdin stays closed. Picking "any attempt with a
          // session id" used to resurrect stale sessions from before an
          // intermediate failure for exactly that losing trade.
          const lastFinished = this.store.listAttempts(card.id).find((a) => a.outcome !== null);
          if (lastFinished?.sessionId && (lastFinished.outcome === 'qa-failed' || lastFinished.outcome === 'paused')) {
            resumeSessionId = lastFinished.sessionId;
          }
        }
      }

      const attempt = this.store.insertAttempt(card.id, manual);
      this.store.setCardState(card.id, 'in-progress');
      // Inline any attached files into the prompt so the card can carry context
      // that isn't in the repo (the detached worktree only sees committed files).
      const attachments = this.store.listAttachmentContents(card.id);
      const adapter = adapterFor(card.agent);
      let mcpConfigPath: string | null = null;
      let qaProfile: string | null = null;
      let prompt: string;
      if (card.taskType === 'execution') {
        prompt = buildExecutionPrompt(card, attachments);
      } else if (card.taskType === 'qa') {
        // Browser-verification run: the agent needs the chrome-devtools MCP
        // server (Claude: --mcp-config file; Codex: a config profile) and a
        // place the MCP server can save screenshot evidence.
        let screensDir: string;
        try {
          screensDir = this.screenshotsDir(card.id, attempt.id);
          fs.mkdirSync(screensDir, { recursive: true });
          if (card.agent === 'codex') qaProfile = ensureCodexQaProfile();
          else mcpConfigPath = this.ensureQaMcpConfig();
        } catch (e: any) {
          const reason = `QA setup failed: ${e?.message ?? e}`;
          this.store.finishAttempt(attempt.id, { outcome: 'failed', reason });
          this.store.setCardState(card.id, 'blocked', reason);
          this.broadcastChanged();
          return { ok: false, reason };
        }
        prompt = buildQaPrompt(card, screensDir, attachments);
      } else {
        prompt = buildResearchPrompt(card, attachments);
      }
      // Codex writes its last message to a side file (engine-controlled path
      // under the artifacts dir); Claude ignores it.
      let outputFile: string | null = null;
      if (card.agent === 'codex') {
        try {
          const dir = path.join(this.artifactsDir, card.id);
          fs.mkdirSync(dir, { recursive: true });
          outputFile = path.join(dir, `${attempt.id}-codex-last.md`);
        } catch (e: any) {
          const reason = `artifact dir setup failed: ${e?.message ?? e}`;
          this.store.finishAttempt(attempt.id, { outcome: 'failed', reason });
          this.store.setCardState(card.id, 'blocked', reason);
          this.broadcastChanged();
          return { ok: false, reason };
        }
      }
      const handle = executeCard({
        adapter, prompt, cwd, budgetMs: cardBudgetMs(card),
        taskType: card.taskType, model: card.model, resumeSessionId, mcpConfigPath, qaProfile, outputFile,
      });
      this.running = {
        cardId: card.id,
        cardTitle: card.title,
        agent: card.agent,
        attemptId: attempt.id,
        startedAt: attempt.startedAt,
        handle,
      };
      logger.info(`[Backlog] running "${card.title}" (${card.taskType}, ${card.agent}, ${manual ? 'manual' : 'scheduled'}${resumeSessionId ? ', resumed' : ''}) in ${cwd}`);
      this.broadcast();
      this.broadcastChanged();

      void handle.promise.then(async (result) => {
        // stop() may have already finalized the rows and cleared `running`.
        if (this.running?.attemptId !== attempt.id) return;
        this.running = null;
        this.clearGraceTimer();

        let outcome: BacklogAttemptOutcome;
        let reason = result.reason ?? null;
        if (result.outcome === 'success') {
          const finalized = await this.finalizeSuccess(card, attempt.id, cwd, result);
          outcome = finalized.outcome;
          reason = finalized.reason ?? reason;
        } else if (result.outcome === 'killed') {
          outcome = result.killOutcome ?? 'killed';
          // 'killed' = budget overrun; user stops / window-end grace record
          // 'paused' and never escalate. The current attempt isn't finished yet,
          // so +1 accounts for it.
          if (outcome === 'killed' && this.store.countConsecutiveKills(card.id) + 1 >= MAX_CONSECUTIVE_BUDGET_KILLS) {
            this.store.setCardState(
              card.id, 'blocked',
              `time budget exceeded in ${MAX_CONSECUTIVE_BUDGET_KILLS} consecutive runs — raise the estimate or split the card`,
            );
          } else {
            this.store.setCardState(card.id, 'paused');
          }
        } else if (result.usageLimit) {
          // The usage window is exhausted — not the card's fault. Recorded as
          // 'paused' (like a window-end grace kill) so it can't trip either
          // escalation streak, and picked first once the latch clears.
          outcome = 'paused';
          this.store.setCardState(card.id, 'paused');
          this.engageUsageLatch(card.agent, reason ?? 'usage limit reached');
        } else {
          outcome = 'failed';
          this.store.setCardState(card.id, 'blocked', reason ?? 'run failed');
        }

        this.store.finishAttempt(attempt.id, {
          outcome,
          reason,
          costUsd: result.costUsd,
          numTurns: result.numTurns,
          sessionId: result.sessionId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
        this.lastRun = { at: Date.now(), cardId: card.id, cardTitle: card.title, outcome };
        logger.info(`[Backlog] "${card.title}" finished: ${outcome}${reason ? ` (${reason})` : ''}`);

        // Ping configured webhooks once the card has settled. Fire-and-forget:
        // the state is already committed, so a slow/failing POST never blocks
        // finishing the attempt or claiming the next card.
        void this.notifyOutcome(card, reason);

        // The run spent real window credit — refresh that agent's usage promptly.
        this.refreshUsage(card.agent);
        this.broadcast();
        this.broadcastChanged();
        this.tryClaimNext();
      });

      return { ok: true };
    } finally {
      this.claiming = false;
    }
  }

  /**
   * Successful run → artifacts → final state. Research: report → Done.
   * Execution: summary report + captured diff, then QA — pass/skip → Done,
   * fail → qa-report + Rework (Blocked after MAX_CONSECUTIVE_QA_FAILS).
   */
  private async finalizeSuccess(
    card: BacklogCard,
    attemptId: string,
    cwd: string,
    result: RunnerResult,
  ): Promise<{ outcome: BacklogAttemptOutcome; reason?: string }> {
    try {
      const reportPath = this.writeArtifactFile(card.id, attemptId, 'report', result.report!);
      this.store.insertArtifact({
        cardId: card.id, attemptId, kind: 'report',
        path: reportPath, preview: result.report!.slice(0, ARTIFACT_PREVIEW_CHARS),
      });
    } catch (e: any) {
      // Report write failed — don't lose the run silently.
      const reason = `report write failed: ${e?.message ?? e}`;
      this.store.setCardState(card.id, 'blocked', reason);
      return { outcome: 'failed', reason };
    }

    // The CLI exiting cleanly with a final message is NOT the same as the task
    // being done. Honor the executor's self-reported STATUS (prompt.ts) and,
    // for execution cards, the deterministic empty-diff check, so a "couldn't
    // proceed" or a no-op never silently lands the card in Done.
    const selfStatus = result.selfStatus ?? null;
    const blockedLike = selfStatus === 'blocked';

    if (card.taskType !== 'execution') {
      // QA cards: register whatever evidence the browser saved — even a
      // blocked run may have captured the failure it saw.
      if (card.taskType === 'qa') this.sweepScreenshots(card.id, attemptId);
      if (blockedLike) {
        const reason = firstReportLine(result.report) ?? 'agent reported it was blocked';
        this.store.setCardState(card.id, 'blocked', reason);
        return { outcome: 'blocked', reason };
      }
      this.markDone(card);
      return { outcome: 'success', reason: selfStatus === 'partial' ? 'agent reported partial completion' : undefined };
    }

    // Execution: the dirty worktree is the deliverable — capture it as a patch.
    // First fold any commit the agent made (against the contract) back into
    // the working tree: Claude has no shell so can't commit, but Codex always
    // has one and the sandbox is the only thing stopping it. Without this a
    // committed change would be invisible to the diff and read as no-changes.
    if (card.baseSha) {
      const unwound = await unwindCommits(cwd, card.baseSha);
      if (!unwound.ok) {
        const reason = `could not unwind agent commits: ${unwound.reason}`;
        this.store.setCardState(card.id, 'blocked', reason);
        return { outcome: 'failed', reason };
      }
      if (unwound.unwound > 0) logger.warn(`[Backlog] "${card.title}": agent made ${unwound.unwound} commit(s) — folded back into the working tree`);
    }
    const cap = await captureDiff(cwd);
    if (!cap.ok) {
      const reason = `diff capture failed: ${cap.reason}`;
      this.store.setCardState(card.id, 'blocked', reason);
      return { outcome: 'failed', reason };
    }
    try {
      const patchBody = cap.diff.truncated
        ? `${cap.diff.patch}\n\n# PATCH TRUNCATED — review the worktree directly`
        : cap.diff.patch;
      const diffPath = this.writeArtifactFile(card.id, attemptId, 'diff', patchBody);
      this.store.insertArtifact({
        cardId: card.id, attemptId, kind: 'diff',
        path: diffPath,
        preview: cap.diff.statusSummary.slice(0, ARTIFACT_PREVIEW_CHARS) || '(no changes)',
      });
    } catch (e: any) {
      const reason = `diff write failed: ${e?.message ?? e}`;
      this.store.setCardState(card.id, 'blocked', reason);
      return { outcome: 'failed', reason };
    }

    // An execution card whose worktree is empty delivered nothing — this is the
    // exact case that used to read as a green "success" with a +0/−0 diff. Never
    // mark it Done; surface it for a human with the agent's own explanation.
    const hasChanges = cap.diff.statusSummary.trim().length > 0;
    if (!hasChanges) {
      const reason = blockedLike
        ? (firstReportLine(result.report) ?? 'agent reported it was blocked and made no changes')
        : 'run finished but produced no file changes — see the summary';
      this.store.setCardState(card.id, 'blocked', reason);
      return { outcome: 'no-changes', reason };
    }
    if (blockedLike) {
      const reason = firstReportLine(result.report) ?? 'agent reported it was blocked';
      this.store.setCardState(card.id, 'blocked', reason);
      return { outcome: 'blocked', reason };
    }

    const qa = await runQa(card, cwd);
    if (qa.verdict !== 'skipped') {
      try {
        const qaBody = `# QA: ${qa.verdict.toUpperCase()}\ncommand: ${qa.command}\nexit code: ${qa.exitCode ?? 'n/a'}\n\n${qa.output}`;
        const qaPath = this.writeArtifactFile(card.id, attemptId, 'qa-report', qaBody);
        this.store.insertArtifact({
          cardId: card.id, attemptId, kind: 'qa-report',
          path: qaPath, preview: qaBody.slice(0, ARTIFACT_PREVIEW_CHARS),
        });
      } catch (e: any) {
        logger.warn(`[Backlog] qa-report write failed: ${e?.message ?? e}`);
      }
    }
    if (qa.verdict === 'failed') {
      // The current attempt isn't finished yet, so +1 accounts for it.
      if (this.store.countConsecutiveQaFails(card.id) + 1 >= MAX_CONSECUTIVE_QA_FAILS) {
        this.store.setCardState(
          card.id, 'blocked',
          `QA failed in ${MAX_CONSECUTIVE_QA_FAILS} consecutive runs (${qa.command}) — review the QA report`,
        );
      } else {
        this.store.setCardState(card.id, 'rework');
      }
      return { outcome: 'qa-failed', reason: `QA failed: ${qa.command} (exit ${qa.exitCode ?? 'n/a'})` };
    }

    this.markDone(card);
    return { outcome: 'success', reason: selfStatus === 'partial' ? 'agent reported partial completion' : undefined };
  }

  /** Persist `done` and tell observers; an observer error never fails the run. */
  private markDone(card: BacklogCard): void {
    this.store.setCardState(card.id, 'done');
    try {
      this.onCardDone?.(card);
    } catch (err) {
      logger.warn('[BacklogEngine] onCardDone observer threw', err);
    }
  }

  /**
   * POST a Discord/Slack ping for a card that reached a terminal state the user
   * cares about. Reads the card's FINAL state from the store (not the attempt
   * outcome) so the killed→blocked and qa-failed→rework escalations classify
   * correctly. Paused / usage-limit outcomes auto-resume and are intentionally
   * silent. Fire-and-forget: sendWebhook swallows its own network errors.
   */
  private async notifyOutcome(card: BacklogCard, reason: string | null): Promise<void> {
    const targets = (this.config.webhooks ?? []).filter((t) => t.enabled && t.url.trim().length > 0);
    if (targets.length === 0) return;

    const state = this.store.getCard(card.id)?.state ?? null;
    if (state !== 'done' && state !== 'blocked' && state !== 'rework') return;

    const meta =
      state === 'done'
        ? { emoji: '✅', verb: 'completed', color: 0x22c55e }
        : state === 'rework'
          ? { emoji: '🔁', verb: 'needs rework', color: 0xf59e0b }
          : { emoji: '⛔', verb: 'blocked', color: 0xef4444 };

    const project = this.store.listProjects().find((p) => p.id === card.projectId);
    const bodyLines = [
      project ? `Project: ${project.name}` : null,
      `Type: ${card.taskType} · Agent: ${agentLabel(card.agent)}`,
      reason ? `Detail: ${reason}` : null,
    ].filter((l): l is string => l !== null);

    const message = {
      title: `${meta.emoji} Backlog task ${meta.verb}: ${card.title}`,
      body: bodyLines.join('\n'),
      accentColor: meta.color,
    };

    await Promise.all(
      targets.map((t) =>
        sendWebhook(t, message).catch((e) =>
          logger.warn(`[Backlog] webhook notify failed: ${e?.message ?? e}`),
        ),
      ),
    );
  }

  /** Window closed: no new claims; a running card gets a grace period. */
  private onWindowEnd() {
    this.clearEdgeTimer();
    this.stoppedThisWindow.clear(); // user stops only suppress auto-resume within their window
    if (this.running) {
      logger.info(`[Backlog] window ended with "${this.running.cardTitle}" running — ${GRACE_MS / 60_000}min grace`);
      this.clearGraceTimer();
      this.graceTimer = setTimeout(() => {
        this.graceTimer = null;
        this.running?.handle.kill('window ended (grace period expired)', 'paused');
      }, GRACE_MS);
      this.graceTimer.unref?.();
    }
    this.reschedule(); // arms the next window-start edge and broadcasts
  }

  /** Where a QA attempt's browser saves screenshot evidence (given in the prompt). */
  private screenshotsDir(cardId: string, attemptId: string): string {
    return path.join(this.artifactsDir, cardId, `${attemptId}-screens`);
  }

  /**
   * Write (idempotently) the MCP config a QA run's `--mcp-config` points at:
   * chrome-devtools-mcp, headless (no visible window) and isolated (throwaway
   * Chrome profile — no user cookies/sessions, no profile-lock collisions).
   * Lives beside the artifacts dir under userData. npx is a .cmd shim on
   * Windows, so the config routes through cmd /c there — same class of problem
   * the runner solves for the CLI bin itself. Claude only; the Codex
   * equivalent is a config profile (see codex-qa-profile.ts).
   */
  private ensureQaMcpConfig(): string {
    const configPath = path.join(path.dirname(this.artifactsDir), 'backlog-qa-mcp.json');
    const serverArgs = ['-y', 'chrome-devtools-mcp@latest', '--headless', '--isolated'];
    const config = {
      mcpServers: {
        'chrome-devtools': process.platform === 'win32'
          ? { command: 'cmd', args: ['/c', 'npx', ...serverArgs] }
          : { command: 'npx', args: serverArgs },
      },
    };
    const body = JSON.stringify(config, null, 2);
    // Rewrite only on drift so the file stays user-inspectable but self-heals.
    try {
      if (fs.readFileSync(configPath, 'utf8') === body) return configPath;
    } catch { /* missing or unreadable — write it */ }
    fs.writeFileSync(configPath, body, 'utf8');
    return configPath;
  }

  /** Register the screenshot files a QA run saved as `screenshot` artifacts. */
  private sweepScreenshots(cardId: string, attemptId: string): void {
    const dir = this.screenshotsDir(cardId, attemptId);
    try {
      const files = fs.readdirSync(dir)
        .filter((f) => SCREENSHOT_EXTENSIONS.has(path.extname(f).toLowerCase()))
        .sort();
      for (const file of files) {
        this.store.insertArtifact({
          cardId, attemptId, kind: 'screenshot',
          path: path.join(dir, file), preview: file,
        });
      }
      if (files.length > 0) logger.info(`[Backlog] registered ${files.length} QA screenshot(s) for card ${cardId}`);
    } catch (e: any) {
      logger.warn(`[Backlog] screenshot sweep failed: ${e?.message ?? e}`);
    }
  }

  private writeArtifactFile(cardId: string, attemptId: string, kind: BacklogArtifactKind, content: string): string {
    const dir = path.join(this.artifactsDir, cardId);
    fs.mkdirSync(dir, { recursive: true });
    const ext = kind === 'diff' ? 'patch' : kind === 'qa-report' ? 'qa.txt' : 'md';
    const filePath = path.join(dir, `${attemptId}.${ext}`);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  }

  private computeStatus(): BacklogSchedulerStatus {
    const now = Date.now();
    const win = this.config.enabled ? activeWindow(this.config.slots, now) : null;
    const cards = this.store.listCards();
    return {
      enabled: this.config.enabled,
      windowActive: win !== null,
      windowEndsAt: win?.end ?? null,
      nextWindowStartAt: this.config.enabled ? nextWindowStart(this.config.slots, now) : null,
      runningCardId: this.running?.cardId ?? null,
      runningCardTitle: this.running?.cardTitle ?? null,
      runningAttemptStartedAt: this.running?.startedAt ?? null,
      waitingForIdle: this.waitingForIdle,
      // Runnable = what the picker would actually consider: green
      // todo/paused/rework with all prereqs done. Prereq-gated cards aren't "ready".
      queueReady: cards.filter((c) =>
        isPickableState(c.state) &&
        c.riskTier === 'green' &&
        countUnmetPrereqs(c, cards) === 0).length,
      usagePausedUntil: {
        claude: this.usageExhaustedUntil.get('claude') ?? null,
        codex: this.usageExhaustedUntil.get('codex') ?? null,
      },
      lastRun: this.lastRun,
      forecast: this.config.enabled ? forecastNextWindow(cards, this.config.slots, now) : null,
    };
  }

  private armEdgeTimer(delayMs: number, fn: () => void) {
    this.clearEdgeTimer();
    this.edgeTimer = setTimeout(() => {
      this.edgeTimer = null;
      fn();
    }, Math.max(0, delayMs));
    this.edgeTimer.unref?.();
  }

  private armIdleTimer() {
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.tryClaimNext();
    }, IDLE_RECHECK_MS);
    this.idleTimer.unref?.();
  }

  private clearEdgeTimer() {
    if (this.edgeTimer) { clearTimeout(this.edgeTimer); this.edgeTimer = null; }
  }

  private clearGraceTimer() {
    if (this.graceTimer) { clearTimeout(this.graceTimer); this.graceTimer = null; }
  }

  private clearTimers() {
    this.clearEdgeTimer();
    this.clearGraceTimer();
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    for (const timer of this.usageTimers.values()) clearTimeout(timer);
    this.usageTimers.clear();
  }

  private broadcast() {
    const status = this.computeStatus();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('backlog:status-updated', status);
    }
  }

  /** Board data (cards/attempts/artifacts) changed — tell all windows to re-sync. */
  private broadcastChanged() {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('backlog:changed', {});
    }
  }
}

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
  BacklogArtifactKind,
  BacklogAttemptOutcome,
  BacklogCard,
  BacklogSchedulerConfig,
  BacklogSchedulerStatus,
  countUnmetPrereqs,
} from '../../common/backlog-types';
import { BacklogStore } from './store';
import { activeWindow, nextWindowStart, pickNextCard, cardBudgetMs, forecastNextWindow, isPickableState } from './timing';
import { buildExecutionPrompt, buildResearchPrompt } from './prompt';
import { executeCard, RunnerHandle, RunnerResult } from './runner';
import { captureDiff, createWorktree, reconcileWorktrees } from './worktree';
import { runQa } from './qa';

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
// Proactive usage gate: don't claim a card when the 5-hour window is already
// nearly spent — the run would die mid-task.
const USAGE_GATE_UTILIZATION = 95;
// When the usage snapshot can't say when the window resets, re-check on this cadence.
const USAGE_RECHECK_FALLBACK_MS = 30 * 60_000;

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

export interface BacklogEngineDeps {
  store: BacklogStore;
  usagePoller: { refreshNow: () => void };
  artifactsDir: string;  // userData/backlog-artifacts
  worktreesDir: string;  // userData/backlog-worktrees
  /** Claude 5-hour window snapshot for the usage latch; null = unknown. */
  getUsage?: () => { utilization: number; resetsAt: number } | null;
  /** Injectable for tests; defaults to Electron's powerMonitor. */
  getIdleSeconds?: () => number;
}

interface RunningCard {
  cardId: string;
  cardTitle: string;
  attemptId: string;
  startedAt: number;
  handle: RunnerHandle;
}

export class BacklogEngine {
  private config: BacklogSchedulerConfig;
  private readonly store: BacklogStore;
  private readonly usagePoller: { refreshNow: () => void };
  private readonly artifactsDir: string;
  private readonly worktreesDir: string;
  private readonly getUsage: () => { utilization: number; resetsAt: number } | null;
  private readonly getIdleSeconds: () => number;

  private edgeTimer: NodeJS.Timeout | null = null;   // next window start/end
  private graceTimer: NodeJS.Timeout | null = null;  // window-end grace kill
  private idleTimer: NodeJS.Timeout | null = null;   // requireIdle recheck
  private usageTimer: NodeJS.Timeout | null = null;  // usage-latch expiry recheck
  private running: RunningCard | null = null;
  // Guards the async gap in runCard (worktree creation) — `running` is only
  // set after the spawn, so without this two claims could interleave.
  private claiming = false;
  // Cards the user stopped mid-window. Paused cards are picked FIRST, so
  // without this a just-stopped card would be re-claimed immediately by the
  // next tryClaimNext. Cleared at window end; manual Run-now ignores it.
  private stoppedThisWindow = new Set<string>();
  private waitingForIdle = false;
  // Usage latch: a run died on (or the snapshot shows) an exhausted 5-hour
  // usage window — no auto-claims until this timestamp. Manual Run-now bypasses.
  private usageExhaustedUntil: number | null = null;
  private lastRun: BacklogSchedulerStatus['lastRun'] = null;
  private stopped = true;

  constructor(config: BacklogSchedulerConfig, deps: BacklogEngineDeps) {
    this.config = config;
    this.store = deps.store;
    this.usagePoller = deps.usagePoller;
    this.artifactsDir = deps.artifactsDir;
    this.worktreesDir = deps.worktreesDir;
    this.getUsage = deps.getUsage ?? (() => null);
    this.getIdleSeconds = deps.getIdleSeconds ?? (() => powerMonitor.getSystemIdleTime());
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
      // be abandoned mid-flight and orphan the claude subtree.
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

  /** True while a card is executing — the Cowork scheduler skips openers then. */
  public isRunningCard(): boolean {
    return this.running !== null;
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

    // Usage latch: a previous run died on an exhausted usage window.
    if (this.usageExhaustedUntil !== null) {
      if (now < this.usageExhaustedUntil) {
        this.broadcast();
        return;
      }
      this.usageExhaustedUntil = null;
    }
    // Proactive gate: don't start a card the exhausted window would kill anyway.
    const usage = this.getUsage();
    if (usage && usage.utilization >= USAGE_GATE_UTILIZATION) {
      this.engageUsageLatch(`5-hour window at ${Math.round(usage.utilization)}% — waiting for reset`);
      return;
    }

    const candidates = this.store.listCards().filter((c) => !this.stoppedThisWindow.has(c.id));
    const card = pickNextCard(candidates, win.end - now);
    if (!card) {
      this.broadcast();
      return;
    }
    void this.runCard(card, /*manual*/ false).then((res) => {
      if (!res.ok) logger.warn(`[Backlog] failed to start "${card.title}": ${res.reason}`);
    });
  }

  /**
   * Stop auto-claiming until the usage window resets (plus a small buffer so
   * the poller has re-polled by the time we retry). Falls back to a periodic
   * recheck when the snapshot can't say when that is.
   */
  private engageUsageLatch(logReason: string) {
    const now = Date.now();
    const usage = this.getUsage();
    const until = usage && usage.resetsAt > now ? usage.resetsAt + 60_000 : now + USAGE_RECHECK_FALLBACK_MS;
    this.usageExhaustedUntil = until;
    logger.info(`[Backlog] usage latch engaged (${logReason}) — resuming ${new Date(until).toLocaleTimeString()}`);
    this.usagePoller.refreshNow();
    if (this.usageTimer) clearTimeout(this.usageTimer);
    this.usageTimer = setTimeout(() => {
      this.usageTimer = null;
      this.usageExhaustedUntil = null;
      this.tryClaimNext();
    }, until - now);
    this.usageTimer.unref?.();
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
      const prompt = card.taskType === 'execution'
        ? buildExecutionPrompt(card, attachments)
        : buildResearchPrompt(card, attachments);
      const handle = executeCard({
        prompt, cwd, budgetMs: cardBudgetMs(card),
        taskType: card.taskType, model: card.model, resumeSessionId,
      });
      this.running = {
        cardId: card.id,
        cardTitle: card.title,
        attemptId: attempt.id,
        startedAt: attempt.startedAt,
        handle,
      };
      logger.info(`[Backlog] running "${card.title}" (${card.taskType}, ${manual ? 'manual' : 'scheduled'}${resumeSessionId ? ', resumed' : ''}) in ${cwd}`);
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
          this.engageUsageLatch(reason ?? 'usage limit reached');
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
        });
        this.lastRun = { at: Date.now(), cardId: card.id, cardTitle: card.title, outcome };
        logger.info(`[Backlog] "${card.title}" finished: ${outcome}${reason ? ` (${reason})` : ''}`);

        // The run spent real window credit — refresh usage promptly.
        this.usagePoller.refreshNow();
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
      if (blockedLike) {
        const reason = firstReportLine(result.report) ?? 'agent reported it was blocked';
        this.store.setCardState(card.id, 'blocked', reason);
        return { outcome: 'blocked', reason };
      }
      this.store.setCardState(card.id, 'done');
      return { outcome: 'success', reason: selfStatus === 'partial' ? 'agent reported partial completion' : undefined };
    }

    // Execution: the dirty worktree is the deliverable — capture it as a patch.
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

    this.store.setCardState(card.id, 'done');
    return { outcome: 'success', reason: selfStatus === 'partial' ? 'agent reported partial completion' : undefined };
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
      usagePausedUntil: this.usageExhaustedUntil,
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
    if (this.usageTimer) { clearTimeout(this.usageTimer); this.usageTimer = null; }
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

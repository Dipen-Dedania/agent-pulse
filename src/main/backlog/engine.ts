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
  BacklogAttemptOutcome,
  BacklogCard,
  BacklogSchedulerConfig,
  BacklogSchedulerStatus,
  countUnmetPrereqs,
} from '../../common/backlog-types';
import { BacklogStore } from './store';
import { activeWindow, nextWindowStart, pickNextCard, cardBudgetMs, forecastNextWindow } from './timing';
import { buildResearchPrompt } from './prompt';
import { executeCard, RunnerHandle } from './runner';

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
const ARTIFACT_PREVIEW_CHARS = 500;

export interface BacklogEngineDeps {
  store: BacklogStore;
  usagePoller: { refreshNow: () => void };
  artifactsDir: string; // userData/backlog-artifacts
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
  private readonly getIdleSeconds: () => number;

  private edgeTimer: NodeJS.Timeout | null = null;   // next window start/end
  private graceTimer: NodeJS.Timeout | null = null;  // window-end grace kill
  private idleTimer: NodeJS.Timeout | null = null;   // requireIdle recheck
  private running: RunningCard | null = null;
  // Cards the user stopped mid-window. Paused cards are picked FIRST, so
  // without this a just-stopped card would be re-claimed immediately by the
  // next tryClaimNext. Cleared at window end; manual Run-now ignores it.
  private stoppedThisWindow = new Set<string>();
  private waitingForIdle = false;
  private lastRun: BacklogSchedulerStatus['lastRun'] = null;
  private stopped = true;

  constructor(config: BacklogSchedulerConfig, deps: BacklogEngineDeps) {
    this.config = config;
    this.store = deps.store;
    this.usagePoller = deps.usagePoller;
    this.artifactsDir = deps.artifactsDir;
    this.getIdleSeconds = deps.getIdleSeconds ?? (() => powerMonitor.getSystemIdleTime());
  }

  public start() {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info(`[Backlog] engine starting, enabled=${this.config.enabled}, slots=${this.config.slots.length}`);
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
   * Manual "Run now": any tier, any time (no window required). The card must
   * be in Todo or Paused — the atomic claim enforces that.
   */
  public runNow(cardId: string): { ok: boolean; reason?: string } {
    if (this.stopped) return { ok: false, reason: 'engine is not running' };
    if (this.running) return { ok: false, reason: `"${this.running.cardTitle}" is already running — one card at a time` };
    const card = this.store.getCard(cardId);
    if (!card) return { ok: false, reason: 'card not found' };
    if (card.state !== 'todo' && card.state !== 'paused') {
      return { ok: false, reason: 'only Todo or Paused cards can be run — move it to Todo first' };
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

  /** Claim and run the next fitting card, honoring the idle gate. */
  private tryClaimNext() {
    if (this.stopped || !this.config.enabled || this.running) return;
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

    const candidates = this.store.listCards().filter((c) => !this.stoppedThisWindow.has(c.id));
    const card = pickNextCard(candidates, win.end - now);
    if (!card) {
      this.broadcast();
      return;
    }
    const res = this.runCard(card, /*manual*/ false);
    if (!res.ok) logger.warn(`[Backlog] failed to start "${card.title}": ${res.reason}`);
  }

  /** Claim → spawn → track. Shared by the window loop and manual Run-now. */
  private runCard(card: BacklogCard, manual: boolean): { ok: boolean; reason?: string } {
    if (!this.store.claimCard(card.id)) {
      return { ok: false, reason: 'card was already claimed or moved' };
    }
    const project = this.store.listProjects().find((p) => p.id === card.projectId);
    if (!project) {
      this.store.setCardState(card.id, 'blocked', 'project no longer registered');
      this.broadcastChanged();
      return { ok: false, reason: 'project no longer registered' };
    }

    const attempt = this.store.insertAttempt(card.id, manual);
    this.store.setCardState(card.id, 'in-progress');
    const handle = executeCard(buildResearchPrompt(card), project.path, cardBudgetMs(card), card.model);
    this.running = {
      cardId: card.id,
      cardTitle: card.title,
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      handle,
    };
    logger.info(`[Backlog] running "${card.title}" (${manual ? 'manual' : 'scheduled'}) in ${project.path}`);
    this.broadcast();
    this.broadcastChanged();

    void handle.promise.then((result) => {
      // stop() may have already finalized the rows and cleared `running`.
      if (this.running?.attemptId !== attempt.id) return;
      this.running = null;
      this.clearGraceTimer();

      let outcome: BacklogAttemptOutcome;
      if (result.outcome === 'success') {
        outcome = 'success';
        try {
          const reportPath = this.writeReport(card.id, attempt.id, result.report!);
          this.store.insertArtifact({
            cardId: card.id,
            attemptId: attempt.id,
            path: reportPath,
            preview: result.report!.slice(0, ARTIFACT_PREVIEW_CHARS),
          });
          this.store.setCardState(card.id, 'done');
        } catch (e: any) {
          // Report write failed — don't lose the run silently.
          outcome = 'failed';
          result.reason = `report write failed: ${e?.message ?? e}`;
          this.store.setCardState(card.id, 'blocked', result.reason);
        }
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
      } else {
        outcome = 'failed';
        this.store.setCardState(card.id, 'blocked', result.reason ?? 'run failed');
      }

      this.store.finishAttempt(attempt.id, {
        outcome,
        reason: result.reason ?? null,
        costUsd: result.costUsd,
        numTurns: result.numTurns,
        sessionId: result.sessionId,
      });
      this.lastRun = { at: Date.now(), cardId: card.id, cardTitle: card.title, outcome };
      logger.info(`[Backlog] "${card.title}" finished: ${outcome}${result.reason ? ` (${result.reason})` : ''}`);

      // The run spent real window credit — refresh usage promptly.
      this.usagePoller.refreshNow();
      this.broadcast();
      this.broadcastChanged();
      this.tryClaimNext();
    });

    return { ok: true };
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

  private writeReport(cardId: string, attemptId: string, report: string): string {
    const dir = path.join(this.artifactsDir, cardId);
    fs.mkdirSync(dir, { recursive: true });
    const reportPath = path.join(dir, `${attemptId}.md`);
    fs.writeFileSync(reportPath, report, 'utf8');
    return reportPath;
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
      // Runnable = what the picker would actually consider: green todo/paused
      // with all prereqs done. Prereq-gated cards aren't "ready".
      queueReady: cards.filter((c) =>
        (c.state === 'todo' || c.state === 'paused') &&
        c.riskTier === 'green' &&
        countUnmetPrereqs(c, cards) === 0).length,
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

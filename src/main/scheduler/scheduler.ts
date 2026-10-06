// Cowork Scheduler engine. Mirrors UsagePoller's lifecycle (constructor → init
// → start/stop/applyConfig/getStatus + broadcast). It does NOT detect windows
// itself — it subscribes to a usage source for the live anchor-window
// `resetsAt` and reads credentials for the token `expiresAt`, then arms a
// single timer for the next event (opener or token nudge) computed by ./timing.
//
// The engine is provider-agnostic: everything Claude- or Codex-specific (which
// poller, which window anchors the schedule, how to read token expiry, what
// to spawn, which IPC prefix) arrives through SchedulerDeps. The Claude deps
// factory below reproduces the original behaviour and channel names exactly;
// ./codex-provider.ts builds the Codex set.
//
// The engine runs for the whole app lifetime even in `off` mode, because the
// token nudge can still fire. When nothing is scheduled, the timer is simply
// left unarmed.

import { BrowserWindow, ipcMain } from 'electron';
import { logger } from '../../common/logger';
import { SchedulerStatus, SchedulerLastRun, UsageStatus } from '../../common/types';
import { SchedulerConfig } from '../user-config';
import { UsagePoller } from '../usage/poller';
import { readCredentials } from '../usage/credentials';
import { nextEvent, NextEvent } from './timing';
import { fireOpener, OpenerResult } from './opener';

const MIDNIGHT_SKEW_MS = 1_000; // fire the daily reset just after local midnight

/** The slice of a usage poller the scheduler needs. */
export interface SchedulerUsageSource<S> {
  getStatus(): S;
  subscribe(listener: (s: S) => void): () => void;
  refreshNow(): void;
}

export interface SchedulerDeps<S = unknown> {
  usageSource: SchedulerUsageSource<S>;
  /** Pull the anchor window's resetsAt out of a usage status; null when not live. */
  anchorResetsAt: (s: S) => number | null;
  /** Best-effort token expiry (ms epoch) for the nudge; null when unknown. Must not throw. */
  readExpiry: () => Promise<number | null>;
  /** Fire one opener ping. Never throws. */
  fire: () => Promise<OpenerResult>;
  /** IPC channel prefix: 'scheduler' (Claude) | 'codex-scheduler'. */
  ipcPrefix: string;
  /** Log tag, e.g. '[Scheduler]'. */
  logTag: string;
  // Backlog runs spend real messages and anchor windows by themselves, so an
  // opener ping fired mid-run would be redundant spend. Optional so tests and
  // callers without a backlog engine don't need to stub it.
  shouldSkipOpener?: () => boolean;
}

export class Scheduler<S = unknown> {
  private config: SchedulerConfig;
  private readonly deps: SchedulerDeps<S>;
  private status: SchedulerStatus;

  private timer: NodeJS.Timeout | null = null;
  private midnightTimer: NodeJS.Timeout | null = null;
  private unsubscribePoller: (() => void) | null = null;
  private stopped = true;

  private resetsAt: number | null = null;   // live anchor-window reset, from the usage source
  private expiresAt: number | null = null;  // token expiry the current schedule was computed from
  // The expiry we already fired a nudge for. A nudge is one-shot per token:
  // nextNudgeFire clamps a past expiry to "now", so without this guard an
  // expiry that stays in the past (stale credentials, missing CLI, a ping that
  // did not renew the token) would re-arm a zero-delay timer after every fire
  // and spin the main thread. Clears itself once the expiry moves.
  private nudgedExpiresAt: number | null = null;

  constructor(config: SchedulerConfig, deps: SchedulerDeps<S>) {
    this.config = config;
    this.deps = deps;
    this.status = {
      mode: config.mode,
      nextFireAt: null,
      nextEventKind: null,
      lastRun: null,
      openersToday: 0,
      windowResetsAt: null,
    };
  }

  public init() {
    const p = this.deps.ipcPrefix;
    ipcMain.handle(`${p}:get-current`, () => this.status);
    // Manual "Send test ping now" — fires a real opener (so it counts toward
    // the daily cap) and lets the user confirm the pipeline works.
    ipcMain.handle(`${p}:test-opener`, async () => {
      logger.info(`${this.deps.logTag} manual test opener requested`);
      return this.runEvent('opener', /*manual*/ true);
    });
  }

  public start() {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info(`${this.deps.logTag} starting, mode=${this.config.mode}`);

    // Seed from the source's current status, then track future updates.
    this.ingestUsage(this.deps.usageSource.getStatus());
    this.unsubscribePoller = this.deps.usageSource.subscribe((s) => this.ingestUsage(s));

    this.scheduleMidnightReset();
    void this.reschedule();
  }

  public stop() {
    logger.info(`${this.deps.logTag} stopping`);
    this.stopped = true;
    this.clearTimer();
    if (this.midnightTimer) { clearTimeout(this.midnightTimer); this.midnightTimer = null; }
    if (this.unsubscribePoller) { this.unsubscribePoller(); this.unsubscribePoller = null; }
  }

  public applyConfig(config: SchedulerConfig) {
    this.config = config;
    this.status = { ...this.status, mode: config.mode };
    if (!this.stopped) void this.reschedule();
    else this.broadcast();
  }

  public getStatus(): SchedulerStatus {
    return this.status;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  /** Pull the live anchor reset out of a usage status and reschedule on change. */
  private ingestUsage(s: S) {
    const next = this.deps.anchorResetsAt(s);
    if (next === this.resetsAt && this.status.windowResetsAt === next) return;
    this.resetsAt = next;
    this.status = { ...this.status, windowResetsAt: next };
    if (!this.stopped) void this.reschedule();
  }

  /** Recompute the next event and arm the timer for it. */
  private async reschedule() {
    if (this.stopped) return;
    this.clearTimer();

    // expiresAt is best-effort; a miss just means no token nudge this cycle.
    let expiresAt: number | null = null;
    try {
      expiresAt = await this.deps.readExpiry();
    } catch (e) {
      logger.debug(`${this.deps.logTag} credentials read failed during reschedule`, e);
    }
    if (this.stopped) return;
    this.expiresAt = expiresAt;

    // Already nudged for this exact expiry — wait for the token to actually
    // refresh (a new expiresAt) before considering another nudge.
    const nudgeExpiresAt = expiresAt !== null && expiresAt === this.nudgedExpiresAt ? null : expiresAt;
    if (nudgeExpiresAt === null && expiresAt !== null) {
      logger.debug(`${this.deps.logTag} nudge already fired for expiry ${new Date(expiresAt).toISOString()}; waiting for a new token`);
    }

    const now = Date.now();
    const ev = nextEvent(
      this.config,
      { resetsAt: this.resetsAt, expiresAt: nudgeExpiresAt, openersToday: this.status.openersToday },
      now,
    );

    this.status = {
      ...this.status,
      nextFireAt: ev?.at ?? null,
      nextEventKind: ev?.kind ?? null,
    };
    this.broadcast();

    if (ev) {
      const delay = Math.max(0, ev.at - now);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.runEvent(ev.kind, false);
      }, delay);
      this.timer.unref?.();
      logger.info(`${this.deps.logTag} next ${ev.kind} in ${Math.round(delay / 1000)}s`);
    } else {
      logger.debug(`${this.deps.logTag} nothing scheduled`);
    }
  }

  /** Fire the ping for an event, record the result, then reschedule. */
  private async runEvent(kind: NextEvent['kind'], manual: boolean): Promise<SchedulerLastRun> {
    const at = Date.now();

    // A backlog card is executing right now — it's already spending messages
    // in (and anchoring) the window, so a scheduled opener adds nothing.
    // Manual test pings still go through so the user can verify the pipeline.
    if (!manual && kind === 'opener' && this.deps.shouldSkipOpener?.()) {
      logger.info(`${this.deps.logTag} opener skipped: backlog window active`);
      const lastRun: SchedulerLastRun = { at, kind, ok: true, reason: 'skipped: backlog run in progress' };
      this.status = { ...this.status, lastRun };
      this.broadcast();
      if (!this.stopped) void this.reschedule();
      return lastRun;
    }

    logger.info(`${this.deps.logTag} firing ${kind}${manual ? ' (manual)' : ''}`);
    // Mark the nudge spent for this expiry before the ping runs, win or lose:
    // a failed ping must not be retried on a zero-delay loop either.
    if (kind === 'nudge') this.nudgedExpiresAt = this.expiresAt;
    const result = await this.deps.fire();

    const lastRun: SchedulerLastRun = {
      at,
      kind,
      ok: result.ok,
      reason: result.reason,
    };

    // Both openers and nudges spend a sliver of the window/weekly cap, but only
    // openers are meant to anchor a block — count those toward the daily cap.
    const openersToday =
      kind === 'opener' && result.ok ? this.status.openersToday + 1 : this.status.openersToday;

    this.status = { ...this.status, lastRun, openersToday };

    // The window state just changed — refresh the source so adaptive timing and
    // the bubble glance pick up the new resetsAt promptly.
    if (result.ok) this.deps.usageSource.refreshNow();

    this.broadcast();
    if (!this.stopped) void this.reschedule();
    return lastRun;
  }

  private scheduleMidnightReset() {
    if (this.midnightTimer) clearTimeout(this.midnightTimer);
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime();
    const delay = Math.max(0, nextMidnight - Date.now()) + MIDNIGHT_SKEW_MS;
    this.midnightTimer = setTimeout(() => {
      this.midnightTimer = null;
      logger.info(`${this.deps.logTag} local midnight — resetting daily opener counter`);
      this.status = { ...this.status, openersToday: 0 };
      this.scheduleMidnightReset();
      if (!this.stopped) void this.reschedule();
    }, delay);
    this.midnightTimer.unref?.();
  }

  private clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private broadcast() {
    const channel = `${this.deps.ipcPrefix}:updated`;
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, this.status);
    }
  }
}

export type ClaudeScheduler = Scheduler<UsageStatus>;

/**
 * Claude Code deps — today's exact behaviour and channel names: anchored on the
 * 5-hour window, token expiry from ~/.claude/.credentials.json, `claude -p`
 * ping, `scheduler:*` IPC.
 */
export function claudeSchedulerDeps(
  usagePoller: UsagePoller,
  shouldSkipOpener?: () => boolean,
): SchedulerDeps<UsageStatus> {
  return {
    usageSource: usagePoller,
    anchorResetsAt: (s) => (s.state === 'ok' && s.snapshot ? s.snapshot.fiveHour.resetsAt : null),
    readExpiry: async () => {
      const creds = await readCredentials();
      return creds.ok && typeof creds.expiresAt === 'number' ? creds.expiresAt : null;
    },
    fire: fireOpener,
    ipcPrefix: 'scheduler',
    logTag: '[Scheduler]',
    shouldSkipOpener,
  };
}

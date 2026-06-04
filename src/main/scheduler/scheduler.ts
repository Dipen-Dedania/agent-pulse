// Cowork Scheduler engine. Mirrors UsagePoller's lifecycle (constructor → init
// → start/stop/applyConfig/getStatus + broadcast). It does NOT detect windows
// itself — it subscribes to UsagePoller for the live 5-hour `resetsAt` and
// reads credentials for the token `expiresAt`, then arms a single timer for the
// next event (opener or token nudge) computed by ./timing.
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
import { fireOpener } from './opener';

const MIDNIGHT_SKEW_MS = 1_000; // fire the daily reset just after local midnight

export interface SchedulerDeps {
  usagePoller: UsagePoller;
}

export class Scheduler {
  private config: SchedulerConfig;
  private readonly usagePoller: UsagePoller;
  private status: SchedulerStatus;

  private timer: NodeJS.Timeout | null = null;
  private midnightTimer: NodeJS.Timeout | null = null;
  private unsubscribePoller: (() => void) | null = null;
  private stopped = true;

  private resetsAt: number | null = null;   // live 5-hour reset, from the poller

  constructor(config: SchedulerConfig, deps: SchedulerDeps) {
    this.config = config;
    this.usagePoller = deps.usagePoller;
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
    ipcMain.handle('scheduler:get-current', () => this.status);
    // Manual "Send test ping now" — fires a real opener (so it counts toward
    // the daily cap) and lets the user confirm the pipeline works.
    ipcMain.handle('scheduler:test-opener', async () => {
      logger.info('[Scheduler] manual test opener requested');
      return this.runEvent('opener', /*manual*/ true);
    });
  }

  public start() {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info(`[Scheduler] starting, mode=${this.config.mode}`);

    // Seed from the poller's current status, then track future updates.
    this.ingestUsage(this.usagePoller.getStatus());
    this.unsubscribePoller = this.usagePoller.subscribe((s) => this.ingestUsage(s));

    this.scheduleMidnightReset();
    void this.reschedule();
  }

  public stop() {
    logger.info('[Scheduler] stopping');
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

  /** Pull the live 5-hour reset out of a usage status and reschedule on change. */
  private ingestUsage(s: UsageStatus) {
    const next = s.state === 'ok' && s.snapshot ? s.snapshot.fiveHour.resetsAt : null;
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
      const creds = await readCredentials();
      if (creds.ok && typeof creds.expiresAt === 'number') expiresAt = creds.expiresAt;
    } catch (e) {
      logger.debug('[Scheduler] credentials read failed during reschedule', e);
    }
    if (this.stopped) return;

    const now = Date.now();
    const ev = nextEvent(
      this.config,
      { resetsAt: this.resetsAt, expiresAt, openersToday: this.status.openersToday },
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
      logger.info(`[Scheduler] next ${ev.kind} in ${Math.round(delay / 1000)}s`);
    } else {
      logger.debug('[Scheduler] nothing scheduled');
    }
  }

  /** Fire the ping for an event, record the result, then reschedule. */
  private async runEvent(kind: NextEvent['kind'], manual: boolean): Promise<SchedulerLastRun> {
    const at = Date.now();
    logger.info(`[Scheduler] firing ${kind}${manual ? ' (manual)' : ''}`);
    const result = await fireOpener();

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

    // The window state just changed — refresh the poller so adaptive timing and
    // the bubble glance pick up the new resetsAt promptly.
    if (result.ok) this.usagePoller.refreshNow();

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
      logger.info('[Scheduler] local midnight — resetting daily opener counter');
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
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('scheduler:updated', this.status);
    }
  }
}

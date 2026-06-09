// Polls Cursor's undocumented /api/usage-summary endpoint at a user-configured
// interval and broadcasts the latest snapshot to renderer windows.
//
// Mirrors the Codex poller (src/main/codex-usage/poller.ts) in shape and
// recovery behavior. Differences:
//   - Auth is the WorkosCursorSessionToken cookie (built from the token in
//     Cursor's local SQLite DB), with an Authorization: Bearer fallback on 401
//     to cover the cookie/Bearer ambiguity.
//   - Cursor exposes a single BILLING-CYCLE window ("plan"), not rolling
//     rate-limit windows — so there's one bar and one set of nudge flags.
//
// Caveats (undocumented endpoint): wrap every call defensively, never crash on
// shape drift, and surface a degraded state instead.

import { BrowserWindow, Notification, ipcMain } from 'electron';
import { logger } from '../../common/logger';
import { CursorUsageStatus, CursorUsageSnapshot, CursorUsageNudgeFlags } from '../../common/types';
import { CursorUsageConfig } from '../user-config';
import { readAccessToken, CredentialsResult } from './credentials';
import { parseUsageResponse } from './parse';

const ENDPOINT = 'https://cursor.com/api/usage-summary';
// Billing cycle changes slowly — 10 min is the floor.
const MIN_INTERVAL_MS = 10 * 60_000;
const RATE_LIMIT_CAP_MS = 60 * 60_000;
const UNAVAILABLE_BACKOFF_MS = 60 * 60_000;
// Same lead as the other pollers — kept in sync for consistency.
const NUDGE_LEAD_MS = 30 * 60_000;

export type CursorUsageStatusListener = (status: CursorUsageStatus) => void;

export class CursorUsagePoller {
  private status: CursorUsageStatus = { state: 'unknown' };
  private timer: NodeJS.Timeout | null = null;
  private config: CursorUsageConfig;
  private listeners: Set<CursorUsageStatusListener> = new Set();
  private lastCapNotified = 0;
  private lastNudgeNotified = 0;
  private currentDelayMs: number;
  private stopped = false;

  constructor(config: CursorUsageConfig) {
    this.config = config;
    this.currentDelayMs = Math.max(MIN_INTERVAL_MS, config.intervalMs);
  }

  public init() {
    ipcMain.handle('cursor-usage:get-current', () => this.status);
    ipcMain.on('cursor-usage:refresh-now', () => {
      logger.info('[CursorUsagePoller] manual refresh requested');
      this.refreshNow();
    });
  }

  public start() {
    if (!this.config.enabled) {
      logger.info('[CursorUsagePoller] disabled in config; not starting');
      return;
    }
    logger.info(
      `[CursorUsagePoller] starting, interval=${this.config.intervalMs}ms ` +
      `cap=${this.config.capWarning.enabled ? this.config.capWarning.threshold + '%' : 'off'} ` +
      `nudge=${this.config.nudge.enabled ? this.config.nudge.threshold + '%' : 'off'}`,
    );
    this.stopped = false;
    this.poll().catch((e) => logger.warn('[CursorUsagePoller] initial poll error:', e));
  }

  public stop() {
    logger.info('[CursorUsagePoller] stopping');
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public applyConfig(config: CursorUsageConfig) {
    const wasEnabled = this.config.enabled;
    this.config = config;
    this.currentDelayMs = Math.max(MIN_INTERVAL_MS, config.intervalMs);

    if (!wasEnabled && this.config.enabled) {
      this.start();
    } else if (wasEnabled && !this.config.enabled) {
      this.stop();
      this.setStatus({ state: 'unknown', message: 'Tracking disabled.' });
    } else if (this.config.enabled) {
      if (this.status.state !== 'unauthenticated' && this.status.state !== 'unavailable') {
        this.scheduleNext(Math.max(MIN_INTERVAL_MS, config.intervalMs));
      }
    }
  }

  public refreshNow() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.currentDelayMs = Math.max(MIN_INTERVAL_MS, this.config.intervalMs);
    this.poll().catch((e) => logger.warn('[CursorUsagePoller] refresh error:', e));
  }

  public getStatus(): CursorUsageStatus {
    return this.status;
  }

  public subscribe(listener: CursorUsageStatusListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async poll() {
    if (this.stopped || !this.config.enabled) return;

    const creds = await readAccessToken();
    if (!creds.ok) {
      logger.warn(`[CursorUsagePoller] credentials unavailable (${creds.reason}): ${creds.detail}`);
      if (creds.reason === 'error') {
        // Local read problem (e.g. native module missing) — not an auth issue.
        this.setStatus({
          state: 'unavailable',
          message: 'Could not read Cursor credentials locally. Will retry.',
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
      } else {
        this.setStatus({
          state: 'unauthenticated',
          message: 'No Cursor session found. Sign in to Cursor, then click Refresh.',
        });
      }
      return;
    }

    try {
      let res = await this.request(creds, 'cookie');
      // Cover the cookie/Bearer ambiguity: if the cookie is rejected, retry
      // once with an Authorization header before declaring unauthenticated.
      if (res.status === 401) {
        res = await this.request(creds, 'bearer');
      }

      if (res.status === 401) {
        logger.warn('[CursorUsagePoller] 401 unauthorized — pausing until manual refresh');
        this.setStatus({
          state: 'unauthenticated',
          message: 'Cursor session expired. Open Cursor to refresh it, then click Refresh.',
        });
        return;
      }

      if (res.status === 429) {
        const next = Math.min(this.currentDelayMs * 2, RATE_LIMIT_CAP_MS);
        logger.warn(`[CursorUsagePoller] 429 rate-limited; backing off to ${next}ms`);
        this.setStatus({
          state: 'rate-limited',
          snapshot: this.status.snapshot,
          lastUpdated: this.status.lastUpdated,
          nudgeActive: this.status.nudgeActive,
          message: 'Cursor rate-limited the usage endpoint. Backing off.',
        });
        this.scheduleNext(next);
        return;
      }

      if (res.status === 404 || res.status === 400) {
        logger.warn(`[CursorUsagePoller] endpoint returned ${res.status}; treating as unavailable`);
        this.setStatus({
          state: 'unavailable',
          message: "Cursor's usage endpoint may have moved. Will retry in an hour.",
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
        return;
      }

      if (!res.ok) {
        logger.warn(`[CursorUsagePoller] HTTP ${res.status}; will retry`);
        this.setStatus({
          state: 'network-error',
          snapshot: this.status.snapshot,
          lastUpdated: this.status.lastUpdated,
          nudgeActive: this.status.nudgeActive,
          message: `Upstream returned HTTP ${res.status}.`,
        });
        this.scheduleNext(Math.max(MIN_INTERVAL_MS, this.config.intervalMs));
        return;
      }

      const body = await res.json().catch(() => null);
      const snapshot = parseUsageResponse(body);
      if (!snapshot) {
        logger.warn('[CursorUsagePoller] response shape unrecognized:', JSON.stringify(body)?.slice(0, 300));
        this.setStatus({
          state: 'unavailable',
          message: 'Cursor usage endpoint returned an unexpected shape.',
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
        return;
      }

      this.currentDelayMs = Math.max(MIN_INTERVAL_MS, this.config.intervalMs);
      const nudgeActive = this.evaluateAndNotify(snapshot);
      this.setStatus({
        state: 'ok',
        snapshot,
        lastUpdated: Date.now(),
        nudgeActive,
      });
      this.scheduleNext(this.currentDelayMs);
    } catch (e: any) {
      logger.warn('[CursorUsagePoller] network error:', e?.message ?? e);
      this.setStatus({
        state: 'network-error',
        snapshot: this.status.snapshot,
        lastUpdated: this.status.lastUpdated,
        nudgeActive: this.status.nudgeActive,
        message: 'Network error reaching the Cursor usage endpoint.',
      });
      this.scheduleNext(Math.max(MIN_INTERVAL_MS, this.config.intervalMs));
    }
  }

  private request(creds: CredentialsResult, mode: 'cookie' | 'bearer'): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (mode === 'cookie') headers.Cookie = creds.cookie;
    else headers.Authorization = `Bearer ${creds.token}`;
    return fetch(ENDPOINT, { method: 'GET', headers });
  }

  private scheduleNext(delayMs: number) {
    if (this.stopped || !this.config.enabled) return;
    this.currentDelayMs = delayMs;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.poll().catch((e) => logger.warn('[CursorUsagePoller] poll error:', e));
    }, delayMs);
    this.timer.unref?.();
  }

  private setStatus(status: CursorUsageStatus) {
    this.status = status;
    this.broadcast();
  }

  private broadcast() {
    const windows = BrowserWindow.getAllWindows();
    logger.debug(`[CursorUsagePoller] broadcasting state=${this.status.state} to ${windows.length} window(s)`);
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('cursor-usage:updated', this.status);
      }
    }
    for (const listener of this.listeners) {
      try { listener(this.status); }
      catch (e) { logger.warn('[CursorUsagePoller] listener threw:', e); }
    }
  }

  private evaluateAndNotify(snapshot: CursorUsageSnapshot): CursorUsageNudgeFlags {
    const flags: CursorUsageNudgeFlags = { plan: false };
    const w = snapshot.plan;
    const remaining = 100 - w.utilization;
    const msUntilReset = w.resetsAt - Date.now();

    if (this.config.capWarning.enabled && remaining <= this.config.capWarning.threshold) {
      this.fireCapWarning(remaining, w.resetsAt);
    }

    const nudgeCondition =
      this.config.nudge.enabled &&
      remaining >= this.config.nudge.threshold &&
      msUntilReset > 0 &&
      msUntilReset <= NUDGE_LEAD_MS;

    if (nudgeCondition) {
      flags.plan = true;
      this.fireNudge(remaining, w.resetsAt);
    }
    return flags;
  }

  private fireCapWarning(remaining: number, resetsAt: number) {
    if (this.lastCapNotified === resetsAt) return;
    this.lastCapNotified = resetsAt;
    try {
      new Notification({
        title: `Cursor usage: ${Math.round(remaining)}% left`,
        body: `Your Cursor plan is almost out. Resets ${formatRelative(resetsAt)}.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[CursorUsagePoller] cap notification failed:', e);
    }
  }

  private fireNudge(remaining: number, resetsAt: number) {
    if (this.lastNudgeNotified === resetsAt) return;
    this.lastNudgeNotified = resetsAt;
    try {
      new Notification({
        title: `${Math.round(remaining)}% Cursor credit unused`,
        body: `Your Cursor plan resets ${formatRelative(resetsAt)}. Use it before it's gone.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[CursorUsagePoller] nudge notification failed:', e);
    }
  }
}

function formatRelative(targetMs: number): string {
  const diff = targetMs - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

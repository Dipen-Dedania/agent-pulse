// Polls Anthropic's undocumented OAuth usage endpoint at a user-configured
// interval and broadcasts the latest snapshot to renderer windows.
//
// CAVEAT — endpoint is undocumented and may change without notice. Every
// network failure path falls back to a non-throwing "unavailable"/"error"
// status so the rest of the app keeps working.
//
// Recovery path for a 401 (token expired): we cannot refresh the token
// ourselves. The user must run any Claude Code command (which triggers
// Claude Code's own refresh), then click Refresh in the settings panel.
//
// Two independent notification paths:
//   - capWarning: fires when REMAINING credit ≤ threshold (about to hit cap).
//   - nudge: fires when REMAINING ≥ threshold AND reset is within
//     NUDGE_LEAD_MS — "use it or lose it" reminder. Also broadcast as a
//     nudgeActive flag so the bubble can show a badge.

import { BrowserWindow, Notification, ipcMain } from 'electron';
import { logger } from '../../common/logger';
import { UsageStatus, UsageSnapshot, UsageNudgeFlags } from '../../common/types';
import { UsageConfig } from '../user-config';
import { readAccessToken } from './credentials';
import { parseUsageResponse } from './parse';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const BETA_HEADER = 'oauth-2025-04-20';
const MIN_INTERVAL_MS = 60_000;
const RATE_LIMIT_CAP_MS = 60 * 60_000;
const UNAVAILABLE_BACKOFF_MS = 60 * 60_000;
// Nudge fires only when the window is this close to resetting. Hard-coded
// in v1 — keeps the UI to one knob (the remaining-credit threshold).
const NUDGE_LEAD_MS = 30 * 60_000;

type WindowKey = 'fiveHour' | 'sevenDay';
const WINDOW_KEYS: WindowKey[] = ['fiveHour', 'sevenDay'];
const WINDOW_LABEL: Record<WindowKey, string> = {
  fiveHour: '5-hour',
  sevenDay: '7-day',
};

export class UsagePoller {
  private status: UsageStatus = { state: 'unknown' };
  private timer: NodeJS.Timeout | null = null;
  private config: UsageConfig;
  /** Last reset timestamp we fired a cap-warning for, per window. */
  private lastCapNotified: Record<WindowKey, number> = { fiveHour: 0, sevenDay: 0 };
  /** Last reset timestamp we fired a nudge for, per window. */
  private lastNudgeNotified: Record<WindowKey, number> = { fiveHour: 0, sevenDay: 0 };
  /** Tracks whether the current scheduled wakeup is in a backoff state. */
  private currentDelayMs: number;
  private stopped = false;

  constructor(config: UsageConfig) {
    this.config = config;
    this.currentDelayMs = Math.max(MIN_INTERVAL_MS, config.intervalMs);
  }

  public init() {
    ipcMain.handle('usage:get-current', () => this.status);
    ipcMain.on('usage:refresh-now', () => {
      logger.info('[UsagePoller] manual refresh requested');
      this.refreshNow();
    });
  }

  public start() {
    if (!this.config.enabled) {
      logger.info('[UsagePoller] disabled in config; not starting');
      return;
    }
    logger.info(
      `[UsagePoller] starting, interval=${this.config.intervalMs}ms ` +
      `cap=${this.config.capWarning.enabled ? this.config.capWarning.threshold + '%' : 'off'} ` +
      `nudge=${this.config.nudge.enabled ? this.config.nudge.threshold + '%' : 'off'}`,
    );
    this.stopped = false;
    // Run one poll immediately, then schedule the next.
    this.poll().catch((e) => logger.warn('[UsagePoller] initial poll error:', e));
  }

  public stop() {
    logger.info('[UsagePoller] stopping');
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public applyConfig(config: UsageConfig) {
    const wasEnabled = this.config.enabled;
    this.config = config;
    this.currentDelayMs = Math.max(MIN_INTERVAL_MS, config.intervalMs);

    if (!wasEnabled && this.config.enabled) {
      this.start();
    } else if (wasEnabled && !this.config.enabled) {
      this.stop();
      this.setStatus({ state: 'unknown', message: 'Tracking disabled.' });
    } else if (this.config.enabled) {
      // Reschedule with the new interval if we're not in a paused state.
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
    this.poll().catch((e) => logger.warn('[UsagePoller] refresh error:', e));
  }

  public getStatus(): UsageStatus {
    return this.status;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async poll() {
    if (this.stopped || !this.config.enabled) return;

    const creds = await readAccessToken();
    if (!creds.ok) {
      logger.warn(`[UsagePoller] credentials unavailable (${creds.reason}): ${creds.detail}`);
      this.setStatus({
        state: 'unauthenticated',
        message: 'No Claude Code credentials found. Sign in to Claude Code, then click Refresh.',
      });
      return; // pause until manual refresh
    }

    try {
      const res = await fetch(ENDPOINT, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${creds.token}`,
          'anthropic-beta': BETA_HEADER,
          'Accept': 'application/json',
        },
      });

      if (res.status === 401) {
        logger.warn('[UsagePoller] 401 unauthorized — pausing until manual refresh');
        this.setStatus({
          state: 'unauthenticated',
          message: 'Token expired. Run any Claude Code command to refresh it, then click Refresh.',
        });
        return;
      }

      if (res.status === 429) {
        const next = Math.min(this.currentDelayMs * 2, RATE_LIMIT_CAP_MS);
        logger.warn(`[UsagePoller] 429 rate-limited; backing off to ${next}ms`);
        this.setStatus({
          state: 'rate-limited',
          snapshot: this.status.snapshot,
          lastUpdated: this.status.lastUpdated,
          nudgeActive: this.status.nudgeActive,
          message: 'Anthropic rate-limited the usage endpoint. Backing off.',
        });
        this.scheduleNext(next);
        return;
      }

      if (res.status === 404 || res.status === 400) {
        logger.warn(`[UsagePoller] endpoint returned ${res.status}; treating as unavailable`);
        this.setStatus({
          state: 'unavailable',
          message: 'Anthropic\'s usage endpoint may have moved. Will retry in an hour.',
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
        return;
      }

      if (!res.ok) {
        logger.warn(`[UsagePoller] HTTP ${res.status}; will retry`);
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
        logger.warn('[UsagePoller] response shape unrecognized:', JSON.stringify(body)?.slice(0, 300));
        this.setStatus({
          state: 'unavailable',
          message: 'Usage endpoint returned an unexpected shape.',
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
      logger.warn('[UsagePoller] network error:', e?.message ?? e);
      this.setStatus({
        state: 'network-error',
        snapshot: this.status.snapshot,
        lastUpdated: this.status.lastUpdated,
        nudgeActive: this.status.nudgeActive,
        message: 'Network error reaching the usage endpoint.',
      });
      this.scheduleNext(Math.max(MIN_INTERVAL_MS, this.config.intervalMs));
    }
  }

  private scheduleNext(delayMs: number) {
    if (this.stopped || !this.config.enabled) return;
    this.currentDelayMs = delayMs;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.poll().catch((e) => logger.warn('[UsagePoller] poll error:', e));
    }, delayMs);
    this.timer.unref?.();
  }

  private setStatus(status: UsageStatus) {
    this.status = status;
    this.broadcast();
  }

  private broadcast() {
    const windows = BrowserWindow.getAllWindows();
    logger.debug(`[UsagePoller] broadcasting state=${this.status.state} to ${windows.length} window(s)`);
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('usage:updated', this.status);
      }
    }
  }

  /** Runs both notification paths and returns current nudge-active flags. */
  private evaluateAndNotify(snapshot: UsageSnapshot): UsageNudgeFlags {
    const flags: UsageNudgeFlags = { fiveHour: false, sevenDay: false };
    for (const key of WINDOW_KEYS) {
      const w = snapshot[key];
      const remaining = 100 - w.utilization;
      const msUntilReset = w.resetsAt - Date.now();

      if (this.config.capWarning.enabled && remaining <= this.config.capWarning.threshold) {
        this.fireCapWarning(key, remaining, w.resetsAt);
      }

      const nudgeCondition =
        this.config.nudge.enabled &&
        remaining >= this.config.nudge.threshold &&
        msUntilReset > 0 &&
        msUntilReset <= NUDGE_LEAD_MS;

      if (nudgeCondition) {
        flags[key] = true;
        this.fireNudge(key, remaining, w.resetsAt);
      }
    }
    return flags;
  }

  private fireCapWarning(key: WindowKey, remaining: number, resetsAt: number) {
    if (this.lastCapNotified[key] === resetsAt) return; // debounce per reset cycle
    this.lastCapNotified[key] = resetsAt;
    try {
      new Notification({
        title: `Claude usage: ${Math.round(remaining)}% left`,
        body: `Your ${WINDOW_LABEL[key]} window is almost out. Resets ${formatRelative(resetsAt)}.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[UsagePoller] cap notification failed:', e);
    }
  }

  private fireNudge(key: WindowKey, remaining: number, resetsAt: number) {
    if (this.lastNudgeNotified[key] === resetsAt) return; // debounce per reset cycle
    this.lastNudgeNotified[key] = resetsAt;
    try {
      new Notification({
        title: `${Math.round(remaining)}% Claude credit unused`,
        body: `Your ${WINDOW_LABEL[key]} window resets ${formatRelative(resetsAt)}. Use it before it's gone.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[UsagePoller] nudge notification failed:', e);
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

// Polls ChatGPT's undocumented /backend-api/wham/usage endpoint at a user-
// configured interval and broadcasts the latest snapshot to renderer windows.
//
// Mirrors the Claude poller (src/main/usage/poller.ts) in shape and recovery
// behavior; the wham endpoint is a different beast, so all caveats from the
// Codex usage spec apply:
//   - undocumented; wrap every call defensively and never crash on shape drift.
//   - 401 means the user must sign in to Codex/ChatGPT — we cannot refresh.
//   - 404 / 400 may mean the endpoint moved; back off long.
//
// Two notification paths mirror the Claude poller exactly:
//   - capWarning: REMAINING quota ≤ threshold (about to hit the weekly cap).
//   - nudge: REMAINING ≥ threshold AND reset is within NUDGE_LEAD_MS — fires
//     for the "use it or lose it" scenario.

import { BrowserWindow, Notification, ipcMain } from 'electron';
import { logger } from '../../common/logger';
import { CodexUsageStatus, CodexUsageSnapshot, CodexUsageNudgeFlags } from '../../common/types';
import { CodexUsageConfig } from '../user-config';
import { readAccessToken } from './credentials';
import { parseUsageResponse } from './parse';

const ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';
// Weekly windows shift slowly — 10 min is the floor per spec.
const MIN_INTERVAL_MS = 10 * 60_000;
const RATE_LIMIT_CAP_MS = 60 * 60_000;
const UNAVAILABLE_BACKOFF_MS = 60 * 60_000;
// Same lead as the Claude poller — kept in sync for consistency.
const NUDGE_LEAD_MS = 30 * 60_000;

type WindowKey = 'primary' | 'secondary';
const WINDOW_KEYS: WindowKey[] = ['primary', 'secondary'];
const WINDOW_LABEL: Record<WindowKey, string> = {
  primary: 'primary',
  secondary: 'secondary',
};

export type CodexUsageStatusListener = (status: CodexUsageStatus) => void;

export class CodexUsagePoller {
  private status: CodexUsageStatus = { state: 'unknown' };
  private timer: NodeJS.Timeout | null = null;
  private config: CodexUsageConfig;
  private listeners: Set<CodexUsageStatusListener> = new Set();
  private lastCapNotified: Record<WindowKey, number> = { primary: 0, secondary: 0 };
  private lastNudgeNotified: Record<WindowKey, number> = { primary: 0, secondary: 0 };
  private currentDelayMs: number;
  private stopped = false;

  constructor(config: CodexUsageConfig) {
    this.config = config;
    this.currentDelayMs = Math.max(MIN_INTERVAL_MS, config.intervalMs);
  }

  public init() {
    ipcMain.handle('codex-usage:get-current', () => this.status);
    ipcMain.on('codex-usage:refresh-now', () => {
      logger.info('[CodexUsagePoller] manual refresh requested');
      this.refreshNow();
    });
  }

  public start() {
    if (!this.config.enabled) {
      logger.info('[CodexUsagePoller] disabled in config; not starting');
      return;
    }
    logger.info(
      `[CodexUsagePoller] starting, interval=${this.config.intervalMs}ms ` +
      `cap=${this.config.capWarning.enabled ? this.config.capWarning.threshold + '%' : 'off'} ` +
      `nudge=${this.config.nudge.enabled ? this.config.nudge.threshold + '%' : 'off'}`,
    );
    this.stopped = false;
    this.poll().catch((e) => logger.warn('[CodexUsagePoller] initial poll error:', e));
  }

  public stop() {
    logger.info('[CodexUsagePoller] stopping');
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public applyConfig(config: CodexUsageConfig) {
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
    this.poll().catch((e) => logger.warn('[CodexUsagePoller] refresh error:', e));
  }

  public getStatus(): CodexUsageStatus {
    return this.status;
  }

  public subscribe(listener: CodexUsageStatusListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async poll() {
    if (this.stopped || !this.config.enabled) return;

    const creds = await readAccessToken();
    if (!creds.ok) {
      logger.warn(`[CodexUsagePoller] credentials unavailable (${creds.reason}): ${creds.detail}`);
      this.setStatus({
        state: 'unauthenticated',
        message: 'No Codex credentials found. Sign in to Codex/ChatGPT, then click Refresh.',
      });
      return;
    }

    try {
      const res = await fetch(ENDPOINT, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${creds.token}`,
          'Accept': 'application/json',
        },
      });

      if (res.status === 401) {
        logger.warn('[CodexUsagePoller] 401 unauthorized — pausing until manual refresh');
        this.setStatus({
          state: 'unauthenticated',
          message: 'Codex token expired. Run any Codex command to refresh it, then click Refresh.',
        });
        return;
      }

      if (res.status === 429) {
        const next = Math.min(this.currentDelayMs * 2, RATE_LIMIT_CAP_MS);
        logger.warn(`[CodexUsagePoller] 429 rate-limited; backing off to ${next}ms`);
        this.setStatus({
          state: 'rate-limited',
          snapshot: this.status.snapshot,
          lastUpdated: this.status.lastUpdated,
          nudgeActive: this.status.nudgeActive,
          message: 'ChatGPT rate-limited the usage endpoint. Backing off.',
        });
        this.scheduleNext(next);
        return;
      }

      if (res.status === 404 || res.status === 400) {
        logger.warn(`[CodexUsagePoller] endpoint returned ${res.status}; treating as unavailable`);
        this.setStatus({
          state: 'unavailable',
          message: "ChatGPT's usage endpoint may have moved. Will retry in an hour.",
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
        return;
      }

      if (!res.ok) {
        logger.warn(`[CodexUsagePoller] HTTP ${res.status}; will retry`);
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
        logger.warn('[CodexUsagePoller] response shape unrecognized:', JSON.stringify(body)?.slice(0, 300));
        this.setStatus({
          state: 'unavailable',
          message: 'Codex usage endpoint returned an unexpected shape.',
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
      logger.warn('[CodexUsagePoller] network error:', e?.message ?? e);
      this.setStatus({
        state: 'network-error',
        snapshot: this.status.snapshot,
        lastUpdated: this.status.lastUpdated,
        nudgeActive: this.status.nudgeActive,
        message: 'Network error reaching the Codex usage endpoint.',
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
      this.poll().catch((e) => logger.warn('[CodexUsagePoller] poll error:', e));
    }, delayMs);
    this.timer.unref?.();
  }

  private setStatus(status: CodexUsageStatus) {
    this.status = status;
    this.broadcast();
  }

  private broadcast() {
    const windows = BrowserWindow.getAllWindows();
    logger.debug(`[CodexUsagePoller] broadcasting state=${this.status.state} to ${windows.length} window(s)`);
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('codex-usage:updated', this.status);
      }
    }
    for (const listener of this.listeners) {
      try { listener(this.status); }
      catch (e) { logger.warn('[CodexUsagePoller] listener threw:', e); }
    }
  }

  private evaluateAndNotify(snapshot: CodexUsageSnapshot): CodexUsageNudgeFlags {
    const flags: CodexUsageNudgeFlags = { primary: false, secondary: false };
    for (const key of WINDOW_KEYS) {
      const w = snapshot[key];
      if (!w) continue;
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
    if (this.lastCapNotified[key] === resetsAt) return;
    this.lastCapNotified[key] = resetsAt;
    try {
      new Notification({
        title: `Codex usage: ${Math.round(remaining)}% left`,
        body: `Your ${WINDOW_LABEL[key]} window is almost out. Resets ${formatRelative(resetsAt)}.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[CodexUsagePoller] cap notification failed:', e);
    }
  }

  private fireNudge(key: WindowKey, remaining: number, resetsAt: number) {
    if (this.lastNudgeNotified[key] === resetsAt) return;
    this.lastNudgeNotified[key] = resetsAt;
    try {
      new Notification({
        title: `${Math.round(remaining)}% Codex credit unused`,
        body: `Your ${WINDOW_LABEL[key]} window resets ${formatRelative(resetsAt)}. Use it before it's gone.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[CodexUsagePoller] nudge notification failed:', e);
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

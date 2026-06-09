// Polls GitHub Copilot usage and broadcasts the latest snapshot to renderer
// windows. Mirrors the Cursor poller (src/main/cursor-usage/poller.ts) in shape
// and recovery behavior, with two differences:
//
//   - Two-tier source. METADATA (username + SKU) is always read from VS Code's
//     local state.vscdb — no network, no keychain. When copilotUsage.liveQuota is
//     OFF (the default), we emit a metadata-only snapshot and stop there. When ON,
//     we additionally read the gho_ OAuth token from the OS keychain and GET the
//     undocumented api.github.com/copilot_internal/user endpoint for live quota.
//   - Up to three monthly-cycle quota windows (chat / completions / premium),
//     so notifications run per-window like the Codex poller's WINDOW_KEYS loop.
//
// Caveats (undocumented endpoint): wrap every call defensively, never crash on
// shape drift, and surface a degraded state instead.

import { BrowserWindow, Notification, ipcMain } from 'electron';
import { logger } from '../../common/logger';
import {
  CopilotUsageStatus,
  CopilotUsageSnapshot,
  CopilotUsageNudgeFlags,
  CopilotQuotaWindow,
} from '../../common/types';
import { CopilotUsageConfig } from '../user-config';
import { readCopilotMetadata } from './credentials';
import { readOAuthToken } from './keychain';
import { parseUsageResponse } from './parse';

const ENDPOINT = 'https://api.github.com/copilot_internal/user';
// Mimic the VS Code Copilot client headers (cosmetic — the endpoint accepts the
// bearer regardless, but we stay consistent with the real client).
const USER_AGENT = 'GithubCopilot/1.388.0';
const EDITOR_VERSION = 'vscode/1.123.0';

// Monthly quota changes slowly — 10 min is the floor.
const MIN_INTERVAL_MS = 10 * 60_000;
const RATE_LIMIT_CAP_MS = 60 * 60_000;
const UNAVAILABLE_BACKOFF_MS = 60 * 60_000;
// Same lead as the other pollers — kept in sync for consistency.
const NUDGE_LEAD_MS = 30 * 60_000;

// Only chat & completions get nudges (premium is opt-in paid; surface it in the
// UI but don't nag about it).
type NudgeKey = 'chat' | 'completions';
const NUDGE_KEYS: NudgeKey[] = ['chat', 'completions'];

export type CopilotUsageStatusListener = (status: CopilotUsageStatus) => void;

export class CopilotUsagePoller {
  private status: CopilotUsageStatus = { state: 'unknown' };
  private timer: NodeJS.Timeout | null = null;
  private config: CopilotUsageConfig;
  private listeners: Set<CopilotUsageStatusListener> = new Set();
  private lastCapNotified: Record<NudgeKey, number> = { chat: 0, completions: 0 };
  private lastNudgeNotified: Record<NudgeKey, number> = { chat: 0, completions: 0 };
  private currentDelayMs: number;
  private stopped = false;

  constructor(config: CopilotUsageConfig) {
    this.config = config;
    this.currentDelayMs = Math.max(MIN_INTERVAL_MS, config.intervalMs);
  }

  public init() {
    ipcMain.handle('copilot-usage:get-current', () => this.status);
    ipcMain.on('copilot-usage:refresh-now', () => {
      logger.info('[CopilotUsagePoller] manual refresh requested');
      this.refreshNow();
    });
  }

  public start() {
    if (!this.config.enabled) {
      logger.info('[CopilotUsagePoller] disabled in config; not starting');
      return;
    }
    logger.info(
      `[CopilotUsagePoller] starting, interval=${this.config.intervalMs}ms ` +
      `liveQuota=${this.config.liveQuota ? 'on' : 'off'} ` +
      `cap=${this.config.capWarning.enabled ? this.config.capWarning.threshold + '%' : 'off'} ` +
      `nudge=${this.config.nudge.enabled ? this.config.nudge.threshold + '%' : 'off'}`,
    );
    this.stopped = false;
    this.poll().catch((e) => logger.warn('[CopilotUsagePoller] initial poll error:', e));
  }

  public stop() {
    logger.info('[CopilotUsagePoller] stopping');
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public applyConfig(config: CopilotUsageConfig) {
    const wasEnabled = this.config.enabled;
    const wasLive = this.config.liveQuota;
    this.config = config;
    this.currentDelayMs = Math.max(MIN_INTERVAL_MS, config.intervalMs);

    if (!wasEnabled && this.config.enabled) {
      this.start();
    } else if (wasEnabled && !this.config.enabled) {
      this.stop();
      this.setStatus({ state: 'unknown', message: 'Tracking disabled.' });
    } else if (this.config.enabled) {
      // Toggling liveQuota should take effect promptly, not on the next slow tick.
      if (wasLive !== this.config.liveQuota) {
        this.refreshNow();
      } else if (this.status.state !== 'unauthenticated' && this.status.state !== 'unavailable') {
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
    this.poll().catch((e) => logger.warn('[CopilotUsagePoller] refresh error:', e));
  }

  public getStatus(): CopilotUsageStatus {
    return this.status;
  }

  public subscribe(listener: CopilotUsageStatusListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async poll() {
    if (this.stopped || !this.config.enabled) return;

    const meta = await readCopilotMetadata();
    if (!meta.ok) {
      logger.warn(`[CopilotUsagePoller] metadata unavailable (${meta.reason}): ${meta.detail}`);
      if (meta.reason === 'error') {
        this.setStatus({
          state: 'unavailable',
          message: 'Could not read VS Code Copilot state locally. Will retry.',
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
      } else {
        this.setStatus({
          state: 'unauthenticated',
          message: 'No Copilot session found. Sign in to GitHub in VS Code, then click Refresh.',
        });
      }
      return;
    }

    // Live quota is opt-in. When off, surface metadata only — no network, no keychain.
    if (!this.config.liveQuota) {
      this.setStatus({
        state: 'ok',
        snapshot: { username: meta.username, sku: meta.sku, quotas: [], source: 'metadata-only' },
        lastUpdated: Date.now(),
      });
      this.scheduleNext(Math.max(MIN_INTERVAL_MS, this.config.intervalMs));
      return;
    }

    const tok = await readOAuthToken(meta.username ?? '');
    if (!tok.ok) {
      logger.warn(`[CopilotUsagePoller] token unavailable (${tok.reason}): ${tok.detail}`);
      // Fall back to a metadata-only "ok" so the card still shows who's signed in,
      // with a message explaining why quota isn't live.
      this.setStatus({
        state: tok.reason === 'missing' ? 'unauthenticated' : 'unavailable',
        snapshot: { username: meta.username, sku: meta.sku, quotas: [], source: 'metadata-only' },
        lastUpdated: Date.now(),
        message: tok.detail,
      });
      this.scheduleNext(tok.reason === 'missing' ? Math.max(MIN_INTERVAL_MS, this.config.intervalMs) : UNAVAILABLE_BACKOFF_MS);
      return;
    }

    try {
      const res = await fetch(ENDPOINT, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tok.token}`,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          'Editor-Version': EDITOR_VERSION,
        },
      });

      if (res.status === 401) {
        logger.warn('[CopilotUsagePoller] 401 unauthorized — token expired/rotated');
        this.setStatus({
          state: 'unauthenticated',
          snapshot: { username: meta.username, sku: meta.sku, quotas: [], source: 'metadata-only' },
          lastUpdated: Date.now(),
          message: 'GitHub token expired. Sign in to GitHub in VS Code to refresh it, then click Refresh.',
        });
        return;
      }

      if (res.status === 429) {
        const next = Math.min(this.currentDelayMs * 2, RATE_LIMIT_CAP_MS);
        logger.warn(`[CopilotUsagePoller] 429 rate-limited; backing off to ${next}ms`);
        this.setStatus({
          state: 'rate-limited',
          snapshot: this.status.snapshot,
          lastUpdated: this.status.lastUpdated,
          nudgeActive: this.status.nudgeActive,
          message: 'GitHub rate-limited the usage endpoint. Backing off.',
        });
        this.scheduleNext(next);
        return;
      }

      if (res.status === 404 || res.status === 400) {
        logger.warn(`[CopilotUsagePoller] endpoint returned ${res.status}; treating as unavailable`);
        this.setStatus({
          state: 'unavailable',
          snapshot: { username: meta.username, sku: meta.sku, quotas: [], source: 'metadata-only' },
          lastUpdated: Date.now(),
          message: "Copilot's usage endpoint may have moved. Will retry in an hour.",
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
        return;
      }

      if (!res.ok) {
        logger.warn(`[CopilotUsagePoller] HTTP ${res.status}; will retry`);
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
      const parsed = parseUsageResponse(body);
      if (!parsed) {
        logger.warn('[CopilotUsagePoller] response shape unrecognized:', JSON.stringify(body)?.slice(0, 300));
        this.setStatus({
          state: 'unavailable',
          snapshot: { username: meta.username, sku: meta.sku, quotas: [], source: 'metadata-only' },
          lastUpdated: Date.now(),
          message: 'Copilot usage endpoint returned an unexpected shape.',
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
        return;
      }

      // Prefer local metadata for username/SKU (already trimmed); response fills gaps.
      const snapshot: CopilotUsageSnapshot = {
        ...parsed,
        username: meta.username ?? parsed.username,
        sku: meta.sku ?? parsed.sku,
      };

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
      logger.warn('[CopilotUsagePoller] network error:', e?.message ?? e);
      this.setStatus({
        state: 'network-error',
        snapshot: this.status.snapshot,
        lastUpdated: this.status.lastUpdated,
        nudgeActive: this.status.nudgeActive,
        message: 'Network error reaching the Copilot usage endpoint.',
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
      this.poll().catch((e) => logger.warn('[CopilotUsagePoller] poll error:', e));
    }, delayMs);
    this.timer.unref?.();
  }

  private setStatus(status: CopilotUsageStatus) {
    this.status = status;
    this.broadcast();
  }

  private broadcast() {
    const windows = BrowserWindow.getAllWindows();
    logger.debug(`[CopilotUsagePoller] broadcasting state=${this.status.state} to ${windows.length} window(s)`);
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('copilot-usage:updated', this.status);
      }
    }
    for (const listener of this.listeners) {
      try { listener(this.status); }
      catch (e) { logger.warn('[CopilotUsagePoller] listener threw:', e); }
    }
  }

  private evaluateAndNotify(snapshot: CopilotUsageSnapshot): CopilotUsageNudgeFlags {
    const flags: CopilotUsageNudgeFlags = { chat: false, completions: false };
    for (const key of NUDGE_KEYS) {
      const w = snapshot.quotas.find((q) => q.key === key);
      if (!w || w.unlimited) continue;
      const remaining = 100 - w.utilization;
      const msUntilReset = w.resetsAt - Date.now();

      if (this.config.capWarning.enabled && remaining <= this.config.capWarning.threshold) {
        this.fireCapWarning(key, w, remaining);
      }

      const nudgeCondition =
        this.config.nudge.enabled &&
        remaining >= this.config.nudge.threshold &&
        msUntilReset > 0 &&
        msUntilReset <= NUDGE_LEAD_MS;

      if (nudgeCondition) {
        flags[key] = true;
        this.fireNudge(key, w, remaining);
      }
    }
    return flags;
  }

  private fireCapWarning(key: NudgeKey, w: CopilotQuotaWindow, remaining: number) {
    if (this.lastCapNotified[key] === w.resetsAt) return;
    this.lastCapNotified[key] = w.resetsAt;
    try {
      new Notification({
        title: `Copilot ${w.label}: ${Math.round(remaining)}% left`,
        body: `Your monthly ${w.label.toLowerCase()} quota is almost out. Resets ${formatRelative(w.resetsAt)}.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[CopilotUsagePoller] cap notification failed:', e);
    }
  }

  private fireNudge(key: NudgeKey, w: CopilotQuotaWindow, remaining: number) {
    if (this.lastNudgeNotified[key] === w.resetsAt) return;
    this.lastNudgeNotified[key] = w.resetsAt;
    try {
      new Notification({
        title: `${Math.round(remaining)}% Copilot ${w.label} unused`,
        body: `Your monthly ${w.label.toLowerCase()} quota resets ${formatRelative(w.resetsAt)}. Use it before it's gone.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[CopilotUsagePoller] nudge notification failed:', e);
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

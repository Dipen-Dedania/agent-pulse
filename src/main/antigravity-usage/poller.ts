// Polls the Antigravity IDE's local language-server endpoint
// (https://127.0.0.1:5362/.../GetAvailableModels) at a user-configurable
// interval and broadcasts the latest snapshot to renderer windows.
//
// This differs from the Codex/Claude pollers in three ways:
//   1. The endpoint is LOCAL — it only exists while the IDE is running.
//      An ECONNREFUSED is the steady state when the IDE is closed, so we
//      treat it as `unavailable` with a fast retry (LOCAL_DOWN_BACKOFF_MS)
//      rather than escalating like a real network error.
//   2. Transport is gRPC-Web over a self-signed HTTPS cert; we use
//      `rejectUnauthorized: false` and frame the request/response manually.
//   3. The response carries quotas for many models. We evaluate cap and
//      nudge notifications per model, deduped by model+resetsAt.

import { BrowserWindow, Notification, ipcMain } from 'electron';
import https from 'https';
import { logger } from '../../common/logger';
import {
  AntigravityUsageStatus,
  AntigravityUsageSnapshot,
  AntigravityUsageNudgeFlags,
  AntigravityModelWindow,
} from '../../common/types';
import { AntigravityUsageConfig } from '../user-config';
import { readCsrfToken } from './credentials';
import { parseModelsResponse } from './parse';
import { encodeJsonRequest, extractJsonData, extractTrailers } from './grpc-web';

const HOST = '127.0.0.1';
const PORT = 5362;
const RPC_PATH = '/exa.language_server_pb.LanguageServerService/GetAvailableModels';
const ENDPOINT_URL = `https://${HOST}:${PORT}${RPC_PATH}`;

const MIN_INTERVAL_MS = 60_000;
const RATE_LIMIT_CAP_MS = 60 * 60_000;
const UNAVAILABLE_BACKOFF_MS = 60 * 60_000;
// IDE is likely just closed — retry on this cadence so we recover quickly.
const LOCAL_DOWN_BACKOFF_MS = 2 * 60_000;
const NUDGE_LEAD_MS = 30 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

export class AntigravityUsagePoller {
  private status: AntigravityUsageStatus = { state: 'unknown' };
  private timer: NodeJS.Timeout | null = null;
  private config: AntigravityUsageConfig;
  // Keyed by `${modelKey}:${resetsAt}` — fires once per window per model.
  private lastCapNotified = new Set<string>();
  private lastNudgeNotified = new Set<string>();
  private currentDelayMs: number;
  private stopped = false;

  constructor(config: AntigravityUsageConfig) {
    this.config = config;
    this.currentDelayMs = Math.max(MIN_INTERVAL_MS, config.intervalMs);
  }

  public init() {
    ipcMain.handle('antigravity-usage:get-current', () => this.status);
    ipcMain.on('antigravity-usage:refresh-now', () => {
      logger.info('[AntigravityUsagePoller] manual refresh requested');
      this.refreshNow();
    });
  }

  public start() {
    if (!this.config.enabled) {
      logger.info('[AntigravityUsagePoller] disabled in config; not starting');
      return;
    }
    logger.info(
      `[AntigravityUsagePoller] starting, interval=${this.config.intervalMs}ms ` +
      `cap=${this.config.capWarning.enabled ? this.config.capWarning.threshold + '%' : 'off'} ` +
      `nudge=${this.config.nudge.enabled ? this.config.nudge.threshold + '%' : 'off'}`,
    );
    this.stopped = false;
    this.poll().catch((e) => logger.warn('[AntigravityUsagePoller] initial poll error:', e));
  }

  public stop() {
    logger.info('[AntigravityUsagePoller] stopping');
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  public applyConfig(config: AntigravityUsageConfig) {
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
    this.poll().catch((e) => logger.warn('[AntigravityUsagePoller] refresh error:', e));
  }

  public getStatus(): AntigravityUsageStatus {
    return this.status;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async poll() {
    if (this.stopped || !this.config.enabled) return;

    const creds = await readCsrfToken();
    if (!creds.ok) {
      logger.warn(`[AntigravityUsagePoller] credentials unavailable (${creds.reason}): ${creds.detail}`);
      this.setStatus({
        state: 'unauthenticated',
        message: 'Could not find a CSRF token in the Antigravity log. Restart the IDE so it writes a fresh one.',
      });
      // Retry on the normal interval — a token will appear as soon as the
      // IDE starts and writes its Args line.
      this.scheduleNext(Math.max(60_000, this.config.intervalMs));
      return;
    }

    try {
      const { status, body } = await this.request(creds.token);

      if (status === 401 || status === 403) {
        logger.warn(`[AntigravityUsagePoller] ${status} unauthorized — pausing until manual refresh`);
        this.setStatus({
          state: 'unauthenticated',
          message: 'Antigravity rejected the CSRF token. Update it and click Refresh.',
        });
        return;
      }

      if (status === 429) {
        const next = Math.min(this.currentDelayMs * 2, RATE_LIMIT_CAP_MS);
        logger.warn(`[AntigravityUsagePoller] 429 rate-limited; backing off to ${next}ms`);
        this.setStatus({
          state: 'rate-limited',
          snapshot: this.status.snapshot,
          lastUpdated: this.status.lastUpdated,
          nudgeActive: this.status.nudgeActive,
          message: 'Antigravity rate-limited the usage endpoint. Backing off.',
        });
        this.scheduleNext(next);
        return;
      }

      if (status === 404 || status === 400) {
        logger.warn(`[AntigravityUsagePoller] endpoint returned ${status}; treating as unavailable`);
        this.setStatus({
          state: 'unavailable',
          message: "Antigravity's usage endpoint may have moved. Will retry in an hour.",
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
        return;
      }

      if (status < 200 || status >= 300) {
        logger.warn(`[AntigravityUsagePoller] HTTP ${status}; will retry`);
        this.setStatus({
          state: 'network-error',
          snapshot: this.status.snapshot,
          lastUpdated: this.status.lastUpdated,
          nudgeActive: this.status.nudgeActive,
          message: `Antigravity returned HTTP ${status}.`,
        });
        this.scheduleNext(Math.max(MIN_INTERVAL_MS, this.config.intervalMs));
        return;
      }

      // Even on a 200, a non-zero gRPC status in the trailer means logical failure.
      const trailers = extractTrailers(body);
      const grpcStatus = trailers['grpc-status'];
      if (grpcStatus && grpcStatus !== '0') {
        const msg = trailers['grpc-message'] || `grpc-status=${grpcStatus}`;
        logger.warn(`[AntigravityUsagePoller] gRPC error: ${msg}`);
        this.setStatus({
          state: 'unavailable',
          message: `Antigravity returned a gRPC error: ${msg}`,
        });
        this.scheduleNext(UNAVAILABLE_BACKOFF_MS);
        return;
      }

      const json = extractJsonData(body);
      const snapshot = parseModelsResponse(json);
      if (!snapshot) {
        const preview = JSON.stringify(json)?.slice(0, 300);
        logger.warn('[AntigravityUsagePoller] response shape unrecognized:', preview);
        this.setStatus({
          state: 'unavailable',
          message: 'Antigravity usage endpoint returned an unexpected shape.',
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
      const code = e?.code ?? '';
      if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EHOSTUNREACH') {
        // Steady state when the IDE is closed — don't escalate, just retry fast.
        logger.debug(`[AntigravityUsagePoller] IDE appears to be closed (${code}); retry in ${LOCAL_DOWN_BACKOFF_MS}ms`);
        this.setStatus({
          state: 'unavailable',
          snapshot: this.status.snapshot,
          lastUpdated: this.status.lastUpdated,
          nudgeActive: this.status.nudgeActive,
          message: 'Antigravity IDE is not running. Waiting for it to come back.',
        });
        this.scheduleNext(LOCAL_DOWN_BACKOFF_MS);
        return;
      }
      logger.warn('[AntigravityUsagePoller] network error:', e?.message ?? e);
      this.setStatus({
        state: 'network-error',
        snapshot: this.status.snapshot,
        lastUpdated: this.status.lastUpdated,
        nudgeActive: this.status.nudgeActive,
        message: 'Network error reaching the Antigravity usage endpoint.',
      });
      this.scheduleNext(Math.max(MIN_INTERVAL_MS, this.config.intervalMs));
    }
  }

  private request(csrfToken: string): Promise<{ status: number; body: Buffer }> {
    return new Promise((resolve, reject) => {
      const payload = encodeJsonRequest({});
      const req = https.request(
        {
          host: HOST,
          port: PORT,
          path: RPC_PATH,
          method: 'POST',
          rejectUnauthorized: false, // self-signed cert on localhost
          timeout: REQUEST_TIMEOUT_MS,
          headers: {
            'accept': '*/*',
            'accept-language': 'en-US',
            'content-type': 'application/grpc-web+json',
            'content-length': payload.length.toString(),
            'origin': `https://${HOST}:${PORT}`,
            'x-codeium-csrf-token': csrfToken,
            'x-grpc-web': '1',
            'x-user-agent': 'CONNECT_ES_USER_AGENT',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) });
          });
          res.on('error', reject);
        },
      );
      req.on('timeout', () => {
        req.destroy(Object.assign(new Error('request timed out'), { code: 'ETIMEDOUT' }));
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  private scheduleNext(delayMs: number) {
    if (this.stopped || !this.config.enabled) return;
    this.currentDelayMs = delayMs;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.poll().catch((e) => logger.warn('[AntigravityUsagePoller] poll error:', e));
    }, delayMs);
    this.timer.unref?.();
  }

  private setStatus(status: AntigravityUsageStatus) {
    this.status = status;
    this.broadcast();
  }

  private broadcast() {
    const windows = BrowserWindow.getAllWindows();
    logger.debug(`[AntigravityUsagePoller] broadcasting state=${this.status.state} to ${windows.length} window(s)`);
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send('antigravity-usage:updated', this.status);
      }
    }
  }

  private evaluateAndNotify(snapshot: AntigravityUsageSnapshot): AntigravityUsageNudgeFlags {
    const flags: AntigravityUsageNudgeFlags = {};
    for (const model of snapshot.models) {
      const remaining = 100 - model.utilization;
      const msUntilReset = model.resetsAt - Date.now();

      if (this.config.capWarning.enabled && remaining <= this.config.capWarning.threshold) {
        this.fireCapWarning(model, remaining);
      }

      const nudgeCondition =
        this.config.nudge.enabled &&
        remaining >= this.config.nudge.threshold &&
        msUntilReset > 0 &&
        msUntilReset <= NUDGE_LEAD_MS;

      if (nudgeCondition) {
        flags[model.modelKey] = true;
        this.fireNudge(model, remaining);
      }
    }
    return flags;
  }

  private fireCapWarning(model: AntigravityModelWindow, remaining: number) {
    const key = `${model.modelKey}:${model.resetsAt}`;
    if (this.lastCapNotified.has(key)) return;
    this.lastCapNotified.add(key);
    try {
      new Notification({
        title: `${model.displayName}: ${Math.round(remaining)}% left`,
        body: `Antigravity quota is almost out. Resets ${formatRelative(model.resetsAt)}.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[AntigravityUsagePoller] cap notification failed:', e);
    }
  }

  private fireNudge(model: AntigravityModelWindow, remaining: number) {
    const key = `${model.modelKey}:${model.resetsAt}`;
    if (this.lastNudgeNotified.has(key)) return;
    this.lastNudgeNotified.add(key);
    try {
      new Notification({
        title: `${Math.round(remaining)}% ${model.displayName} unused`,
        body: `Resets ${formatRelative(model.resetsAt)}. Use it before it's gone.`,
        silent: false,
      }).show();
    } catch (e) {
      logger.warn('[AntigravityUsagePoller] nudge notification failed:', e);
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

// Suppress an unused-export warning for the URL constant; it's documentation
// for the endpoint location and may be useful for diagnostics later.
void ENDPOINT_URL;

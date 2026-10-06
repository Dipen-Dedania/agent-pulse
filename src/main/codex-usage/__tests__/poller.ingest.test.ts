import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodexUsageSnapshot, CodexUsageStatus } from '../../../common/types';

const sentToWindows: CodexUsageStatus[] = [];
const notifications: Array<{ title: string; body: string }> = [];

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (_ch: string, status: CodexUsageStatus) => sentToWindows.push(status) },
      },
    ],
  },
  Notification: class {
    constructor(opts: { title: string; body: string }) { notifications.push(opts); }
    show() { /* no-op */ }
  },
  ipcMain: { handle: () => {}, on: () => {} },
}));

vi.mock('../credentials', () => ({
  readAccessToken: async () => ({ ok: true, token: 'test-token' }),
}));

import { CodexUsagePoller } from '../poller';
import { CodexUsageConfig } from '../../user-config';

const config = (over: Partial<CodexUsageConfig> = {}): CodexUsageConfig => ({
  enabled: true,
  intervalMs: 600_000,
  showSecondaryBar: true,
  capWarning: { enabled: false, threshold: 10 },
  nudge: { enabled: false, threshold: 50 },
  ...over,
});

const snapshot = (primaryUtil: number, secondaryUtil = 14): CodexUsageSnapshot => ({
  primary: { utilization: primaryUtil, resetsAt: Date.now() + 3_600_000, windowSeconds: 18000 },
  secondary: { utilization: secondaryUtil, resetsAt: Date.now() + 6 * 86_400_000, windowSeconds: 604800 },
  planType: 'team',
  limitReached: false,
  source: 'rollout',
});

describe('CodexUsagePoller.ingestExternal', () => {
  beforeEach(() => {
    sentToWindows.length = 0;
    notifications.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sets ok status and reaches subscribers and windows', () => {
    const poller = new CodexUsagePoller(config());
    const seen: CodexUsageStatus[] = [];
    poller.subscribe((s) => seen.push(s));

    const snap = snapshot(25);
    poller.ingestExternal(snap);

    expect(poller.getStatus().state).toBe('ok');
    expect(poller.getStatus().snapshot).toEqual(snap);
    expect(poller.getStatus().lastUpdated).toBe(Date.now());
    expect(seen).toHaveLength(1);
    expect(sentToWindows).toHaveLength(1);
  });

  it('dedupes identical snapshots within the min interval, passes changed ones', () => {
    const poller = new CodexUsagePoller(config());
    const seen: CodexUsageStatus[] = [];
    poller.subscribe((s) => seen.push(s));

    const snap = snapshot(25);
    poller.ingestExternal(snap);
    poller.ingestExternal({ ...snap });          // identical, immediately after
    expect(seen).toHaveLength(1);

    poller.ingestExternal(snapshot(26));          // changed utilization → broadcast
    expect(seen).toHaveLength(2);

    vi.advanceTimersByTime(16_000);
    poller.ingestExternal(snapshot(26));          // identical but interval elapsed
    expect(seen).toHaveLength(3);
  });

  it('is a no-op when tracking is disabled or after stop()', () => {
    const disabled = new CodexUsagePoller(config({ enabled: false }));
    disabled.ingestExternal(snapshot(25));
    expect(disabled.getStatus().state).toBe('unknown');

    const stopped = new CodexUsagePoller(config());
    stopped.stop();
    stopped.ingestExternal(snapshot(25));
    expect(stopped.getStatus().state).toBe('unknown');
    expect(sentToWindows).toHaveLength(0);
  });

  it('ignores a push sampled before the freshness window or before the current snapshot', () => {
    const poller = new CodexUsagePoller(config());
    const seen: CodexUsageStatus[] = [];
    poller.subscribe((s) => seen.push(s));

    // Yesterday's rollout tail replayed after a restart.
    poller.ingestExternal(snapshot(80), Date.now() - 24 * 3_600_000);
    expect(poller.getStatus().state).toBe('unknown');
    expect(seen).toHaveLength(0);

    // Live push lands.
    poller.ingestExternal(snapshot(25));
    expect(seen).toHaveLength(1);

    // A row stamped before the snapshot we already hold must not regress it.
    poller.ingestExternal(snapshot(90), Date.now() - 60_000);
    expect(poller.getStatus().snapshot?.primary.utilization).toBe(25);
    expect(seen).toHaveLength(1);
  });

  it('carries HTTP-only fields forward from the last poll and replaces the windows', async () => {
    const httpBody = {
      plan_type: 'team',
      rate_limit: {
        limit_reached: false,
        primary_window: { used_percent: 50, limit_window_seconds: 18000, reset_at: Math.floor(Date.now() / 1000) + 3600 },
        secondary_window: { used_percent: 5, limit_window_seconds: 604800, reset_at: Math.floor(Date.now() / 1000) + 86400 },
      },
      code_review_rate_limit: { primary_window: { used_percent: 7, reset_at: Math.floor(Date.now() / 1000) + 86400 } },
      model_usage: { 'gpt-6-astra': { available: true, available_at: null, credits_would_enable: false } },
      credits: { has_credits: false, unlimited: false, overage_limit_reached: false, balance: null },
      spend_control: { reached: false },
      rate_limit_reached_type: null,
    };
    vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      status: 200, ok: true, json: async () => httpBody,
    } as any);
    const poller = new CodexUsagePoller(config());
    poller.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(poller.getStatus().snapshot?.source).toBe('http');
    expect(poller.getStatus().snapshot?.models).toHaveLength(1);

    vi.advanceTimersByTime(1_000);
    poller.ingestExternal(snapshot(60));
    const merged = poller.getStatus().snapshot!;
    expect(merged.source).toBe('rollout');
    expect(merged.primary.utilization).toBe(60);
    expect(merged.models).toEqual([{ model: 'gpt-6-astra', available: true, creditsWouldEnable: false }]);
    expect(merged.review?.utilization).toBe(7);

    poller.stop();
  });

  it('suppresses HTTP polling while pushes are fresh; refreshNow overrides', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      status: 200, ok: true, json: async () => ({}),
    } as any);
    const poller = new CodexUsagePoller(config());

    poller.ingestExternal(snapshot(25));
    poller.start();                       // initial poll fires immediately…
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).not.toHaveBeenCalled(); // …but skips the endpoint (fresh push)

    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchSpy).not.toHaveBeenCalled();

    poller.refreshNow();
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).toHaveBeenCalled();

    poller.stop();
  });

  it('rearms the poll after a 401 so unauthenticated resurfaces once pushes stop', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      status: 401, ok: false,
    } as any);
    const poller = new CodexUsagePoller(config());

    poller.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(poller.getStatus().state).toBe('unauthenticated');

    poller.ingestExternal(snapshot(25));
    expect(poller.getStatus().state).toBe('ok');

    // Pushes stop. Polls skip while fresh (5 min), then the 10-minute cadence
    // runs a real poll and the 401 resurfaces.
    await vi.advanceTimersByTimeAsync(25 * 60_000);
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(poller.getStatus().state).toBe('unauthenticated');

    poller.stop();
  });

  it('names the window by its length in cap-warning copy', () => {
    const poller = new CodexUsagePoller(config({ capWarning: { enabled: true, threshold: 20 } }));
    poller.ingestExternal(snapshot(90, 95));
    const bodies = notifications.map((n) => n.body);
    expect(bodies.some((b) => b.includes('Your 5-hour window is almost out'))).toBe(true);
    expect(bodies.some((b) => b.includes('Your weekly window is almost out'))).toBe(true);
  });

  it('falls back to the key name when the window length is unknown', () => {
    const poller = new CodexUsagePoller(config({ capWarning: { enabled: true, threshold: 20 } }));
    poller.ingestExternal({
      primary: { utilization: 95, resetsAt: Date.now() + 60_000 },
      limitReached: false,
    });
    expect(notifications[0]?.body).toContain('Your primary window is almost out');
  });

  it('fires a limit-reached toast once per reset, gated by the cap-warning toggle', () => {
    const poller = new CodexUsagePoller(config({ capWarning: { enabled: true, threshold: 5 } }));
    const hit: CodexUsageSnapshot = {
      ...snapshot(100, 20),
      limitReached: true,
      limitReachedType: 'primary',
    };
    poller.ingestExternal(hit);
    poller.ingestExternal({ ...hit, primary: { ...hit.primary, utilization: 100 } });
    const limitToasts = notifications.filter((n) => n.title === 'Codex limit reached');
    expect(limitToasts).toHaveLength(1);
    expect(limitToasts[0].body).toContain('5-hour limit hit on your team plan');

    const off = new CodexUsagePoller(config({ capWarning: { enabled: false, threshold: 5 } }));
    notifications.length = 0;
    off.ingestExternal(hit);
    expect(notifications.filter((n) => n.title === 'Codex limit reached')).toHaveLength(0);
  });
});

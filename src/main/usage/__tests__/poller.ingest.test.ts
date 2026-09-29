import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UsageSnapshot, UsageStatus } from '../../../common/types';

const sentToWindows: UsageStatus[] = [];

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (_ch: string, status: UsageStatus) => sentToWindows.push(status) },
      },
    ],
  },
  Notification: class {
    show() { /* no-op */ }
  },
  ipcMain: { handle: () => {}, on: () => {} },
}));

vi.mock('../credentials', () => ({
  readAccessToken: async () => ({ ok: true, token: 'test-token' }),
}));

import { UsagePoller } from '../poller';
import { UsageConfig } from '../../user-config';

const config = (over: Partial<UsageConfig> = {}): UsageConfig => ({
  enabled: true,
  intervalMs: 60_000,
  showSevenDayBar: true,
  capWarning: { enabled: false, threshold: 10 },
  nudge: { enabled: false, threshold: 50 },
  ...over,
});

const snapshot = (fiveUtil: number, sevenUtil = 40): UsageSnapshot => ({
  fiveHour: { utilization: fiveUtil, resetsAt: Date.now() + 3_600_000 },
  sevenDay: { utilization: sevenUtil, resetsAt: Date.now() + 86_400_000 },
});

describe('UsagePoller.ingestExternal', () => {
  beforeEach(() => {
    sentToWindows.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sets ok status and reaches subscribers and windows', () => {
    const poller = new UsagePoller(config());
    const seen: UsageStatus[] = [];
    poller.subscribe((s) => seen.push(s));

    const snap = snapshot(25);
    poller.ingestExternal(snap);

    expect(poller.getStatus().state).toBe('ok');
    expect(poller.getStatus().snapshot).toEqual(snap);
    expect(seen).toHaveLength(1);
    expect(sentToWindows).toHaveLength(1);
  });

  it('dedupes identical snapshots within the min interval, passes changed ones', () => {
    const poller = new UsagePoller(config());
    const seen: UsageStatus[] = [];
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

  it('is a no-op when tracking is disabled', () => {
    const poller = new UsagePoller(config({ enabled: false }));
    poller.ingestExternal(snapshot(25));
    expect(poller.getStatus().state).toBe('unknown');
    expect(sentToWindows).toHaveLength(0);
  });

  it('suppresses HTTP polling while pushes are fresh; refreshNow overrides', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      status: 200, ok: true, json: async () => ({}),
    } as any);
    const poller = new UsagePoller(config());

    poller.ingestExternal(snapshot(25));
    poller.start();                       // initial poll fires immediately…
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).not.toHaveBeenCalled(); // …but skips the endpoint (fresh push)

    // Well within the 5-minute freshness window: scheduled polls also skip.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Manual refresh clears freshness and hits the endpoint.
    poller.refreshNow();
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).toHaveBeenCalled();

    poller.stop();
  });

  it('is a no-op after stop()', () => {
    const poller = new UsagePoller(config());
    poller.stop();
    poller.ingestExternal(snapshot(25));
    expect(poller.getStatus().state).toBe('unknown');
    expect(sentToWindows).toHaveLength(0);
  });

  it('rearms the poll after a 401 so unauthenticated resurfaces once pushes stop', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
      status: 401, ok: false,
    } as any);
    const poller = new UsagePoller(config());

    // Initial poll hits the endpoint, gets 401 → paused with no timer armed.
    poller.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(poller.getStatus().state).toBe('unauthenticated');

    // A statusline push shows genuine data and rearms the poll timer.
    poller.ingestExternal(snapshot(25));
    expect(poller.getStatus().state).toBe('ok');

    // Pushes stop. Scheduled polls skip while the push is fresh, then one
    // real poll runs, hits the 401 again, and the paused state resurfaces.
    await vi.advanceTimersByTimeAsync(7 * 60_000);
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(poller.getStatus().state).toBe('unauthenticated');

    poller.stop();
  });
});

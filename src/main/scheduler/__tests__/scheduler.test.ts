import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodexUsageStatus, SchedulerStatus, UsageStatus } from '../../../common/types';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  sent: [] as Array<{ channel: string; status: SchedulerStatus }>,
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, status: SchedulerStatus) => ipc.sent.push({ channel, status }) },
      },
    ],
  },
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => { ipc.handlers.set(channel, fn); },
    on: () => {},
  },
}));

import { Scheduler, SchedulerDeps, claudeSchedulerDeps } from '../scheduler';
import { codexSchedulerDeps } from '../codex-provider';
import { SchedulerConfig } from '../../user-config';

const config = (over: Partial<SchedulerConfig> = {}): SchedulerConfig => ({
  mode: 'off',
  fixed: [],
  adaptive: { workHours: { start: '09:00', end: '18:00' }, maxWindowsPerDay: 3 },
  tokenNudge: { enabled: true, leadMs: 120_000 },
  maxOpenersPerDay: 6,
  ...over,
});

/** A controllable usage source + deps, so the engine can be driven directly. */
function fakeDeps<S>(over: Partial<SchedulerDeps<S>> = {}) {
  let listener: ((s: S) => void) | null = null;
  const fire = vi.fn(async () => ({ ok: true }));
  const refreshNow = vi.fn();
  const deps: SchedulerDeps<S> = {
    usageSource: {
      getStatus: () => ({ state: 'unknown' } as unknown as S),
      subscribe: (l) => { listener = l; return () => { listener = null; }; },
      refreshNow,
    },
    anchorResetsAt: () => null,
    readExpiry: async () => null,
    fire,
    ipcPrefix: 'test-scheduler',
    logTag: '[Test]',
    ...over,
  };
  return { deps, fire, refreshNow, push: (s: S) => listener?.(s) };
}

const flush = () => new Promise((r) => setTimeout(r, 5));

describe('Scheduler (generic engine)', () => {
  beforeEach(() => {
    ipc.handlers.clear();
    ipc.sent.length = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers IPC channels and broadcasts under the deps prefix', async () => {
    const { deps } = fakeDeps<UsageStatus>({ ipcPrefix: 'scheduler' });
    const s = new Scheduler(config(), deps);
    s.init();
    expect([...ipc.handlers.keys()]).toEqual(['scheduler:get-current', 'scheduler:test-opener']);
    s.start();
    await flush();
    expect(ipc.sent[0]?.channel).toBe('scheduler:updated');
    s.stop();
  });

  it('uses the prefix for a second instance without colliding', async () => {
    const { deps } = fakeDeps<CodexUsageStatus>({ ipcPrefix: 'codex-scheduler' });
    const s = new Scheduler(config(), deps);
    s.init();
    expect(ipc.handlers.has('codex-scheduler:get-current')).toBe(true);
    expect(ipc.handlers.has('codex-scheduler:test-opener')).toBe(true);
    s.start();
    await flush();
    expect(ipc.sent.every((m) => m.channel === 'codex-scheduler:updated')).toBe(true);
    s.stop();
  });

  it('tracks the anchor reset from usage pushes', async () => {
    const resetsAt = Date.now() + 3_600_000;
    const { deps, push } = fakeDeps<UsageStatus>({
      anchorResetsAt: (s) => (s.state === 'ok' && s.snapshot ? s.snapshot.fiveHour.resetsAt : null),
    });
    const s = new Scheduler(config(), deps);
    s.start();
    await flush();
    expect(s.getStatus().windowResetsAt).toBeNull();
    push({ state: 'ok', snapshot: { fiveHour: { utilization: 1, resetsAt }, sevenDay: { utilization: 1, resetsAt } } });
    await flush();
    expect(s.getStatus().windowResetsAt).toBe(resetsAt);
    s.stop();
  });

  it('manual test ping bypasses shouldSkipOpener, counts toward the cap, and refreshes the source', async () => {
    const { deps, fire, refreshNow } = fakeDeps<UsageStatus>({ shouldSkipOpener: () => true });
    const s = new Scheduler(config(), deps);
    s.init();
    s.start();
    await flush();
    const test = ipc.handlers.get('test-scheduler:test-opener')!;
    const run = await test();
    expect(run).toMatchObject({ kind: 'opener', ok: true });
    expect(fire).toHaveBeenCalledTimes(1);
    expect(refreshNow).toHaveBeenCalledTimes(1);
    expect(s.getStatus().openersToday).toBe(1);
    s.stop();
  });

  it('does not count a failed opener toward the cap and surfaces the reason', async () => {
    const { deps } = fakeDeps<UsageStatus>({ fire: async () => ({ ok: false, reason: 'codex CLI not found on PATH' }) });
    const s = new Scheduler(config(), deps);
    s.init();
    s.start();
    await flush();
    const run = await ipc.handlers.get('test-scheduler:test-opener')!();
    expect(run).toMatchObject({ ok: false, reason: 'codex CLI not found on PATH' });
    expect(s.getStatus().openersToday).toBe(0);
    expect(s.getStatus().lastRun?.reason).toBe('codex CLI not found on PATH');
    s.stop();
  });

  it('schedules a nudge from readExpiry and nothing when expiry is unknown', async () => {
    const soon = Date.now() + 10 * 60_000;
    const withExpiry = fakeDeps<UsageStatus>({ readExpiry: async () => soon });
    const a = new Scheduler(config(), withExpiry.deps);
    a.start();
    await flush();
    expect(a.getStatus().nextEventKind).toBe('nudge');
    expect(a.getStatus().nextFireAt).toBe(soon - 120_000);
    a.stop();

    const noExpiry = fakeDeps<UsageStatus>();
    const b = new Scheduler(config(), noExpiry.deps);
    b.start();
    await flush();
    expect(b.getStatus().nextEventKind).toBeNull();
    b.stop();
  });

  it('fires a nudge once per expiry and does not spin when the expiry stays in the past', async () => {
    // Expired token + a ping that fails (e.g. CLI missing) → expiresAt never
    // moves. Before the guard this re-armed a 0ms timer after every fire.
    const past = Date.now() - 60_000;
    const { deps } = fakeDeps<UsageStatus>({
      readExpiry: async () => past,
      fire: vi.fn(async () => ({ ok: false, reason: 'codex CLI not found on PATH' })),
    });
    const s = new Scheduler(config(), deps);
    s.start();
    await flush();
    await flush();
    expect(deps.fire).toHaveBeenCalledTimes(1);
    expect(s.getStatus().lastRun?.kind).toBe('nudge');
    expect(s.getStatus().nextEventKind).toBeNull();
    expect(s.getStatus().nextFireAt).toBeNull();
    s.stop();
  });

  it('nudges again once the token expiry moves', async () => {
    let expiry = Date.now() - 60_000;
    const { deps } = fakeDeps<UsageStatus>({
      readExpiry: async () => expiry,
      fire: vi.fn(async () => ({ ok: true })),
    });
    const s = new Scheduler(config(), deps);
    s.start();
    await flush();
    expect(deps.fire).toHaveBeenCalledTimes(1);
    expect(s.getStatus().nextEventKind).toBeNull();

    // A refreshed token: new expiry well ahead → a fresh nudge is scheduled.
    expiry = Date.now() + 10 * 60_000;
    s.applyConfig(config());
    await flush();
    expect(s.getStatus().nextEventKind).toBe('nudge');
    expect(s.getStatus().nextFireAt).toBe(expiry - 120_000);
    s.stop();
  });

  it('survives a throwing readExpiry', async () => {
    const { deps } = fakeDeps<UsageStatus>({ readExpiry: async () => { throw new Error('boom'); } });
    const s = new Scheduler(config(), deps);
    s.start();
    await flush();
    expect(s.getStatus().nextEventKind).toBeNull();
    s.stop();
  });
});

describe('provider deps', () => {
  it('Claude: scheduler prefix, anchored on the 5-hour window', () => {
    const poller: any = { getStatus: () => ({ state: 'unknown' }), subscribe: () => () => {}, refreshNow: () => {} };
    const deps = claudeSchedulerDeps(poller, () => true);
    expect(deps.ipcPrefix).toBe('scheduler');
    expect(deps.logTag).toBe('[Scheduler]');
    expect(deps.shouldSkipOpener?.()).toBe(true);
    const ok: UsageStatus = {
      state: 'ok',
      snapshot: { fiveHour: { utilization: 1, resetsAt: 111 }, sevenDay: { utilization: 1, resetsAt: 222 } },
    };
    expect(deps.anchorResetsAt(ok)).toBe(111);
    expect(deps.anchorResetsAt({ state: 'unauthenticated' })).toBeNull();
  });

  it('Codex: codex-scheduler prefix, anchored on the primary window, backlog skip passed through', () => {
    const poller: any = { getStatus: () => ({ state: 'unknown' }), subscribe: () => () => {}, refreshNow: () => {} };
    expect(codexSchedulerDeps(poller).shouldSkipOpener).toBeUndefined();
    const skip = () => true;
    const deps = codexSchedulerDeps(poller, skip);
    expect(deps.ipcPrefix).toBe('codex-scheduler');
    expect(deps.logTag).toBe('[CodexScheduler]');
    expect(deps.shouldSkipOpener).toBe(skip);
    const ok: CodexUsageStatus = {
      state: 'ok',
      snapshot: { primary: { utilization: 1, resetsAt: 333 }, secondary: { utilization: 1, resetsAt: 444 } },
    };
    expect(deps.anchorResetsAt(ok)).toBe(333);
    expect(deps.anchorResetsAt({ state: 'network-error' })).toBeNull();
  });
});

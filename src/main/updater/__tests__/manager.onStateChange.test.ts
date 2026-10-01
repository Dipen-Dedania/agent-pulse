import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendSpy = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: false },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: sendSpy } }],
  },
}));
vi.mock('electron-updater', () => ({
  autoUpdater: { on: vi.fn(), checkForUpdates: vi.fn(), downloadUpdate: vi.fn(), quitAndInstall: vi.fn() },
}));
vi.mock('../../../common/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { UpdaterManager } from '../manager';
import type { UserConfig } from '../../user-config';

function makeManager(onStateChange?: (s: unknown) => void) {
  const cfg = { updates: { autoCheck: false, lastCheckedAt: null } } as unknown as UserConfig;
  return new UpdaterManager({
    getUserConfig: () => cfg,
    persistUpdaterConfig: (next) => { cfg.updates = next; },
    enabled: true,
    onStateChange,
  });
}

describe('UpdaterManager.onStateChange', () => {
  // setAutoCheck(true) arms the launch/periodic timers; fake them so nothing
  // fires after the test and we never reach the real autoUpdater.
  const managers: UpdaterManager[] = [];
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const mgr of managers.splice(0)) mgr.shutdown();
    vi.useRealTimers();
  });

  it('fires with the same state that is broadcast to windows on every transition', () => {
    const seen: Array<{ status: string }> = [];
    const mgr = makeManager((s) => seen.push(s as { status: string }));
    managers.push(mgr);
    mgr.init();
    // Drive an explicit transition via the public API rather than timers.
    mgr.setAutoCheck(true);
    expect(seen.length).toBeGreaterThan(0);
    const last = seen[seen.length - 1];
    expect(last.status).toBe(mgr.getState().status);
    // Renderer broadcast and main-side observer agree.
    const lastSend = sendSpy.mock.calls[sendSpy.mock.calls.length - 1];
    expect(lastSend[0]).toBe('updates:state');
    expect((lastSend[1] as { status: string }).status).toBe(last.status);
  });

  it('a throwing observer does not break the broadcast', () => {
    const mgr = makeManager(() => { throw new Error('boom'); });
    managers.push(mgr);
    mgr.init();
    expect(() => mgr.setAutoCheck(true)).not.toThrow();
  });

  it('is optional', () => {
    const mgr = makeManager(undefined);
    managers.push(mgr);
    mgr.init();
    expect(() => mgr.setAutoCheck(true)).not.toThrow();
  });
});

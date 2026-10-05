import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// INSTALL_SUPPORTED is evaluated at module load from process.platform, so
// each test stubs the platform, resets the module registry and re-imports.
const m = vi.hoisted(() => {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  const autoUpdater = {
    logger: null as unknown,
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn((evt: string, fn: (...a: unknown[]) => void) => { handlers.set(evt, fn); }),
    checkForUpdates: vi.fn(() => Promise.resolve(undefined)),
    downloadUpdate: vi.fn(() => Promise.resolve(undefined)),
    quitAndInstall: vi.fn(),
  };
  const sendSpy = vi.fn();
  return { handlers, autoUpdater, sendSpy };
});

vi.mock('electron', () => ({
  app: { getVersion: () => '1.0.0', isPackaged: true },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: m.sendSpy } }],
  },
}));
vi.mock('electron-updater', () => ({ autoUpdater: m.autoUpdater }));
vi.mock('../../../common/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import type { UserConfig } from '../../user-config';

const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform')!;
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
}

async function loadManager(platform: NodeJS.Platform) {
  setPlatform(platform);
  vi.resetModules();
  const { UpdaterManager } = await import('../manager');
  const cfg = { updates: { autoCheck: false, lastCheckedAt: null } } as unknown as UserConfig;
  const mgr = new UpdaterManager({
    getUserConfig: () => cfg,
    persistUpdaterConfig: (next) => { cfg.updates = next; },
    enabled: true,
  });
  return mgr;
}

const FAKE_INFO = { version: '9.9.9', files: [], path: '', sha512: '', releaseDate: '2026-10-01T00:00:00.000Z' };

beforeEach(() => {
  vi.useFakeTimers();
  m.handlers.clear();
  m.autoUpdater.on.mockClear();
  m.autoUpdater.checkForUpdates.mockClear();
  m.autoUpdater.downloadUpdate.mockClear();
  m.autoUpdater.quitAndInstall.mockClear();
  m.sendSpy.mockClear();
});
afterEach(() => {
  Object.defineProperty(process, 'platform', platformDesc);
  vi.useRealTimers();
});

describe('UpdaterManager on macOS (check-only mode)', () => {
  it('binds updater events and reports installSupported=false instead of bailing out', async () => {
    const mgr = await loadManager('darwin');
    mgr.init();
    expect(m.autoUpdater.on).toHaveBeenCalled();
    expect(m.handlers.has('update-available')).toBe(true);
    const state = mgr.getState();
    expect(state.installSupported).toBe(false);
    expect(state.status).toBe('idle');
    mgr.shutdown();
  });

  it('runs checks and surfaces "available" with a release-page URL', async () => {
    const mgr = await loadManager('darwin');
    mgr.init();
    await mgr.checkNow({ force: true });
    expect(m.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(mgr.getState().status).toBe('checking');

    m.handlers.get('update-available')!(FAKE_INFO);
    const state = mgr.getState();
    expect(state.status).toBe('available');
    expect(state.info?.version).toBe('9.9.9');
    expect(state.info?.downloadPageUrl).toBe('https://github.com/Dipen-Dedania/agent-pulse/releases/tag/v9.9.9');
    // Broadcast to renderer windows carried the same state.
    const lastSend = m.sendSpy.mock.calls[m.sendSpy.mock.calls.length - 1];
    expect(lastSend[0]).toBe('updates:state');
    expect((lastSend[1] as { status: string }).status).toBe('available');
    mgr.shutdown();
  });

  it('never downloads or installs, even when asked', async () => {
    const mgr = await loadManager('darwin');
    mgr.init();
    await mgr.checkNow({ force: true });
    m.handlers.get('update-available')!(FAKE_INFO);

    await mgr.downloadUpdate();
    expect(m.autoUpdater.downloadUpdate).not.toHaveBeenCalled();
    expect(mgr.getState().status).toBe('available');

    mgr.quitAndInstall();
    vi.runAllTimers();
    expect(m.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
    mgr.shutdown();
  });
});

describe('UpdaterManager on Windows (full install)', () => {
  it('reports installSupported=true and downloads from "available"', async () => {
    const mgr = await loadManager('win32');
    mgr.init();
    expect(mgr.getState().installSupported).toBe(true);

    await mgr.checkNow({ force: true });
    m.handlers.get('update-available')!(FAKE_INFO);
    expect(mgr.getState().status).toBe('available');

    await mgr.downloadUpdate();
    expect(m.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(mgr.getState().status).toBe('downloading');
    mgr.shutdown();
  });
});

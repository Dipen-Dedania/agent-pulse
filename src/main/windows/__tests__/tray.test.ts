import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Electron mock ───────────────────────────────────────────────────────────
const m = vi.hoisted(() => {
  const trayInstances: Array<{
    image: unknown;
    setImage: ReturnType<typeof vi.fn>;
    setToolTip: ReturnType<typeof vi.fn>;
    setContextMenu: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }> = [];
  const dockSetBadge = vi.fn();
  const menuTemplates: unknown[][] = [];
  // Which icon paths load as empty (simulates a missing dotted PNG).
  const emptyPaths = new Set<string>();
  return { trayInstances, dockSetBadge, menuTemplates, emptyPaths };
});

vi.mock('electron', () => ({
  Tray: class {
    image: unknown;
    setImage = vi.fn();
    setToolTip = vi.fn();
    setContextMenu = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    constructor(image: unknown) {
      this.image = image;
      m.trayInstances.push(this);
    }
  },
  Menu: {
    buildFromTemplate: (tpl: unknown[]) => { m.menuTemplates.push(tpl); return { tpl }; },
  },
  app: { dock: { setBadge: m.dockSetBadge } },
  nativeImage: {
    createFromPath: (p: string) => ({
      path: p,
      isEmpty: () => [...m.emptyPaths].some((e) => p.endsWith(e)),
      getSize: () => ({ width: 32, height: 32 }),
    }),
  },
}));

vi.mock('../../../common/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { TrayManager } from '../tray';

const callbacks = { onShowSettings: vi.fn(), onCheckForUpdates: vi.fn(), onQuit: vi.fn() };
const lastTray = () => m.trayInstances[m.trayInstances.length - 1];
const lastMenuLabel = () => (m.menuTemplates[m.menuTemplates.length - 1][0] as { label: string }).label;
const imgPath = (img: unknown) => (img as { path: string }).path;

let platformSpy: { restore: () => void } | null = null;
function setPlatform(p: NodeJS.Platform) {
  const desc = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: p, configurable: true });
  platformSpy = { restore: () => Object.defineProperty(process, 'platform', desc) };
}

beforeEach(() => {
  m.trayInstances.length = 0;
  m.menuTemplates.length = 0;
  m.emptyPaths.clear();
  m.dockSetBadge.mockClear();
  setPlatform('win32');
});
afterEach(() => platformSpy?.restore());

describe('TrayManager update indicator', () => {
  it('starts with the plain icon, default tooltip and "Check for Updates…"', () => {
    const tm = new TrayManager();
    tm.init(callbacks);
    const tray = lastTray();
    expect(imgPath(tray.image)).toMatch(/favicon-32x32\.png$/);
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Agent Pulse');
    expect(lastMenuLabel()).toBe('Check for Updates…');
    expect(tm.isUpdatePending()).toBe(false);
  });

  it('swaps to the dotted icon, versioned tooltip and "Download Update…" when pending', () => {
    const tm = new TrayManager();
    tm.init(callbacks);
    const tray = lastTray();
    tm.setUpdatePending(true, '1.4.0');
    expect(imgPath(tray.setImage.mock.lastCall![0])).toMatch(/favicon-32x32-update\.png$/);
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Agent Pulse — update 1.4.0 available');
    expect(lastMenuLabel()).toBe('Download Update…');
    expect(tm.isUpdatePending()).toBe(true);
  });

  it('clears back to the plain icon when the update resolves', () => {
    const tm = new TrayManager();
    tm.init(callbacks);
    const tray = lastTray();
    tm.setUpdatePending(true, '1.4.0');
    tm.setUpdatePending(false);
    expect(imgPath(tray.setImage.mock.lastCall![0])).toMatch(/favicon-32x32\.png$/);
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Agent Pulse');
    expect(lastMenuLabel()).toBe('Check for Updates…');
  });

  it('is idempotent: repeat calls with the same state do not touch the tray', () => {
    const tm = new TrayManager();
    tm.init(callbacks);
    const tray = lastTray();
    tm.setUpdatePending(true, '1.4.0');
    const images = tray.setImage.mock.calls.length;
    const tips = tray.setToolTip.mock.calls.length;
    const menus = tray.setContextMenu.mock.calls.length;
    tm.setUpdatePending(true, '1.4.0');
    tm.setUpdatePending(true, '1.4.0');
    expect(tray.setImage.mock.calls.length).toBe(images);
    expect(tray.setToolTip.mock.calls.length).toBe(tips);
    expect(tray.setContextMenu.mock.calls.length).toBe(menus);
  });

  it('applies a pending flag set before init() once the tray is built', () => {
    const tm = new TrayManager();
    tm.setUpdatePending(true, '2.0.0'); // updater boots before the tray
    expect(m.trayInstances).toHaveLength(0);
    tm.init(callbacks);
    const tray = lastTray();
    expect(imgPath(tray.image)).toMatch(/favicon-32x32-update\.png$/);
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Agent Pulse — update 2.0.0 available');
    expect(lastMenuLabel()).toBe('Download Update…');
  });

  it('falls back to the plain icon if the dotted PNG fails to load', () => {
    m.emptyPaths.add('favicon-32x32-update.png');
    const tm = new TrayManager();
    tm.init(callbacks);
    const tray = lastTray();
    tm.setUpdatePending(true, '1.4.0');
    // Image stays the plain one; tooltip + menu still signal the update.
    expect(imgPath(tray.setImage.mock.lastCall![0])).toMatch(/favicon-32x32\.png$/);
    expect(tray.setToolTip).toHaveBeenLastCalledWith('Agent Pulse — update 1.4.0 available');
    expect(lastMenuLabel()).toBe('Download Update…');
  });

  it('sets and clears the dock badge on macOS only', () => {
    const tm = new TrayManager();
    tm.init(callbacks);
    tm.setUpdatePending(true, '1.4.0');
    expect(m.dockSetBadge).not.toHaveBeenCalled();

    platformSpy?.restore();
    setPlatform('darwin');
    const tmMac = new TrayManager();
    tmMac.init(callbacks);
    tmMac.setUpdatePending(true, '1.4.0');
    expect(m.dockSetBadge).toHaveBeenLastCalledWith('1');
    tmMac.setUpdatePending(false);
    expect(m.dockSetBadge).toHaveBeenLastCalledWith('');
  });

  it('destroy() tears down the tray and clears the dock badge on macOS', () => {
    platformSpy?.restore();
    setPlatform('darwin');
    const tm = new TrayManager();
    tm.init(callbacks);
    tm.setUpdatePending(true, '1.4.0');
    tm.destroy();
    expect(lastTray().destroy).toHaveBeenCalled();
    expect(m.dockSetBadge).toHaveBeenLastCalledWith('');
  });
});

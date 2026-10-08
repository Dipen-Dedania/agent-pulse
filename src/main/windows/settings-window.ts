import { BrowserWindow, app, nativeTheme } from 'electron';
import path from 'path';
import { ENABLE_APP_MENU } from '../feature-flags';
import { TITLE_BAR_HEIGHT, titleBarOverlayColors } from '../../common/title-bar';

function getAppIconPath(): string {
  // 512x512 PNG works on every platform and scales down to taskbar/title-bar sizes
  // without the pixelation seen when ICO only contains 16/32px glyphs.
  return path.join(
    app.getAppPath(),
    'public',
    'assets',
    'favicon',
    'android-chrome-512x512.png',
  );
}

export type SettingsWindowLifecycleEvent =
  | 'created'
  | 'did-start-loading'
  | 'dom-ready'
  | 'did-finish-load'
  | 'did-fail-load'
  | 'ready-to-show';

export class SettingsWindow {
  private window: BrowserWindow | null = null;
  // Optional observer of the first window's load lifecycle (boot timing logs).
  public onLifecycle: ((event: SettingsWindowLifecycleEvent) => void) | null = null;

  /**
   * Invoke `cb` once the window's current document has finished (or failed)
   * loading; immediately if it already has, or if there is no window to wait
   * for. Used to start the deferred boot stage only after the settings page
   * has had its first chance to paint.
   */
  public onceLoaded(cb: () => void): void {
    const win = this.window;
    if (!win || win.isDestroyed()) { cb(); return; }
    const wc = win.webContents;
    if (!wc.isLoading()) { cb(); return; }
    let fired = false;
    const once = () => {
      if (fired) return;
      fired = true;
      cb();
    };
    wc.once('did-finish-load', once);
    wc.once('did-fail-load', once);
  }

  /**
   * Launch path: create the window hidden so it can load and paint behind the
   * floating splash. `show()` (called by the reveal gate on the renderer's
   * first-paint signal, or by any user request) then surfaces it fully drawn.
   */
  public createHidden(): void {
    if (this.window) return;
    this.create(false);
  }

  public isVisible(): boolean {
    return !!this.window && !this.window.isDestroyed() && this.window.isVisible();
  }

  public show() {
    if (this.window) {
      // Window may be hidden (closed-to-tray, or still pending its launch
      // reveal) — restore before focusing.
      if (!this.window.isVisible()) this.window.show();
      if (this.window.isMinimized()) this.window.restore();
      this.window.focus();
      // Dock-less (accessory) apps don't get foreground rights on macOS just
      // by showing a window — claim them explicitly or the window can surface
      // behind the current app.
      if (process.platform === 'darwin') app.focus({ steal: true });
      return;
    }
    this.create(true);
  }

  private create(visible: boolean) {
    const isMac = process.platform === 'darwin';
    this.window = new BrowserWindow({
      width: 900,
      height: 680,
      show: visible,
      title: 'Agent Pulse Settings',
      icon: getAppIconPath(),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc',
      autoHideMenuBar: !ENABLE_APP_MENU,
      // Custom title bar: hide the OS caption and let the renderer draw the bar
      // (src/renderer/components/Chrome). The OS still paints min/max/close on
      // Windows/Linux and the traffic lights on macOS, so snap layouts,
      // double-click-to-maximize and the system menu keep working. On macOS
      // `true` only switches on the `titlebar-area-*` CSS env vars; colours are
      // a Windows/Linux concept.
      titleBarStyle: 'hidden',
      titleBarOverlay: isMac
        ? true
        : { ...titleBarOverlayColors(nativeTheme.shouldUseDarkColors), height: TITLE_BAR_HEIGHT },
      ...(isMac ? { trafficLightPosition: { x: 14, y: 14 } } : {}),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), // Will create preload later
        nodeIntegration: false,
        contextIsolation: true,
        devTools: ENABLE_APP_MENU,
      },
    });

    const emit = (event: SettingsWindowLifecycleEvent) => { this.onLifecycle?.(event); };
    emit('created');
    const wc = this.window.webContents;
    wc.once('did-start-loading', () => emit('did-start-loading'));
    wc.once('dom-ready', () => emit('dom-ready'));
    wc.once('did-finish-load', () => emit('did-finish-load'));
    wc.once('did-fail-load', () => emit('did-fail-load'));
    this.window.once('ready-to-show', () => emit('ready-to-show'));

    // app.isPackaged is the canonical Electron signal: false during `electron .`,
    // true once the app is bundled. Avoids the trap where NODE_ENV is unset (or
    // leaked as "development") in a packaged build, which sent the window to a
    // dead Vite URL.
    if (!app.isPackaged) {
      this.window.loadURL('http://localhost:5173');
    } else {
      this.window.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'));
    }

    // Close-to-tray: keep the window alive across X-clicks so reopening from
    // the tray is instant. Only let it actually close once the app is quitting.
    this.window.on('close', (event) => {
      if (!(app as unknown as { isQuitting?: boolean }).isQuitting) {
        event.preventDefault();
        this.window?.hide();
      }
    });

    // macOS runs Dock-less (tray-only), so a minimized window would have no
    // Dock tile to live in — treat minimize as close-to-tray instead.
    if (process.platform === 'darwin') {
      this.window.on('minimize', () => {
        this.window?.hide();
      });
    }

    // Keep the native caption buttons in step with the theme. Both the user's
    // toggle (appearance:update-config → nativeTheme.themeSource) and an OS
    // theme change in `auto` surface as nativeTheme 'updated'.
    nativeTheme.on('updated', this.syncTitleBarOverlay);

    this.window.on('closed', () => {
      nativeTheme.off('updated', this.syncTitleBarOverlay);
      this.window = null;
    });
  }

  private syncTitleBarOverlay = () => {
    if (process.platform === 'darwin') return;
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    try {
      win.setTitleBarOverlay(titleBarOverlayColors(nativeTheme.shouldUseDarkColors));
    } catch {
      // Some Linux window managers don't expose the overlay; the bar still works.
    }
  };
}

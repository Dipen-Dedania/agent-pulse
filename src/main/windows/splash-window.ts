import { BrowserWindow, app, screen } from 'electron';
import path from 'path';
import { logger } from '../../common/logger';

// Launch splash: a small frameless, transparent, always-on-top window showing
// only the animated logo (public/splash.html, static — no bundle, no script),
// centred on the primary display where the settings window will appear. It
// floats over the desktop with no box behind it while the settings window
// loads hidden; the reveal gate (src/main/splash-reveal.ts) decides when to
// swap the two and asks this window to fade out. Same window recipe as the
// bubbles (bubble-manager.ts), minus the preload: it never talks to main.

const SPLASH_SIZE = 200;
const FADE_MS = 180;
const FADE_STEPS = 6;

export type SplashLifecycleEvent =
  | 'created'
  | 'show'
  | 'did-start-loading'
  | 'dom-ready'
  | 'did-finish-load'
  | 'did-fail-load'
  | 'ready-to-show'
  | 'fade-out'
  | 'closed';

export class SplashWindow {
  private window: BrowserWindow | null = null;
  private fading = false;
  // Fired once the splash page has loaded (its first frame follows within a
  // tick). The reveal gate starts the minimum-hold clock from here.
  public onPainted: (() => void) | null = null;
  // Optional observer of the window's lifecycle (boot timing logs).
  public onLifecycle: ((event: SplashLifecycleEvent) => void) | null = null;

  public show(): void {
    if (this.window && !this.window.isDestroyed()) return;
    try {
      const area = screen.getPrimaryDisplay().workArea;
      const win = new BrowserWindow({
        title: 'Agent Pulse',
        width: SPLASH_SIZE,
        height: SPLASH_SIZE,
        x: Math.round(area.x + (area.width - SPLASH_SIZE) / 2),
        y: Math.round(area.y + (area.height - SPLASH_SIZE) / 2),
        show: true,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        focusable: false,
        hasShadow: false,
        skipTaskbar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });
      const emit = (event: SplashLifecycleEvent) => { this.onLifecycle?.(event); };
      emit('created');
      // Purely decorative: never intercept clicks meant for what's beneath.
      win.setIgnoreMouseEvents(true);
      win.once('show', () => emit('show'));
      win.once('ready-to-show', () => emit('ready-to-show'));
      win.on('closed', () => { this.window = null; emit('closed'); });
      const wc = win.webContents;
      wc.once('did-start-loading', () => emit('did-start-loading'));
      wc.once('dom-ready', () => emit('dom-ready'));
      wc.once('did-finish-load', () => {
        emit('did-finish-load');
        this.onPainted?.();
      });
      wc.once('did-fail-load', (_e, code, desc) => {
        emit('did-fail-load');
        logger.warn(`[SplashWindow] splash.html failed to load (${code} ${desc}); window stays transparent`);
      });

      if (!app.isPackaged) {
        win.loadURL('http://localhost:5173/splash.html');
      } else {
        win.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'splash.html'));
      }
      this.window = win;
    } catch (e) {
      // A platform that refuses transparent windows just launches without the
      // splash; the settings window's own reveal path is unaffected.
      logger.warn('[SplashWindow] could not create splash window', e);
      this.window = null;
    }
  }

  /**
   * Fade the logo out over ~180ms, then close. The settings window is already
   * visible underneath by the time this is called, so the logo dissolves into
   * the app instead of blinking off. Falls back to an immediate close where
   * window opacity isn't supported.
   */
  public fadeOutAndClose(): void {
    const win = this.window;
    if (!win || win.isDestroyed() || this.fading) return;
    this.fading = true;
    this.onLifecycle?.('fade-out');
    let step = 0;
    const tick = () => {
      if (win.isDestroyed()) return;
      step += 1;
      try {
        win.setOpacity(Math.max(0, 1 - step / FADE_STEPS));
      } catch {
        this.close();
        return;
      }
      if (step >= FADE_STEPS) this.close();
      else setTimeout(tick, FADE_MS / FADE_STEPS);
    };
    tick();
  }

  public close(): void {
    const win = this.window;
    this.window = null;
    if (!win || win.isDestroyed()) return;
    try {
      win.close();
    } catch (e) {
      logger.debug('[SplashWindow] close failed', e);
    }
  }
}

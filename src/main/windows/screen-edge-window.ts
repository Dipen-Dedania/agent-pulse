import { BrowserWindow, screen, app, ipcMain, powerMonitor, Display } from 'electron';
import path from 'path';
import { logger } from '../../common/logger';
import { AgentState, AttentionConfig, NormalizedEvent, ToolId } from '../../common/types';
import { EdgeCorner, EdgeGeometry, EdgeNotch, ScreenEdgePayload, previewMs } from '../../common/screenEdge';
import { StatusStateManager } from '../bridge/state-manager';

export interface ScreenEdgeDeps {
  stateManager: StatusStateManager;
}

type DisplayShape = Pick<Display, 'bounds' | 'workArea' | 'internal'>;

// Menu bar height (DIP) above which a built-in Mac display is assumed to have a
// camera notch: notched MacBooks reserve ~37pt, every other Mac ~24pt. Electron
// exposes no notch API (NSScreen.safeAreaInsets isn't surfaced), so this is a
// heuristic. An auto-hidden menu bar reads as 0 and falls back to the capsule.
const NOTCH_MENU_BAR_MIN = 32;
// Notch width relative to its height. The physical cut-out is about 5x as wide
// as it is tall across the 14"/16" models; tune on hardware if it drifts.
const NOTCH_ASPECT = 5.2;

/**
 * The camera notch on this display, or null. Only the built-in screen of a
 * notched MacBook qualifies — external monitors, Windows and older Macs get
 * the top-centre capsule instead.
 */
export function detectNotch(d: DisplayShape, platform: NodeJS.Platform = process.platform): EdgeNotch | null {
  if (platform !== 'darwin' || !d.internal) return null;
  const menuBar = d.workArea.y - d.bounds.y;
  if (menuBar < NOTCH_MENU_BAR_MIN) return null;
  return { width: Math.round(menuBar * NOTCH_ASPECT), height: menuBar };
}

/**
 * The overlay corner nearest the tray, where a comet without a notch lands.
 * macOS: top-right, under the menu bar status icons. Windows: the tray sits at
 * the far end of the taskbar, so a bottom or right taskbar lands bottom-right,
 * a top taskbar top-right, a left taskbar bottom-left. The taskbar side is
 * whichever edge `workArea` gives up against `bounds`; an auto-hidden taskbar
 * reserves nothing and falls back to the default bottom-right.
 */
export function trayCorner(d: DisplayShape, platform: NodeJS.Platform = process.platform): EdgeCorner {
  if (platform === 'darwin') return 'tr';
  const { bounds: b, workArea: w } = d;
  const bottom = b.y + b.height - (w.y + w.height);
  const top = w.y - b.y;
  const right = b.x + b.width - (w.x + w.width);
  const left = w.x - b.x;
  const most = Math.max(bottom, top, right, left);
  if (most <= 0 || most === bottom || most === right) return 'br';
  return most === top ? 'tr' : 'bl';
}

/** Rounded screen corners: built-in Mac panels have them, everything else is square. */
export function displayCornerRadius(d: DisplayShape, platform: NodeJS.Platform = process.platform): number {
  return platform === 'darwin' && d.internal ? 10 : 0;
}

/**
 * A full-screen, click-through blue border that lights up the instant any agent
 * enters the `waiting` state (blocked on the user) and fades out once nothing is
 * waiting. Ambient "someone needs you" awareness you can catch from across the
 * room without looking at a bubble.
 *
 * One transparent frameless window per display. The border is drawn in CSS at
 * the window's edges; the centre stays transparent AND mouse-transparent
 * (`setIgnoreMouseEvents`), so the overlay is a pure visual frame that never
 * intercepts clicks. Same window recipe as TooltipManager, sized to each
 * display instead of anchored to a bubble.
 *
 * Driven directly off StatusStateManager.onEvent — the same choke point the
 * AttentionEngine uses — so the frame tracks the live waiting set in the main
 * process and appears immediately, independent of the escalation threshold.
 */
export class ScreenEdgeManager {
  // Unavailable on Linux: `setIgnoreMouseEvents` is unreliable there (broken on
  // Wayland, timing-sensitive on X11), and when click-through fails this
  // full-screen overlay swallows every mouse click — the desktop becomes
  // unusable until the app is killed from the keyboard. Never light the frame
  // on Linux, even if a config from another OS carries `screenEdgeGlow: true`.
  public static readonly SUPPORTED = process.platform !== 'linux';

  private readonly stateManager: StatusStateManager;
  private config: AttentionConfig;
  private windows: BrowserWindow[] = [];
  // What each overlay window draws around — its notch (if any) and corners.
  private readonly geometry = new Map<BrowserWindow, EdgeGeometry>();
  // Screen locked / system asleep: nobody can see the border, so the comet
  // stops animating (the lit state itself is kept).
  private paused = false;
  private readonly waiting = new Set<ToolId>();
  private readonly lastState = new Map<ToolId, AgentState>();
  private unsubscribe: (() => void) | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  // A Preview that had to create its windows: its timer starts on the first
  // renderer `ready`, so the page load doesn't eat into the comet's lap.
  private previewAwaitingReady = false;
  private preview = false;
  private active = false;
  private stopped = true;

  // Keep the windows shown briefly after deactivation so the renderer's
  // fade-out can play, then hide (not destroy — reuse on the next episode).
  // Must exceed the renderer's exit-fade duration.
  private static readonly FADE_OUT_MS = 600;
  // Longest a cold-start Preview waits for its page before timing out anyway.
  private static readonly PREVIEW_LOAD_CAP_MS = 3000;

  constructor(config: AttentionConfig, deps: ScreenEdgeDeps) {
    this.config = config;
    this.stateManager = deps.stateManager;
  }

  public start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribe = this.stateManager.onEvent((e) => this.onEvent(e));
    screen.on('display-added', this.onDisplaysChanged);
    screen.on('display-removed', this.onDisplaysChanged);
    screen.on('display-metrics-changed', this.onDisplaysChanged);
    // Each overlay renderer pings this once its `screen-edge:state` listener is
    // mounted, and we reply with the current lit-state. This closes the race
    // where a broadcast right after window creation lands before React has
    // subscribed (which made the very first Preview click do nothing).
    ipcMain.on('screen-edge:ready', this.onRendererReady);
    powerMonitor.on('lock-screen', this.onSleep);
    powerMonitor.on('suspend', this.onSleep);
    powerMonitor.on('unlock-screen', this.onWake);
    powerMonitor.on('resume', this.onWake);
    logger.info(
      `[ScreenEdge] started, enabled=${this.config.screenEdgeGlow}, supported=${ScreenEdgeManager.SUPPORTED}`,
    );
  }

  public stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    screen.removeListener('display-added', this.onDisplaysChanged);
    screen.removeListener('display-removed', this.onDisplaysChanged);
    screen.removeListener('display-metrics-changed', this.onDisplaysChanged);
    ipcMain.removeListener('screen-edge:ready', this.onRendererReady);
    powerMonitor.removeListener('lock-screen', this.onSleep);
    powerMonitor.removeListener('suspend', this.onSleep);
    powerMonitor.removeListener('unlock-screen', this.onWake);
    powerMonitor.removeListener('resume', this.onWake);
    this.paused = false;
    this.clearHideTimer();
    this.clearPreviewTimer();
    this.preview = false;
    this.waiting.clear();
    this.lastState.clear();
    this.active = false;
    this.destroyWindows();
  }

  public applyConfig(config: AttentionConfig) {
    const styleChanged = config.screenEdgeStyle !== this.config.screenEdgeStyle;
    this.config = config;
    // The comet on a notched Mac needs a window over the menu bar, the glow
    // keeps hugging the work area — so a style switch rebuilds the windows.
    if (styleChanged && !this.stopped) this.onDisplaysChanged();
    this.refresh();
    // Colour / speed / style changes reach an already-lit border immediately.
    if (this.active) this.broadcast();
  }

  // Manually flash the frame for a few seconds — the Settings "Preview" button.
  // Works regardless of the toggle so the user can see it before committing;
  // reverts to whatever the live waiting state dictates when it elapses.
  public previewFlash() {
    if (this.stopped || !ScreenEdgeManager.SUPPORTED) return;
    this.clearPreviewTimer();
    const coldStart = this.windows.length === 0;
    this.preview = true;
    this.refresh();
    const ms = previewMs(this.config.screenEdgeStyle, this.config.screenEdgeSpeed);
    if (coldStart) {
      // Fresh windows still have to load the page before the lap can start.
      // Cap the wait in case no renderer ever reports ready.
      this.previewAwaitingReady = true;
      this.armPreviewTimer(ms + ScreenEdgeManager.PREVIEW_LOAD_CAP_MS);
    } else {
      this.armPreviewTimer(ms);
    }
  }

  private armPreviewTimer(ms: number) {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.previewAwaitingReady = false;
      this.preview = false;
      this.refresh();
    }, ms);
    this.previewTimer.unref?.();
  }

  public destroy() {
    this.stop();
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private onEvent(e: NormalizedEvent) {
    if (this.stopped) return;
    const { toolId, state } = e;
    if (this.lastState.get(toolId) === state) return; // no membership change
    this.lastState.set(toolId, state);

    if (state === 'waiting') this.waiting.add(toolId);
    else this.waiting.delete(toolId);

    this.refresh();
  }

  // Recompute whether the frame should be lit from the live inputs: a manual
  // preview forces it on; otherwise it's on iff enabled AND something's waiting.
  private refresh() {
    const shouldShow =
      ScreenEdgeManager.SUPPORTED &&
      (this.preview || (this.config.screenEdgeGlow && this.waiting.size > 0));
    this.setActive(shouldShow);
  }

  private setActive(next: boolean) {
    if (next === this.active) return;
    this.active = next;

    if (next) {
      this.clearHideTimer();
      this.ensureWindows();
      this.showWindows();
      this.broadcast();
    } else {
      // Fade out in the renderer, then hide (keep the windows for reuse).
      this.broadcast();
      this.clearHideTimer();
      this.hideTimer = setTimeout(() => {
        this.hideTimer = null;
        if (!this.active) this.hideWindows();
      }, ScreenEdgeManager.FADE_OUT_MS);
      this.hideTimer.unref?.();
    }
  }

  // Display layout changed. Rebuild the window set so every current display is
  // framed; if we're not currently lit there's nothing to show yet.
  private onDisplaysChanged = () => {
    this.destroyWindows();
    if (this.active) {
      this.ensureWindows();
      this.showWindows();
    }
  };

  private ensureWindows() {
    if (this.windows.length) return;
    for (const display of screen.getAllDisplays()) {
      this.windows.push(this.createWindow(display));
    }
  }

  // An overlay renderer just mounted its listener — hand it the current state.
  private onRendererReady = (event: Electron.IpcMainEvent) => {
    if (event.sender.isDestroyed()) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    event.sender.send('screen-edge:state', this.payloadFor(win));
    // The first overlay is up and starting its lap: time the Preview from now.
    if (this.previewAwaitingReady && this.preview) {
      this.previewAwaitingReady = false;
      this.armPreviewTimer(previewMs(this.config.screenEdgeStyle, this.config.screenEdgeSpeed));
    }
  };

  private onSleep = () => { this.paused = true; if (this.active) this.broadcast(); };
  private onWake = () => { this.paused = false; if (this.active) this.broadcast(); };

  private payloadFor(win: BrowserWindow | null): ScreenEdgePayload {
    return {
      active: this.active,
      paused: this.paused,
      style: this.config.screenEdgeStyle,
      color: this.config.screenEdgeColor,
      speed: this.config.screenEdgeSpeed,
      geometry: (win && this.geometry.get(win)) ?? { notch: null, cornerRadius: 0, trayCorner: 'br' },
    };
  }

  private createWindow(display: Display): BrowserWindow {
    // `workArea` (not `bounds`) so the border hugs the *usable* screen — its
    // bottom edge sits above the taskbar instead of being hidden behind it.
    // Exception: the comet on a notched Mac covers the whole display so it can
    // trace the notch, which sits inside the menu bar strip workArea excludes.
    const notch = this.config.screenEdgeStyle === 'comet' ? detectNotch(display) : null;
    const area = notch ? display.bounds : display.workArea;

    const win = new BrowserWindow({
      x: area.x, y: area.y, width: area.width, height: area.height,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      hasShadow: false,
      // Let macOS place the window over the menu bar instead of clamping it below.
      enableLargerThanScreen: Boolean(notch),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Pure visual frame — never intercept the mouse, even over the border.
    win.setIgnoreMouseEvents(true);
    // Above the menu bar, so the notch outline isn't drawn underneath it.
    if (notch) win.setAlwaysOnTop(true, 'screen-saver');
    this.geometry.set(win, { notch, cornerRadius: displayCornerRadius(display), trayCorner: trayCorner(display) });

    // Re-apply the bounds once the window is realised on its target display.
    // On Windows a window created for a monitor with a different DPI scale
    // factor can come out mis-sized (e.g. two-thirds height on a 150% display);
    // a second setBounds after placement recomputes it at the right scale.
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.setBounds(area);
    });

    win.on('closed', () => {
      this.windows = this.windows.filter((w) => w !== win);
      this.geometry.delete(win);
    });

    if (!app.isPackaged) {
      win.loadURL('http://localhost:5173/?view=screen-edge');
    } else {
      win.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'), {
        query: { view: 'screen-edge' },
      });
    }

    return win;
  }

  private showWindows() {
    for (const w of this.windows) {
      if (!w.isDestroyed() && !w.isVisible()) w.showInactive();
    }
  }

  private hideWindows() {
    for (const w of this.windows) {
      if (!w.isDestroyed() && w.isVisible()) w.hide();
    }
  }

  private destroyWindows() {
    this.clearHideTimer();
    for (const w of this.windows) {
      if (!w.isDestroyed()) w.destroy();
    }
    this.windows = [];
  }

  private broadcast() {
    for (const w of this.windows) {
      if (!w.isDestroyed()) w.webContents.send('screen-edge:state', this.payloadFor(w));
    }
  }

  private clearHideTimer() {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
  }

  private clearPreviewTimer() {
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.previewAwaitingReady = false;
  }
}

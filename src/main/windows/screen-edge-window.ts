import { BrowserWindow, screen, app, ipcMain, Display } from 'electron';
import path from 'path';
import { logger } from '../../common/logger';
import { AgentState, AttentionConfig, NormalizedEvent, ToolId } from '../../common/types';
import { StatusStateManager } from '../bridge/state-manager';

export interface ScreenEdgeDeps {
  stateManager: StatusStateManager;
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
  private readonly stateManager: StatusStateManager;
  private config: AttentionConfig;
  private windows: BrowserWindow[] = [];
  private readonly waiting = new Set<ToolId>();
  private readonly lastState = new Map<ToolId, AgentState>();
  private unsubscribe: (() => void) | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private preview = false;
  private active = false;
  private stopped = true;

  // How long a manual "Preview" flash stays lit (from Settings). Long enough to
  // catch a full breath of the pulse.
  private static readonly PREVIEW_MS = 4000;

  // Keep the windows shown briefly after deactivation so the renderer's
  // fade-out can play, then hide (not destroy — reuse on the next episode).
  // Must exceed the renderer's exit-fade duration.
  private static readonly FADE_OUT_MS = 600;

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
    // Each overlay renderer pings this once its `screen-edge:active` listener is
    // mounted, and we reply with the current lit-state. This closes the race
    // where a broadcast right after window creation lands before React has
    // subscribed (which made the very first Preview click do nothing).
    ipcMain.on('screen-edge:ready', this.onRendererReady);
    logger.info(`[ScreenEdge] started, enabled=${this.config.screenEdgeGlow}`);
  }

  public stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    screen.removeListener('display-added', this.onDisplaysChanged);
    screen.removeListener('display-removed', this.onDisplaysChanged);
    screen.removeListener('display-metrics-changed', this.onDisplaysChanged);
    ipcMain.removeListener('screen-edge:ready', this.onRendererReady);
    this.clearHideTimer();
    this.clearPreviewTimer();
    this.preview = false;
    this.waiting.clear();
    this.lastState.clear();
    this.active = false;
    this.destroyWindows();
  }

  public applyConfig(config: AttentionConfig) {
    this.config = config;
    this.refresh();
  }

  // Manually flash the frame for a few seconds — the Settings "Preview" button.
  // Works regardless of the toggle so the user can see it before committing;
  // reverts to whatever the live waiting state dictates when it elapses.
  public previewFlash() {
    if (this.stopped) return;
    this.clearPreviewTimer();
    this.preview = true;
    this.refresh();
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.preview = false;
      this.refresh();
    }, ScreenEdgeManager.PREVIEW_MS);
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
    const shouldShow = this.preview || (this.config.screenEdgeGlow && this.waiting.size > 0);
    this.setActive(shouldShow);
  }

  private setActive(next: boolean) {
    if (next === this.active) return;
    this.active = next;

    if (next) {
      this.clearHideTimer();
      this.ensureWindows();
      this.showWindows();
      this.broadcast(true);
    } else {
      // Fade out in the renderer, then hide (keep the windows for reuse).
      this.broadcast(false);
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
    event.sender.send('screen-edge:active', this.active);
  };

  private createWindow(display: Display): BrowserWindow {
    // `workArea` (not `bounds`) so the border hugs the *usable* screen — its
    // bottom edge sits above the taskbar instead of being hidden behind it.
    const area = display.workArea;

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
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Pure visual frame — never intercept the mouse, even over the border.
    win.setIgnoreMouseEvents(true);

    // Re-apply the bounds once the window is realised on its target display.
    // On Windows a window created for a monitor with a different DPI scale
    // factor can come out mis-sized (e.g. two-thirds height on a 150% display);
    // a second setBounds after placement recomputes it at the right scale.
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.setBounds(area);
    });

    win.on('closed', () => {
      this.windows = this.windows.filter((w) => w !== win);
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

  private broadcast(active: boolean) {
    for (const w of this.windows) {
      if (!w.isDestroyed()) w.webContents.send('screen-edge:active', active);
    }
  }

  private clearHideTimer() {
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }
  }

  private clearPreviewTimer() {
    if (this.previewTimer) { clearTimeout(this.previewTimer); this.previewTimer = null; }
  }
}

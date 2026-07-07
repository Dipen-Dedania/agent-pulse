import { BrowserWindow, ipcMain, screen, app } from 'electron';
import path from 'path';
import { logger } from '../../common/logger';
import { TourDemoState } from '../../common/types';

/**
 * First-run tour orchestrator. The tour spans two dedicated always-on-top
 * windows that exist only while it runs:
 *
 *  - a DEMO BUBBLE — the real Bubble renderer loaded with `demo=1`, so the
 *    user watches the genuine artifact (Clawd mascot, state animations, usage
 *    bars, hover tooltip) driven by scripted states instead of hook events;
 *  - a COACH CARD — a glass narration card positioned beside it, which steps
 *    through the script and drives the demo bubble via `tour:demo-state`.
 *
 * No tour library could span multiple BrowserWindows, hence this ~150-line
 * orchestrator. Flow: start() → both windows load → card measures itself →
 * we place card + bubble as a pair → card sends `tour:finish` (skip or
 * complete) → teardown + onFinished callback (which persists hasSeenTour).
 */
export class TourManager {
  private demoWindow: BrowserWindow | null = null;
  private cardWindow: BrowserWindow | null = null;

  // Matches MASCOT_DIMENSIONS.large in bubble-manager.ts — the demo bubble
  // always renders at large size with the Clawd mascot for showcase clarity,
  // regardless of the user's configured bubble size.
  private static readonly DEMO_W = 86;
  private static readonly DEMO_H = 112;
  private static readonly GAP = 28;   // px between coach card and demo bubble
  private static readonly MARGIN = 16; // keep-away from work-area edges

  // Set by the app shell: persists hasSeenTour and refocuses Settings.
  public onFinished: ((completed: boolean) => void) | null = null;

  public init() {
    ipcMain.on('tour:start', () => this.start());

    // Coach card drives the demo bubble's pose for the current step.
    ipcMain.on('tour:demo-state', (_event, payload: TourDemoState) => {
      if (this.demoWindow && !this.demoWindow.isDestroyed()) {
        this.demoWindow.webContents.send('tour:demo-state', payload);
      }
    });

    // Card measured itself (initial mount and every step change, since step
    // bodies differ in height) — size + place the pair, then reveal.
    ipcMain.on('tour:card-measured', (event, size: { width: number; height: number }) => {
      if (!this.cardWindow || this.cardWindow.isDestroyed()) return;
      if (BrowserWindow.fromWebContents(event.sender) !== this.cardWindow) return;
      this.layout(size);
    });

    ipcMain.on('tour:finish', (_event, { completed }: { completed: boolean }) => {
      logger.info(`[TourManager] finished (completed=${completed})`);
      this.teardown();
      this.onFinished?.(completed);
    });
  }

  public isActive(): boolean {
    return !!(this.cardWindow && !this.cardWindow.isDestroyed());
  }

  public start() {
    if (this.isActive()) {
      this.cardWindow!.focus();
      return;
    }
    logger.info('[TourManager] starting tour');
    this.createDemoWindow();
    this.createCardWindow();
  }

  // Demo bubble right-of-center on the primary display, vertically centered —
  // clear of the real bubble stack (corner-anchored) and of the Settings
  // window most users have roughly centered.
  private demoBounds() {
    const wa = screen.getPrimaryDisplay().workArea;
    const x = Math.round(wa.x + wa.width * 0.68);
    const y = Math.round(wa.y + wa.height / 2 - TourManager.DEMO_H / 2);
    return { x, y, width: TourManager.DEMO_W, height: TourManager.DEMO_H };
  }

  private createDemoWindow() {
    const bounds = this.demoBounds();
    const win = new BrowserWindow({
      ...bounds,
      title: 'Agent Pulse - tour demo',
      show: false,
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
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    // Same per-pixel click-through scheme as real bubbles: the renderer's
    // mousemove handler flips 'set-ignore-mouse' (handled in BubbleManager)
    // so hover tooltips still work on the demo.
    win.setIgnoreMouseEvents(true, { forward: true });
    win.on('closed', () => { this.demoWindow = null; });
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) win.showInactive();
    });

    if (!app.isPackaged) {
      win.loadURL('http://localhost:5173/bubble?toolId=claude-code&demo=1');
    } else {
      win.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'), {
        query: { toolId: 'claude-code', demo: '1' },
      });
    }
    this.demoWindow = win;
  }

  private createCardWindow() {
    const win = new BrowserWindow({
      width: 340,
      height: 260,
      title: 'Agent Pulse - tour',
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    win.on('closed', () => { this.cardWindow = null; });

    if (!app.isPackaged) {
      win.loadURL('http://localhost:5173/?view=tour');
    } else {
      win.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'), {
        query: { view: 'tour' },
      });
    }
    this.cardWindow = win;
  }

  // Place the coach card to the LEFT of the demo bubble, vertically centered
  // on it, clamped to the work area. Falls back to the right side when the
  // 0.68-width anchor leaves no room (very narrow displays).
  private layout(size: { width: number; height: number }) {
    if (!this.cardWindow || this.cardWindow.isDestroyed()) return;
    const w = Math.max(1, Math.ceil(size.width));
    const h = Math.max(1, Math.ceil(size.height));
    const demo = this.demoBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    const { GAP, MARGIN } = TourManager;

    let x = demo.x - w - GAP;
    if (x < wa.x + MARGIN) x = demo.x + demo.width + GAP;
    x = Math.max(wa.x + MARGIN, Math.min(x, wa.x + wa.width - w - MARGIN));

    let y = Math.round(demo.y + demo.height / 2 - h / 2);
    y = Math.max(wa.y + MARGIN, Math.min(y, wa.y + wa.height - h - MARGIN));

    this.cardWindow.setBounds({ x, y, width: w, height: h });
    if (!this.cardWindow.isVisible()) this.cardWindow.show();
  }

  private teardown() {
    if (this.demoWindow && !this.demoWindow.isDestroyed()) this.demoWindow.destroy();
    if (this.cardWindow && !this.cardWindow.isDestroyed()) this.cardWindow.destroy();
    this.demoWindow = null;
    this.cardWindow = null;
  }

  public destroy() {
    this.teardown();
  }
}

import { BrowserWindow, ipcMain, screen, app } from 'electron';
import path from 'path';
import { logger } from '../../common/logger';
import { BubbleTooltipPayload } from '../../common/types';

interface Anchor { x: number; y: number; width: number; height: number }

/**
 * A single reusable overlay window that renders the rich bubble tooltip. The
 * bubble windows are only ~70px so a tooltip rendered inside them would clip
 * (and resizing them on hover caused the old flicker/width-growth bug). This
 * window is transparent, click-through and non-focusable — purely visual — and
 * is positioned just above (or below) whichever bubble requested it.
 *
 * Flow: bubble sends `tooltip:show` with content → we derive the bubble's
 * screen rect from the sender window → load/forward content → the overlay
 * renderer measures itself and replies `tooltip:measured` → we size + place +
 * show. `tooltip:hide` hides (never destroys) the window for reuse.
 */
export class TooltipManager {
  private window: BrowserWindow | null = null;
  private owner: BrowserWindow | null = null;
  private anchor: Anchor | null = null;
  private wantVisible = false;
  private ready = false;
  private pending: BubbleTooltipPayload | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;

  private static readonly GAP = 8;        // px between bubble and tooltip
  private static readonly MARGIN = 4;     // px keep-away from screen edges
  // Safety auto-hide: if the bubble stops sending show/ping refreshes (e.g. the
  // bubble window was toggled off mid-hover), drop the overlay. Must exceed the
  // bubble's heartbeat interval so a genuine hover never trips it.
  private static readonly WATCHDOG_MS = 4000;
  // Authoritative hover check: the bubble's DOM mouseleave is unreliable on a
  // tiny transparent click-through window (a fast exit through a click-through
  // pixel never fires it). So while the tooltip is up we poll the OS cursor
  // against the bubble's rect and dismiss the moment it's outside.
  private static readonly POLL_MS = 120;

  public init() {
    ipcMain.on('tooltip:show', (event, payload: BubbleTooltipPayload) => {
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || owner.isDestroyed()) return;
      this.owner = owner;
      this.anchor = owner.getBounds();
      this.wantVisible = true;
      // "Fresh" = the overlay is currently hidden, so this is a new appearance
      // (replay the entrance animation) rather than a live content update.
      const fresh = !(this.window && !this.window.isDestroyed() && this.window.isVisible());
      this.ensureWindow();
      this.sendContent(payload, fresh);
      this.armWatchdog();
      this.startPoll();
    });

    // Lightweight keepalive — re-arms the watchdog without re-delivering
    // content (so the tooltip doesn't re-animate while you keep hovering).
    ipcMain.on('tooltip:ping', () => {
      if (this.wantVisible) this.armWatchdog();
    });

    ipcMain.on('tooltip:hide', () => {
      this.dismiss(false);
    });

    ipcMain.on('tooltip:measured', (_event, size: { width: number; height: number }) => {
      this.position(size);
    });
  }

  // Hide the overlay and tear down timers. When `notifyOwner` is true (cursor
  // left the bubble per our poll), tell the bubble to reset its hover state so
  // it stops its heartbeat and won't re-show on the next content update.
  private dismiss(notifyOwner: boolean) {
    this.wantVisible = false;
    this.clearWatchdog();
    this.stopPoll();
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) {
      this.window.hide();
    }
    if (notifyOwner && this.owner && !this.owner.isDestroyed()) {
      this.owner.webContents.send('tooltip:dismissed');
    }
  }

  private startPoll() {
    if (this.poll) return;
    this.poll = setInterval(() => this.checkCursor(), TooltipManager.POLL_MS);
  }

  private stopPoll() {
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
  }

  private checkCursor() {
    if (!this.wantVisible) {
      this.stopPoll();
      return;
    }
    // Refresh the rect from the live bubble so dragging/restacking it doesn't
    // cause a stale-bounds false dismiss.
    if (this.owner && !this.owner.isDestroyed()) {
      this.anchor = this.owner.getBounds();
    }
    if (!this.anchor) return;
    const p = screen.getCursorScreenPoint();
    const a = this.anchor;
    const inside = p.x >= a.x && p.x < a.x + a.width && p.y >= a.y && p.y < a.y + a.height;
    if (!inside) this.dismiss(true);
  }

  private armWatchdog() {
    this.clearWatchdog();
    this.watchdog = setTimeout(() => this.dismiss(true), TooltipManager.WATCHDOG_MS);
  }

  private clearWatchdog() {
    if (this.watchdog) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return;

    const win = new BrowserWindow({
      width: 260,
      height: 120,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Never intercept mouse — the tooltip is informational only, and stealing
    // events would break the bubble's own hover/click handling underneath.
    win.setIgnoreMouseEvents(true);

    win.on('closed', () => {
      this.window = null;
      this.ready = false;
    });

    win.webContents.once('did-finish-load', () => {
      this.ready = true;
      if (this.pending) this.deliver(this.pending, true);
    });

    if (!app.isPackaged) {
      win.loadURL('http://localhost:5173/?view=tooltip');
    } else {
      win.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'), {
        query: { view: 'tooltip' },
      });
    }

    this.ready = false;
    this.window = win;
  }

  private sendContent(payload: BubbleTooltipPayload, fresh: boolean) {
    this.pending = payload;
    if (this.ready) this.deliver(payload, fresh);
  }

  private deliver(payload: BubbleTooltipPayload, fresh: boolean) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('tooltip:content', { payload, fresh });
    }
  }

  // Place the overlay using the size the renderer measured. Prefers sitting
  // above the bubble; flips below when there isn't room near the top edge.
  private position(size: { width: number; height: number }) {
    if (!this.window || this.window.isDestroyed() || !this.anchor || !this.wantVisible) return;

    const w = Math.max(1, Math.ceil(size.width));
    const h = Math.max(1, Math.ceil(size.height));
    const a = this.anchor;
    const center = { x: Math.round(a.x + a.width / 2), y: Math.round(a.y + a.height / 2) };
    const wa = screen.getDisplayNearestPoint(center).workArea;
    const { GAP, MARGIN } = TooltipManager;

    let x = Math.round(center.x - w / 2);
    x = Math.max(wa.x + MARGIN, Math.min(x, wa.x + wa.width - w - MARGIN));

    let y = a.y - h - GAP;                       // prefer above
    if (y < wa.y + MARGIN) y = a.y + a.height + GAP; // fall back to below

    this.window.setBounds({ x, y, width: w, height: h });
    if (!this.window.isVisible()) this.window.showInactive();
  }

  public destroy() {
    this.clearWatchdog();
    this.stopPoll();
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
    }
    this.window = null;
    this.owner = null;
    this.ready = false;
  }
}

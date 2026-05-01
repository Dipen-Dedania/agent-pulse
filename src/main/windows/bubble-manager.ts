import { BrowserWindow, ipcMain, screen, app } from 'electron';
import path from 'path';
import { ToolId } from '../../common/types';

function getAppIconPath(): string {
  return path.join(
    app.getAppPath(),
    'public',
    'assets',
    'favicon',
    'android-chrome-512x512.png',
  );
}

export class BubbleManager {
  private bubbles: Map<ToolId, BrowserWindow> = new Map();

  private static readonly BUBBLE_SIZE = 70;
  private static readonly TOOLTIP_HEIGHT = 110;
  private static readonly EDGE_PADDING = 20;
  private static readonly STACK_GAP = 4;

  public init() {
    ipcMain.on('set-ignore-mouse', (event, { ignore }: { ignore: boolean }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      win.setIgnoreMouseEvents(ignore, { forward: true });
    });

    ipcMain.on(
      'move-bubble',
      (event, { dx, dy }: { dx: number; dy: number }) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        const bounds = win.getBounds();
        // Use setBounds to enforce size on every move — prevents Windows WM resize
        win.setBounds({
          x: bounds.x + dx,
          y: bounds.y + dy,
          width: BubbleManager.BUBBLE_SIZE,
          height: BubbleManager.BUBBLE_SIZE,
        });
      },
    );

    ipcMain.on('bubble-hover', (event, { hovered }: { hovered: boolean }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return;
      const [x, y] = win.getPosition();
      const totalHeight =
        BubbleManager.BUBBLE_SIZE + BubbleManager.TOOLTIP_HEIGHT;
      if (hovered) {
        // Relax max constraint, expand upward so the bubble stays in place
        win.setMaximumSize(BubbleManager.BUBBLE_SIZE, totalHeight);
        win.setSize(BubbleManager.BUBBLE_SIZE, totalHeight);
        win.setPosition(x, y - BubbleManager.TOOLTIP_HEIGHT);
      } else {
        win.setPosition(x, y + BubbleManager.TOOLTIP_HEIGHT);
        win.setSize(BubbleManager.BUBBLE_SIZE, BubbleManager.BUBBLE_SIZE);
        win.setMaximumSize(
          BubbleManager.BUBBLE_SIZE,
          BubbleManager.BUBBLE_SIZE,
        );
      }
    });
  }

  public createBubble(toolId: ToolId) {
    if (this.bubbles.has(toolId)) return;

    // Stack from bottom-right corner, each new bubble above the previous
    const { workArea } = screen.getPrimaryDisplay();
    const index = this.bubbles.size;
    const x =
      workArea.x +
      workArea.width -
      BubbleManager.BUBBLE_SIZE -
      BubbleManager.EDGE_PADDING;
    const y =
      workArea.y +
      workArea.height -
      BubbleManager.BUBBLE_SIZE -
      BubbleManager.EDGE_PADDING -
      index * (BubbleManager.BUBBLE_SIZE + BubbleManager.STACK_GAP);

    const window = new BrowserWindow({
      x,
      y,
      width: BubbleManager.BUBBLE_SIZE,
      height: BubbleManager.BUBBLE_SIZE,
      minWidth: BubbleManager.BUBBLE_SIZE,
      minHeight: BubbleManager.BUBBLE_SIZE,
      maxWidth: BubbleManager.BUBBLE_SIZE,
      maxHeight: BubbleManager.BUBBLE_SIZE,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: false,
      hasShadow: false,
      skipTaskbar: true,
      icon: getAppIconPath(),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    // Windows ignores resizable:false on frameless windows — block at the event level
    window.on('will-resize', (e) => e.preventDefault());

    // Start click-through; renderer will toggle per-pixel via 'set-ignore-mouse'
    window.setIgnoreMouseEvents(true, { forward: true });

    if (!app.isPackaged) {
      window.loadURL(`http://localhost:5173/bubble?toolId=${toolId}`);
    } else {
      window.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'), {
        query: { toolId },
      });
    }

    this.bubbles.set(toolId, window);
  }

  public destroyBubble(toolId: ToolId) {
    const window = this.bubbles.get(toolId);
    if (window) {
      window.close();
      this.bubbles.delete(toolId);
    }
  }
}

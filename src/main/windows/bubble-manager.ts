import { BrowserWindow } from 'electron';
import path from 'path';
import { ToolId } from '../../common/types';

export class BubbleManager {
  private bubbles: Map<ToolId, BrowserWindow> = new Map();

  public init() {
    // Initial bubbles can be loaded from a config file here
  }

  public createBubble(toolId: ToolId) {
    if (this.bubbles.has(toolId)) return;

    const window = new BrowserWindow({
      width: 100,
      height: 100,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    window.setIgnoreMouseEvents(false);

    if (process.env.NODE_ENV === 'development') {
      window.loadURL(`http://localhost:5173/bubble?toolId=${toolId}`);
    } else {
      window.loadFile(path.join(__dirname, '../../../index.html'), {
        query: { toolId }
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

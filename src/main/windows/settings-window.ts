import { BrowserWindow } from 'electron';
import path from 'path';

export class SettingsWindow {
  private window: BrowserWindow | null = null;

  public show() {
    if (this.window) {
      this.window.focus();
      return;
    }

    this.window = new BrowserWindow({
      width: 800,
      height: 600,
      title: 'Agent Pulse Settings',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), // Will create preload later
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    // In production, we'd load the dist/renderer/index.html
    if (process.env.NODE_ENV === 'development') {
      this.window.loadURL('http://localhost:5173');
    } else {
      this.window.loadFile(path.join(__dirname, '../../../index.html'));
    }

    this.window.on('closed', () => {
      this.window = null;
    });
  }
}

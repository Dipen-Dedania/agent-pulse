import { BrowserWindow, app } from 'electron';
import path from 'path';

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

export class SettingsWindow {
  private window: BrowserWindow | null = null;

  public show() {
    if (this.window) {
      this.window.focus();
      return;
    }

    this.window = new BrowserWindow({
      width: 900,
      height: 680,
      title: 'Agent Pulse Settings',
      icon: getAppIconPath(),
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
      this.window.loadFile(path.join(__dirname, '../../renderer/index.html'));
    }

    this.window.on('closed', () => {
      this.window = null;
    });
  }
}

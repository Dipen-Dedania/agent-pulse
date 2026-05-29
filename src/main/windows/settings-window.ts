import { BrowserWindow, app } from 'electron';
import path from 'path';
import { ENABLE_APP_MENU } from '../feature-flags';

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
      // Window may be hidden (closed-to-tray) — restore before focusing.
      if (!this.window.isVisible()) this.window.show();
      if (this.window.isMinimized()) this.window.restore();
      this.window.focus();
      return;
    }

    this.window = new BrowserWindow({
      width: 900,
      height: 680,
      title: 'Agent Pulse Settings',
      icon: getAppIconPath(),
      autoHideMenuBar: !ENABLE_APP_MENU,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), // Will create preload later
        nodeIntegration: false,
        contextIsolation: true,
        devTools: ENABLE_APP_MENU,
      },
    });

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

    this.window.on('closed', () => {
      this.window = null;
    });
  }
}

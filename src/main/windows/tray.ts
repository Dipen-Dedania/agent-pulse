import { Tray, Menu, app, nativeImage } from 'electron';
import path from 'path';
import { logger } from '../../common/logger';

// 32x32 PNG renders crisply at native tray size on Windows and HiDPI.
// PNG is more reliable than .ico in Electron's nativeImage loader — some
// favicon .ico files (especially single-resolution ones) load empty.
//
// Resolves relative to __dirname rather than app.getAppPath(): in dev mode
// `electron dist/main/index.js` makes app.getAppPath() return `dist/main`,
// which breaks the path. The compiled file lives at dist/main/windows/tray.js,
// so going up three levels lands on the project root in dev and on the asar
// root in packaged builds (public/ is asarUnpacked per package.json).
function getTrayIconPath(): string {
  return path.join(
    __dirname,
    '..', '..', '..',
    'public', 'assets', 'favicon', 'favicon-32x32.png',
  );
}

export interface TrayCallbacks {
  onShowSettings: () => void;
  onCheckForUpdates: () => void;
  onQuit: () => void;
}

export class TrayManager {
  private tray: Tray | null = null;

  public init(callbacks: TrayCallbacks) {
    if (this.tray) return;

    const iconPath = getTrayIconPath();
    const image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) {
      logger.warn(`[TrayManager] tray icon failed to load from ${iconPath}`);
    } else {
      logger.info(`[TrayManager] tray icon loaded from ${iconPath}, size=${JSON.stringify(image.getSize())}`);
    }
    this.tray = new Tray(image);
    this.tray.setToolTip('Agent Pulse');

    const menu = Menu.buildFromTemplate([
      {
        label: 'Check for Updates…',
        click: () => callbacks.onCheckForUpdates(),
      },
      { type: 'separator' },
      {
        label: 'Open Settings',
        click: () => callbacks.onShowSettings(),
      },
      { type: 'separator' },
      {
        label: 'Quit Agent Pulse',
        click: () => callbacks.onQuit(),
      },
    ]);
    this.tray.setContextMenu(menu);

    // Left-click / double-click should open settings — matches Windows tray convention.
    this.tray.on('click', () => callbacks.onShowSettings());
    this.tray.on('double-click', () => callbacks.onShowSettings());

    logger.info('[TrayManager] tray initialized');
  }

  public destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

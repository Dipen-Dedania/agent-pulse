import { Tray, Menu, app, nativeImage, NativeImage } from 'electron';
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
// root in packaged builds (public/ is asarUnpacked per electron-builder config).
//
// The 'update' variant is the same icon with a pre-rendered red dot in the
// top-right corner. Electron has no tray badge API, so "update available" is
// an image swap. Note: this is a full-colour icon, not a macOS template
// image; if the mac icon is ever converted to a monochrome template, the
// dotted variant must be re-authored as an alpha mask.
type TrayIconVariant = 'normal' | 'update';

function getTrayIconPath(variant: TrayIconVariant): string {
  const file = variant === 'update' ? 'favicon-32x32-update.png' : 'favicon-32x32.png';
  return path.join(__dirname, '..', '..', '..', 'public', 'assets', 'favicon', file);
}

function loadIcon(variant: TrayIconVariant): NativeImage {
  const iconPath = getTrayIconPath(variant);
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    logger.warn(`[TrayManager] tray icon (${variant}) failed to load from ${iconPath}`);
  } else {
    logger.info(`[TrayManager] tray icon (${variant}) loaded from ${iconPath}, size=${JSON.stringify(image.getSize())}`);
  }
  return image;
}

export interface TrayCallbacks {
  onShowSettings: () => void;
  onCheckForUpdates: () => void;
  onQuit: () => void;
}

export class TrayManager {
  private tray: Tray | null = null;
  private callbacks: TrayCallbacks | null = null;
  private normalImage: NativeImage | null = null;
  private updateImage: NativeImage | null = null;
  // Pending-update state is accepted before init() (the updater boots first)
  // and applied once the tray exists.
  private updatePending = false;
  private pendingVersion: string | null = null;

  public init(callbacks: TrayCallbacks) {
    if (this.tray) return;
    this.callbacks = callbacks;

    this.normalImage = loadIcon('normal');
    const update = loadIcon('update');
    // Never show a blank tray: fall back to the plain icon if the dotted
    // variant is missing (the tooltip + menu label still signal the update).
    this.updateImage = update.isEmpty() ? this.normalImage : update;

    this.tray = new Tray(this.updatePending ? this.updateImage : this.normalImage);
    this.tray.setContextMenu(this.buildMenu());
    this.applyIndicator();

    // Left-click / double-click should open settings — matches Windows tray convention.
    this.tray.on('click', () => callbacks.onShowSettings());
    this.tray.on('double-click', () => callbacks.onShowSettings());

    logger.info('[TrayManager] tray initialized');
  }

  /**
   * Reflect "a new version is available / downloaded" on the tray: dotted
   * icon, descriptive tooltip, "Download update…" menu label, and (macOS
   * only) a dock badge. Idempotent — the updater re-broadcasts the same
   * state on every periodic check, so repeat calls with no change are no-ops.
   * Safe to call before init(); the state is applied when the tray is built.
   */
  public setUpdatePending(pending: boolean, version: string | null = null) {
    if (pending === this.updatePending && version === this.pendingVersion) return;
    this.updatePending = pending;
    this.pendingVersion = pending ? version : null;
    if (!this.tray) return;
    this.applyIndicator();
    this.tray.setContextMenu(this.buildMenu());
  }

  public isUpdatePending(): boolean {
    return this.updatePending;
  }

  public destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
    this.setDockBadge(false);
  }

  private applyIndicator() {
    if (!this.tray) return;
    const image = this.updatePending ? this.updateImage : this.normalImage;
    if (image) this.tray.setImage(image);
    this.tray.setToolTip(
      this.updatePending
        ? `Agent Pulse — update${this.pendingVersion ? ` ${this.pendingVersion}` : ''} available`
        : 'Agent Pulse',
    );
    this.setDockBadge(this.updatePending);
  }

  private buildMenu(): Menu {
    const cb = this.callbacks!;
    return Menu.buildFromTemplate([
      {
        label: this.updatePending ? 'Download Update…' : 'Check for Updates…',
        click: () => cb.onCheckForUpdates(),
      },
      { type: 'separator' },
      {
        label: 'Open Settings',
        click: () => cb.onShowSettings(),
      },
      { type: 'separator' },
      {
        label: 'Quit Agent Pulse',
        click: () => cb.onQuit(),
      },
    ]);
  }

  // macOS dock badge is the native "something new" convention. `app.dock` is
  // undefined off-mac and on agent-only (LSUIElement) builds, so guard it.
  private setDockBadge(on: boolean) {
    if (process.platform !== 'darwin') return;
    try {
      app.dock?.setBadge(on ? '1' : '');
    } catch (e) {
      logger.debug('[TrayManager] dock badge unavailable', e);
    }
  }
}

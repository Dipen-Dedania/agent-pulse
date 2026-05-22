import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from '../common/logger';

// Linux uses XDG autostart .desktop files since Electron's setLoginItemSettings
// is a no-op there. ~/.config/autostart is the user-scope spec location.
const LINUX_AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const LINUX_DESKTOP_FILE = path.join(LINUX_AUTOSTART_DIR, 'agent-pulse.desktop');

function linuxDesktopEntry(execPath: string): string {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Agent Pulse',
    'Comment=Ambient awareness of AI coding agents',
    `Exec="${execPath}"`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

export function isAutoLaunchEnabled(): boolean {
  try {
    if (process.platform === 'linux') {
      return fs.existsSync(LINUX_DESKTOP_FILE);
    }
    return app.getLoginItemSettings().openAtLogin;
  } catch (e) {
    logger.warn('[auto-launch] failed to read state', e);
    return false;
  }
}

export function setAutoLaunch(enabled: boolean): boolean {
  // Auto-launch from a `npm start` dev session is meaningless (the exec path
  // points at electron.exe, not the user's packaged install). Skip silently.
  if (!app.isPackaged) {
    logger.info('[auto-launch] skipped — app is not packaged');
    return enabled;
  }
  try {
    if (process.platform === 'linux') {
      if (enabled) {
        fs.mkdirSync(LINUX_AUTOSTART_DIR, { recursive: true });
        fs.writeFileSync(LINUX_DESKTOP_FILE, linuxDesktopEntry(process.execPath), 'utf8');
      } else if (fs.existsSync(LINUX_DESKTOP_FILE)) {
        fs.unlinkSync(LINUX_DESKTOP_FILE);
      }
      return enabled;
    }
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // On macOS the LaunchAgent runs the app fresh; passing --hidden keeps the
      // settings window from popping up on every boot. Windows accepts it as a
      // CLI arg that we surface via process.argv if we ever want to honor it.
      openAsHidden: true,
      args: ['--auto-launch'],
    });
    return enabled;
  } catch (e) {
    logger.error('[auto-launch] failed to apply', e);
    return isAutoLaunchEnabled();
  }
}

import { app } from 'electron';

function envBool(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true'  || v === 'yes' || v === 'on')  return true;
  if (v === '0' || v === 'false' || v === 'no'  || v === 'off') return false;
  return undefined;
}

// Electron's default application menu exposes "View → Reload / Toggle DevTools"
// and other shortcuts (F12, Ctrl+Shift+I) that end users on a packaged build
// have no reason to hit. Keep it on in dev for the obvious workflow reasons;
// turn it off once we ship. Override either way with AGENT_PULSE_APP_MENU=0|1.
export const ENABLE_APP_MENU: boolean =
  envBool('AGENT_PULSE_APP_MENU') ?? !app.isPackaged;

// Auto-update service (electron-updater against GitHub Releases). Off in dev
// because electron-updater refuses to operate on unpackaged apps anyway and
// the IPC noise just clutters the log. Override with AGENT_PULSE_UPDATER=0|1.
export const ENABLE_UPDATER: boolean =
  envBool('AGENT_PULSE_UPDATER') ?? app.isPackaged;

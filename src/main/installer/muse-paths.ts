import os from 'os';
import path from 'path';

// ─── Where Muse Code keeps its config ────────────────────────────────────────
// Verified against Muse Code 1.4.1 on Windows 11: the config dir is
// `$XDG_CONFIG_HOME/muse`, else `~/.config/muse`, on EVERY platform — Muse's
// own launcher resolves `auth.json` there and the binary reads
// `~/.config/muse/settings.json` (it does NOT use %APPDATA%). Unlike the
// OpenCode helper we honour XDG_CONFIG_HOME unconditionally, because the
// launcher does so too.
//
// Data (sessions, plugin cache, bootstrap traces) lives under
// `~/.local/share/muse`; we never write there.
export function museConfigDir(): string {
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg && xdg.trim().length > 0) return path.join(xdg, 'muse');
  return path.join(os.homedir(), '.config', 'muse');
}

// The user-level settings file our hooks block is merged into. Muse refuses to
// start when this file exists without `"schema_version": 1` or when it carries
// a UTF-8 BOM, so every writer must preserve the former and never emit the
// latter (Node's fs.writeFileSync is BOM-free by default).
export function museSettingsPath(): string {
  return path.join(museConfigDir(), 'settings.json');
}

// Directory our hook scripts live in. Muse has no hooks dir of its own at the
// user level (project hooks go in `<repo>/.muse/hooks.json`), so this is an
// Agent Pulse convention next to the settings file.
export function museHooksDir(): string {
  return path.join(museConfigDir(), 'hooks');
}

export const MUSE_HOOK_SH = 'agent-pulse.sh';
export const MUSE_HOOK_PS1 = 'agent-pulse.ps1';

export function museHookShPath(): string {
  return path.join(museHooksDir(), MUSE_HOOK_SH);
}

export function museHookPs1Path(): string {
  return path.join(museHooksDir(), MUSE_HOOK_PS1);
}

// Native Windows install location (1.3.0+): a `muse.cmd` launcher next to a
// versioned `muse-bin-<ver>.exe`. The launcher also adds this dir to the user
// PATH, but a GUI-launched Agent Pulse may not see that PATH, so probe it.
export function museWindowsInstallDir(): string {
  const localAppData = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
  return path.join(localAppData, 'Programs', 'muse');
}

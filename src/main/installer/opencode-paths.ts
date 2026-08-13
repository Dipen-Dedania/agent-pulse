import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

// ─── Where OpenCode keeps its config ─────────────────────────────────────────
// Verified against OpenCode 1.18.18 on Windows 11: the config dir is literally
// `~/.config/opencode` on EVERY platform — it does NOT follow the Windows
// %APPDATA% convention the way VS Code / Cursor do. The boot log confirms it
// probes `<home>/.config/opencode/{config.json,opencode.json,opencode.jsonc}`.
//
// XDG_CONFIG_HOME is honoured defensively: if it is set AND the resulting
// directory already exists, prefer it. We never CREATE an XDG path that isn't
// already there — OpenCode's own resolution of that variable is unverified, and
// writing a plugin somewhere OpenCode doesn't read is worse than writing it to
// the path we have actually observed working.
export function opencodeConfigDir(): string {
  const xdg = process.env['XDG_CONFIG_HOME'];
  if (xdg) {
    const candidate = path.join(xdg, 'opencode');
    if (existsSync(candidate)) return candidate;
  }
  return path.join(os.homedir(), '.config', 'opencode');
}

// Plugin directory. OpenCode accepts both `plugins/` (current convention) and
// `plugin/` (back-compat). We WRITE to the plural form, but detection has to
// look at both so a plugin the user relocated still reads as installed.
export function opencodePluginDirs(): string[] {
  const root = opencodeConfigDir();
  return [path.join(root, 'plugins'), path.join(root, 'plugin')];
}

// Our plugin file. One file, no dependencies, no package.json — importing
// `@opencode-ai/plugin` for its types would make OpenCode shell out to Bun and
// install ~49MB of node_modules into the user's config dir on next boot.
export const OPENCODE_PLUGIN_FILENAME = 'agent-pulse.js';

export function opencodePluginPath(): string {
  return path.join(opencodeConfigDir(), 'plugins', OPENCODE_PLUGIN_FILENAME);
}

// Data dir (SQLite store + logs). Same cross-platform ~/.local/share shape.
// OPENCODE_DATA_DIR overrides it and may hold a COMMA-SEPARATED list, so this
// returns every entry.
export function opencodeDataDirs(): string[] {
  const override = process.env['OPENCODE_DATA_DIR'];
  if (override) {
    const parts = override.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts;
  }
  return [path.join(os.homedir(), '.local', 'share', 'opencode')];
}

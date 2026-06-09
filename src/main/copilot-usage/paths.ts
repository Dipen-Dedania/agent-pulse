// Resolves the path to VS Code's per-user SQLite state DB
// (…/Code/User/globalStorage/state.vscdb), where the built-in Copilot/GitHub
// auth provider stores non-secret METADATA in the `ItemTable` table:
//   github.copilot-github                              → signed-in username
//   extensionsAssignmentFilterProvider.copilotSku      → SKU (e.g. free_limited_copilot)
//
// (The OAuth token itself is NOT here — it lives in the OS keychain; see
// keychain.ts.) VS Code follows the same per-platform "user data directory"
// layout Cursor (a VS Code fork) uses — see cursor-usage/paths.ts.
//   - Windows: %APPDATA%\Code
//   - macOS:   ~/Library/Application Support/Code
//   - Linux:   $XDG_CONFIG_HOME/Code  (default ~/.config/Code)

import path from 'path';
import os from 'os';

const GLOBAL_STORAGE = path.join('User', 'globalStorage', 'state.vscdb');

export function vscodeStateDbPath(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32': {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      return path.join(appData, 'Code', GLOBAL_STORAGE);
    }
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Code', GLOBAL_STORAGE);
    default: {
      const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
      return path.join(xdg, 'Code', GLOBAL_STORAGE);
    }
  }
}

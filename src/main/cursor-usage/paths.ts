// Resolves the path to Cursor's per-user SQLite state DB
// (…/Cursor/User/globalStorage/state.vscdb), where Cursor stores its auth
// tokens under the `cursorAuth/*` keys in the `ItemTable` table.
//
// Cursor is a VS Code fork, so it follows the same per-platform "user data
// directory" layout VS Code uses:
//   - Windows: %APPDATA%\Cursor
//   - macOS:   ~/Library/Application Support/Cursor
//   - Linux:   $XDG_CONFIG_HOME/Cursor  (default ~/.config/Cursor)

import path from 'path';
import os from 'os';

const GLOBAL_STORAGE = path.join('User', 'globalStorage', 'state.vscdb');

export function cursorStateDbPath(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'win32': {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      return path.join(appData, 'Cursor', GLOBAL_STORAGE);
    }
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Cursor', GLOBAL_STORAGE);
    default: {
      const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
      return path.join(xdg, 'Cursor', GLOBAL_STORAGE);
    }
  }
}

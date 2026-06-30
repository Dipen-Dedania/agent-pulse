// Shared PATH resolution for child processes spawned from the main process.
//
// A GUI-launched Electron app (Finder / Dock / launchd login item) inherits a
// minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that omits `~/.local/bin`,
// Homebrew, nvm, etc. — exactly where CLIs like `claude` tend to live. Anything
// that shells out to `which`/`where` or spawns a user-installed binary needs the
// user's *real* login-shell PATH, not the one the app was launched with.

import { execFileSync } from 'child_process';
import { logger } from '../common/logger';

const SHELL_PATH_TIMEOUT_MS = 5_000;
// Sentinel that brackets `$PATH` in the login-shell probe output, so we can
// extract it cleanly past any MOTD/init noise an interactive shell prints.
const PATH_MARK = '__AGENT_PULSE_PATH__';

// Augmented PATH (login-shell PATH ∪ process PATH), cached for the app's lifetime.
let cachedPath: string | null = null;

/**
 * Resolve a usable PATH for child processes. Asks the user's login shell for its
 * real PATH and unions it with the PATH the app already has. Cached. Windows GUI
 * apps inherit the user PATH fine, so we leave it untouched there.
 */
export function resolveAugmentedPath(): string {
  if (cachedPath) return cachedPath;
  const base = process.env.PATH || '';
  if (process.platform === 'win32') {
    cachedPath = base;
    return cachedPath;
  }

  const parts = new Set(base.split(':').filter(Boolean));

  const shell = process.env.SHELL || '/bin/zsh';
  try {
    // `-ilc`: interactive login shell so nvm/rc files that set PATH are sourced.
    const out = execFileSync(shell, ['-ilc', `printf '%s%s%s' '${PATH_MARK}' "$PATH" '${PATH_MARK}'`], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: SHELL_PATH_TIMEOUT_MS,
    }).toString();
    const start = out.indexOf(PATH_MARK);
    const end = out.indexOf(PATH_MARK, start + PATH_MARK.length);
    if (start !== -1 && end !== -1) {
      const shellPath = out.slice(start + PATH_MARK.length, end);
      for (const p of shellPath.split(':')) if (p) parts.add(p);
    }
  } catch (e) {
    logger.debug('[shell-path] login-shell PATH probe failed', e);
  }

  cachedPath = [...parts].join(':');
  return cachedPath;
}

/** Clear the cached PATH (e.g. so a newly-installed CLI is picked up). */
export function resetAugmentedPathCache(): void {
  cachedPath = null;
}

// Shared PATH resolution for child processes spawned from the main process.
//
// A GUI-launched Electron app (Finder / Dock / launchd login item) inherits a
// minimal PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that omits `~/.local/bin`,
// Homebrew, nvm, etc. — exactly where CLIs like `claude` tend to live. Anything
// that shells out to `which`/`where` or spawns a user-installed binary needs the
// user's *real* login-shell PATH, not the one the app was launched with.

import { execFile, execFileSync } from 'child_process';
import { logger } from '../common/logger';

const SHELL_PATH_TIMEOUT_MS = 5_000;
// Sentinel that brackets `$PATH` in the login-shell probe output, so we can
// extract it cleanly past any MOTD/init noise an interactive shell prints.
const PATH_MARK = '__AGENT_PULSE_PATH__';

// Augmented PATH (login-shell PATH ∪ process PATH), cached for the app's lifetime.
let cachedPath: string | null = null;
// In-flight async probe, so concurrent callers share one login-shell spawn.
let pendingProbe: Promise<string> | null = null;

const probeArgs = (): [string, string[]] => [
  process.env.SHELL || '/bin/zsh',
  // `-ilc`: interactive login shell so nvm/rc files that set PATH are sourced.
  ['-ilc', `printf '%s%s%s' '${PATH_MARK}' "$PATH" '${PATH_MARK}'`],
];

/** Union the process PATH with the PATH a login-shell probe printed. */
function mergeShellPath(base: string, probeOutput: string | null): string {
  const parts = new Set(base.split(':').filter(Boolean));
  if (probeOutput) {
    const start = probeOutput.indexOf(PATH_MARK);
    const end = probeOutput.indexOf(PATH_MARK, start + PATH_MARK.length);
    if (start !== -1 && end !== -1) {
      const shellPath = probeOutput.slice(start + PATH_MARK.length, end);
      for (const p of shellPath.split(':')) if (p) parts.add(p);
    }
  }
  return [...parts].join(':');
}

/**
 * Resolve a usable PATH for child processes. Asks the user's login shell for its
 * real PATH and unions it with the PATH the app already has. Cached. Windows GUI
 * apps inherit the user PATH fine, so we leave it untouched there.
 *
 * Synchronous: blocks the main thread for the probe (100ms–1s+, capped at 5s)
 * on its first call. Launch-path callers use `resolveAugmentedPathAsync`.
 */
export function resolveAugmentedPath(): string {
  if (cachedPath) return cachedPath;
  const base = process.env.PATH || '';
  if (process.platform === 'win32') {
    cachedPath = base;
    return cachedPath;
  }

  let out: string | null = null;
  const [shell, args] = probeArgs();
  try {
    out = execFileSync(shell, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: SHELL_PATH_TIMEOUT_MS,
    }).toString();
  } catch (e) {
    logger.debug('[shell-path] login-shell PATH probe failed', e);
  }

  cachedPath = mergeShellPath(base, out);
  return cachedPath;
}

/**
 * Same result as `resolveAugmentedPath`, without blocking: the login-shell
 * probe runs as an async child process and concurrent callers share it. Shares
 * the cache with the sync variant, so whichever runs first fills it for both.
 */
export function resolveAugmentedPathAsync(): Promise<string> {
  if (cachedPath) return Promise.resolve(cachedPath);
  const base = process.env.PATH || '';
  if (process.platform === 'win32') {
    cachedPath = base;
    return Promise.resolve(cachedPath);
  }
  if (pendingProbe) return pendingProbe;

  const [shell, args] = probeArgs();
  pendingProbe = new Promise<string>((resolve) => {
    execFile(shell, args, { timeout: SHELL_PATH_TIMEOUT_MS }, (err, stdout) => {
      if (err) logger.debug('[shell-path] async login-shell PATH probe failed', err);
      // The sync variant may have filled the cache while we were waiting.
      if (!cachedPath) cachedPath = mergeShellPath(base, err ? null : String(stdout));
      pendingProbe = null;
      resolve(cachedPath);
    });
  });
  return pendingProbe;
}

/** Clear the cached PATH (e.g. so a newly-installed CLI is picked up). */
export function resetAugmentedPathCache(): void {
  cachedPath = null;
}

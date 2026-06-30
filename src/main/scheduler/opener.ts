// The scheduler's one action: a minimal `claude -p --model haiku` ping. It
// anchors a fresh 5-hour window (if the previous one expired) and refreshes
// Claude Code's OAuth token in the same call. No prep, no content — just the
// reset. Runs inside the Electron main process, i.e. the user's logged-in
// session, so Claude Code's own credentials resolve (this is *why* the
// scheduler lives here rather than OS cron).

import { execFile, execFileSync, ExecFileException } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../../common/logger';
import { resolveAugmentedPath, resetAugmentedPathCache } from '../shell-path';

// Trivial prompt — its only job is to make Claude Code bootstrap auth + open a
// window. Kept to a single token so the spend is a rounding error.
const PROMPT = 'ok';
const OPENER_TIMEOUT_MS = 60_000;

export interface OpenerResult {
  ok: boolean;
  reason?: string;
}

// Positive cache only: an absolute path that exists. Left null after a failed
// lookup so a later `claude` install is picked up on the next attempt (openers
// are hours apart, so re-running `where`/`which` costs nothing).
let cachedBin: string | null = null;

/** Well-known absolute dirs where `claude` is commonly installed (POSIX). */
function wellKnownDirs(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.local', 'bin'),   // native installer (curl | sh)
    path.join(home, '.claude', 'local'), // Claude Code local install
    '/opt/homebrew/bin',                 // Apple-silicon Homebrew
    '/usr/local/bin',                    // Intel Homebrew / manual
    path.join(home, 'bin'),
  ];
}

/**
 * Resolve the `claude` executable. First `which`/`where` against an augmented
 * PATH (see resolveAugmentedPath); if that misses, probe well-known absolute
 * install locations directly. On Windows, prefer the `.cmd`/`.exe` shim (what
 * cmd.exe can actually launch) over the POSIX shell script npm also drops.
 * Returns null when `claude` can't be found anywhere.
 */
export function resolveClaudeBin(): string | null {
  if (cachedBin) return cachedBin;
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const env = { ...process.env, PATH: resolveAugmentedPath() };
  try {
    const out = execFileSync(lookup, ['claude'], { stdio: ['ignore', 'pipe', 'ignore'], env })
      .toString()
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (out.length > 0) {
      if (process.platform === 'win32') {
        const runnable = out.find((p) => /\.(cmd|exe|bat)$/i.test(p));
        cachedBin = runnable ?? out[0];
      } else {
        cachedBin = out[0];
      }
      return cachedBin;
    }
  } catch {
    // fall through to absolute-path probing
  }

  // PATH lookup came up empty — probe known install locations directly.
  const names = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude.bat'] : ['claude'];
  for (const dir of wellKnownDirs()) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (existsSync(candidate)) {
        cachedBin = candidate;
        return cachedBin;
      }
    }
  }
  return null;
}

/** Clear the cached path (e.g. after a "claude not found" failure surfaced to the user). */
export function resetClaudeBinCache(): void {
  cachedBin = null;
  resetAugmentedPathCache();
}

/**
 * Fire one opener ping. Never throws — every failure is returned as a
 * structured result so the engine/UI can surface it. Resolves once the child
 * process exits (or the timeout kills it).
 */
export function fireOpener(): Promise<OpenerResult> {
  return new Promise((resolve) => {
    const bin = resolveClaudeBin();
    if (!bin) {
      resolve({ ok: false, reason: 'claude CLI not found on PATH' });
      return;
    }

    // On Windows, npm shims are `.cmd` files that execFile can't launch
    // directly — route through cmd.exe. Args are fixed constants (no user
    // input), so this is injection-safe; Node quotes a spaced path for us.
    const isWin = process.platform === 'win32';
    const file = isWin ? (process.env.ComSpec || 'cmd.exe') : bin;
    const args = isWin
      ? ['/c', bin, '-p', PROMPT, '--model', 'haiku']
      : ['-p', PROMPT, '--model', 'haiku'];

    execFile(
      file,
      args,
      { timeout: OPENER_TIMEOUT_MS, windowsHide: true },
      (err: ExecFileException | null) => {
        if (err) {
          const reason = err.killed
            ? `opener timed out after ${OPENER_TIMEOUT_MS / 1000}s`
            : err.message;
          // A non-zero exit may mean a real failure or a benign "rode a live
          // window" — we can't tell from the exit code, so report the message.
          if (err.code === 'ENOENT') resetClaudeBinCache();
          logger.warn('[scheduler/opener] ping failed:', reason);
          resolve({ ok: false, reason });
          return;
        }
        logger.info('[scheduler/opener] ping completed');
        resolve({ ok: true });
      },
    );
  });
}

// The scheduler's one action: a minimal `claude -p --model haiku` ping. It
// anchors a fresh 5-hour window (if the previous one expired) and refreshes
// Claude Code's OAuth token in the same call. No prep, no content — just the
// reset. Runs inside the Electron main process, i.e. the user's logged-in
// session, so Claude Code's own credentials resolve (this is *why* the
// scheduler lives here rather than OS cron).
//
// The spawn/shim/timeout machinery (`spawnPing`, `lookupOnPath`) is shared with
// the Codex opener (./codex-opener.ts); the Claude-specific bits stay here so
// every existing import keeps working unchanged.

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
 * `where`/`which` a command name against the augmented PATH (see
 * resolveAugmentedPath). Returns every hit in PATH order, trimmed, so callers
 * can apply their own preference (Windows shims vs POSIX scripts). Empty on a
 * miss or when the lookup tool itself fails.
 */
export function lookupOnPath(name: string): string[] {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const env = { ...process.env, PATH: resolveAugmentedPath() };
  try {
    return execFileSync(lookup, [name], { stdio: ['ignore', 'pipe', 'ignore'], env })
      .toString()
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
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
  const out = lookupOnPath('claude');
  if (out.length > 0) {
    if (process.platform === 'win32') {
      const runnable = out.find((p) => /\.(cmd|exe|bat)$/i.test(p));
      cachedBin = runnable ?? out[0];
    } else {
      cachedBin = out[0];
    }
    return cachedBin;
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
 * Build the argv for launching a `.cmd`/`.bat` shim through cmd.exe.
 *
 * Why not `['/c', bin, ...args]` and let Node quote spaced entries? cmd.exe's
 * quote handling depends on HOW MANY quote characters end up on the line:
 * with exactly two (a spaced bin path, no spaced args) it keeps them, but the
 * moment a second spaced argument appears (e.g. the resume continuation
 * prompt) cmd falls back to stripping the FIRST and LAST quote — the bin path
 * loses its opening quote and `C:\Program Files\...` dies as
 * `'C:\Program' is not recognized`. Verified empirically; see the backlog
 * runner's resume path for the argv that triggered it.
 *
 * `/s /c "<line>"` pins the sane rule instead: cmd strips exactly the outer
 * quotes and executes the rest verbatim, regardless of how many inner quotes
 * exist. Callers MUST spawn with `windowsVerbatimArguments: true` so Node
 * passes the line through untouched (its own re-quoting would break it).
 *
 * Every arg is quote-wrapped when it contains whitespace. Embedded `"` are
 * stripped defensively — no legitimate arg has them (bin comes from `where`,
 * the rest are fixed constants or strict-charset-gated), and cmd has no safe
 * escape for them anyway.
 */
export function buildCmdShimArgs(bin: string, args: string[]): string[] {
  const quote = (a: string) => {
    const clean = a.replace(/"/g, '');
    return /\s/.test(clean) ? `"${clean}"` : clean;
  };
  const line = [bin, ...args].map(quote).join(' ');
  return ['/d', '/s', '/c', `"${line}"`];
}

export interface PingSpec {
  /** Absolute path (or shim) of the CLI to run. */
  bin: string;
  /** Fixed, injection-safe argv. */
  args: string[];
  timeoutMs: number;
  cwd?: string;
  /** Log prefix, e.g. '[scheduler/opener]'. */
  logTag: string;
  /** Called on ENOENT so the caller can drop its cached binary path. */
  onEnoent?: () => void;
}

/**
 * Spawn one ping and resolve with a structured result. Never throws. On
 * Windows the command is routed through cmd.exe (see buildCmdShimArgs) so
 * `.cmd` shims launch; args are fixed constants, so this is injection-safe.
 */
export function spawnPing(spec: PingSpec): Promise<OpenerResult> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const file = isWin ? (process.env.ComSpec || 'cmd.exe') : spec.bin;
    const args = isWin ? buildCmdShimArgs(spec.bin, spec.args) : spec.args;

    const child = execFile(
      file,
      args,
      { timeout: spec.timeoutMs, windowsHide: true, windowsVerbatimArguments: isWin, cwd: spec.cwd },
      (err: ExecFileException | null) => {
        if (err) {
          const reason = err.killed
            ? `opener timed out after ${spec.timeoutMs / 1000}s`
            : err.message;
          // A non-zero exit may mean a real failure or a benign "rode a live
          // window" — we can't tell from the exit code, so report the message.
          if (err.code === 'ENOENT') spec.onEnoent?.();
          logger.warn(`${spec.logTag} ping failed:`, reason);
          resolve({ ok: false, reason });
          return;
        }
        logger.info(`${spec.logTag} ping completed`);
        resolve({ ok: true });
      },
    );
    // execFile leaves stdin as an open pipe. `codex exec` treats a non-TTY
    // stdin as extra prompt input and blocks until EOF ("Reading additional
    // input from stdin…"), which turned every ping into a timeout. Closing it
    // up front is a no-op for `claude -p`.
    child.stdin?.end();
  });
}

/**
 * Fire one opener ping. Never throws — every failure is returned as a
 * structured result so the engine/UI can surface it. Resolves once the child
 * process exits (or the timeout kills it).
 */
export function fireOpener(): Promise<OpenerResult> {
  const bin = resolveClaudeBin();
  if (!bin) {
    return Promise.resolve({ ok: false, reason: 'claude CLI not found on PATH' });
  }
  return spawnPing({
    bin,
    args: ['-p', PROMPT, '--model', 'haiku'],
    timeoutMs: OPENER_TIMEOUT_MS,
    logTag: '[scheduler/opener]',
    onEnoent: resetClaudeBinCache,
  });
}

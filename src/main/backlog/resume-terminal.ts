// Opens an INTERACTIVE `claude --resume <sessionId>` in a fresh terminal window
// so the user can pick a headless run's conversation back up by hand. Unlike
// the runner (which spawns `claude -p` headless and captures stdout), this
// hands the session to a visible terminal and detaches — Agent Pulse doesn't
// track the resumed session.
//
// Session lookup is scoped to the directory `claude` runs in, so `cwd` MUST be
// the same directory the headless run used (the card's worktree). Safety: the
// session id is charset-gated by the caller (isSafeSessionId) and the bin comes
// from `where`/`which` — no renderer-supplied string reaches the shell.

import { spawn } from 'child_process';
import { logger } from '../../common/logger';

export interface ResumeLaunchResult {
  ok: boolean;
  reason?: string;
}

/**
 * Build the Windows command line launched via `cmd.exe /d /s /c`.
 *
 * `start` opens a NEW console window (whose cwd it inherits from the launching
 * cmd — we set that via spawn's `cwd`), and `cmd /k` keeps that window open
 * after `claude` exits so the conversation output stays on screen. The bin path
 * is quote-wrapped so a spaced install dir (`C:\Program Files\…`) survives; this
 * is the documented 2-quote case cmd keeps intact (see opener.ts:buildCmdShimArgs).
 * Callers spawn with `windowsVerbatimArguments: true` so Node passes the line
 * through untouched. Any embedded `"` in the bin is stripped defensively — a
 * `where`-resolved path never legitimately contains one.
 */
export function buildWindowsResumeLine(bin: string, sessionId: string): string {
  const cleanBin = bin.replace(/"/g, '');
  return `start "Agent Pulse - Resume" cmd /k "${cleanBin}" --resume ${sessionId}`;
}

/** POSIX single-quote a value so spaces/metacharacters can't break the shell line. */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Open an interactive terminal running `claude --resume <sessionId>` in `cwd`.
 * Fire-and-forget: the child is detached and unref'd so it outlives Agent Pulse.
 * Never throws — failures come back as a structured reason for the UI to show.
 */
export function launchResumeTerminal(bin: string, cwd: string, sessionId: string): ResumeLaunchResult {
  try {
    if (process.platform === 'win32') {
      const line = buildWindowsResumeLine(bin, sessionId);
      const child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
        cwd,
        windowsVerbatimArguments: true,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { ok: true };
    }

    if (process.platform === 'darwin') {
      // AppleScript is the only reliable way to open Terminal.app at a cwd with
      // a command. `exec` replaces the shell with claude so closing it ends cleanly.
      const inner = `cd ${shSingleQuote(cwd)} && exec ${shSingleQuote(bin)} --resume ${sessionId}`;
      const script = `tell application "Terminal"\nactivate\ndo script ${shSingleQuote(inner)}\nend tell`;
      const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true };
    }

    // Linux: best-effort via the distro's default terminal alternative. `; exec
    // $SHELL` keeps the window open after claude exits.
    const inner = `cd ${shSingleQuote(cwd)} && ${shSingleQuote(bin)} --resume ${sessionId}; exec "$SHELL"`;
    const child = spawn('x-terminal-emulator', ['-e', 'bash', '-c', inner], { detached: true, stdio: 'ignore' });
    child.unref();
    child.on('error', (e) => logger.warn('[Backlog/resume] x-terminal-emulator not available:', e?.message ?? e));
    return { ok: true };
  } catch (e: any) {
    logger.warn('[Backlog/resume] failed to launch terminal:', e?.message ?? e);
    return { ok: false, reason: `could not open a terminal (${e?.message ?? e})` };
  }
}

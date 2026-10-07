// Opens an INTERACTIVE resume of a headless run in a fresh terminal window —
// `claude --resume <sessionId>` or `codex resume <threadId>` depending on the
// card's agent — so the user can pick the conversation back up by hand.
// Unlike the runner (which spawns the CLI headless and captures stdout), this
// hands the session to a visible terminal and detaches — Agent Pulse doesn't
// track the resumed session.
//
// Session lookup is scoped to the directory the CLI runs in, so `cwd` MUST be
// the same directory the headless run used (the card's worktree). Safety: the
// session id is charset-gated by the caller (isSafeSessionId) and the bin comes
// from `where`/`which` — no renderer-supplied string reaches the shell.

import { spawn } from 'child_process';
import { logger } from '../../common/logger';
import { BacklogAgent } from '../../common/backlog-types';

export interface ResumeLaunchResult {
  ok: boolean;
  reason?: string;
}

/** The CLI's own resume argv (both CLIs verified: `claude --resume`, `codex resume`). */
export function resumeArgs(agent: BacklogAgent, sessionId: string): string[] {
  return agent === 'codex' ? ['resume', sessionId] : ['--resume', sessionId];
}

/**
 * Build the Windows command line launched via `cmd.exe /d /s /c`.
 *
 * `start` opens a NEW console window (whose cwd it inherits from the launching
 * cmd — we set that via spawn's `cwd`), and `cmd /k` keeps that window open
 * after the CLI exits so the conversation output stays on screen. The bin path
 * is quote-wrapped so a spaced install dir (`C:\Program Files\…`) survives; this
 * is the documented 2-quote case cmd keeps intact (see opener.ts:buildCmdShimArgs).
 * Callers spawn with `windowsVerbatimArguments: true` so Node passes the line
 * through untouched. Any embedded `"` in the bin is stripped defensively — a
 * `where`-resolved path never legitimately contains one.
 */
export function buildWindowsResumeLine(bin: string, sessionId: string, agent: BacklogAgent = 'claude'): string {
  const cleanBin = bin.replace(/"/g, '');
  return `start "Agent Pulse - Resume" cmd /k "${cleanBin}" ${resumeArgs(agent, sessionId).join(' ')}`;
}

/** POSIX single-quote a value so spaces/metacharacters can't break the shell line. */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Open an interactive terminal resuming `sessionId` with the agent's CLI in
 * `cwd`. Fire-and-forget: the child is detached and unref'd so it outlives
 * Agent Pulse. Never throws — failures come back as a structured reason for
 * the UI to show.
 */
export function launchResumeTerminal(
  bin: string,
  cwd: string,
  sessionId: string,
  agent: BacklogAgent = 'claude',
): ResumeLaunchResult {
  const argv = resumeArgs(agent, sessionId).join(' ');
  try {
    if (process.platform === 'win32') {
      const line = buildWindowsResumeLine(bin, sessionId, agent);
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
      // a command. `exec` replaces the shell with the CLI so closing it ends cleanly.
      const inner = `cd ${shSingleQuote(cwd)} && exec ${shSingleQuote(bin)} ${argv}`;
      const script = `tell application "Terminal"\nactivate\ndo script ${shSingleQuote(inner)}\nend tell`;
      const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true };
    }

    // Linux: best-effort via the distro's default terminal alternative. `; exec
    // $SHELL` keeps the window open after the CLI exits.
    const inner = `cd ${shSingleQuote(cwd)} && ${shSingleQuote(bin)} ${argv}; exec "$SHELL"`;
    const child = spawn('x-terminal-emulator', ['-e', 'bash', '-c', inner], { detached: true, stdio: 'ignore' });
    child.unref();
    child.on('error', (e) => logger.warn('[Backlog/resume] x-terminal-emulator not available:', e?.message ?? e));
    return { ok: true };
  } catch (e: any) {
    logger.warn('[Backlog/resume] failed to launch terminal:', e?.message ?? e);
    return { ok: false, reason: `could not open a terminal (${e?.message ?? e})` };
  }
}

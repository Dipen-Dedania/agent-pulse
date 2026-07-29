// Opens an INTERACTIVE `claude --session-id <uuid> --permission-mode plan` in a
// fresh terminal so the user can plan a refinement card by hand — the native
// Claude Code plan-mode Q&A. Sibling of resume-terminal.ts (same detach + quote
// posture); the difference is a fresh session (a pre-generated UUID we control
// via --session-id, so we can later find its transcript) started in plan mode.
//
// Plan mode is read-only — it presents a plan and makes no edits without an
// explicit exit+approve — so this is safe to run in the real project repo (no
// worktree needed). The UUID is charset-safe (no cmd.exe metacharacters) and
// generated in main, never renderer text; the bin comes from `where`/`which`.

import { spawn } from 'child_process';
import { logger } from '../../common/logger';

export interface RefineLaunchResult {
  ok: boolean;
  reason?: string;
}

/**
 * Build the Windows command line launched via `cmd.exe /d /s /c`. Mirrors
 * buildWindowsResumeLine: `start` opens a new console (cwd inherited from the
 * launching cmd via spawn's `cwd`), `cmd /k` keeps it open after claude exits.
 * The bin path is quote-wrapped so a spaced install dir survives; any embedded
 * `"` is stripped defensively (a `where`-resolved path never has one).
 */
export function buildWindowsRefineLine(bin: string, sessionId: string): string {
  const cleanBin = bin.replace(/"/g, '');
  return `start "Agent Pulse - Refine" cmd /k "${cleanBin}" --session-id ${sessionId} --permission-mode plan`;
}

/** POSIX single-quote a value so spaces/metacharacters can't break the shell line. */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Open an interactive plan-mode terminal for a fresh session in `cwd`.
 * Fire-and-forget: the child is detached and unref'd so it outlives Agent Pulse.
 * Never throws — failures come back as a structured reason for the UI to show.
 */
export function launchPlanTerminal(bin: string, cwd: string, sessionId: string): RefineLaunchResult {
  try {
    if (process.platform === 'win32') {
      const line = buildWindowsRefineLine(bin, sessionId);
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
      const inner = `cd ${shSingleQuote(cwd)} && exec ${shSingleQuote(bin)} --session-id ${sessionId} --permission-mode plan`;
      const script = `tell application "Terminal"\nactivate\ndo script ${shSingleQuote(inner)}\nend tell`;
      const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
      child.unref();
      return { ok: true };
    }

    const inner = `cd ${shSingleQuote(cwd)} && ${shSingleQuote(bin)} --session-id ${sessionId} --permission-mode plan; exec "$SHELL"`;
    const child = spawn('x-terminal-emulator', ['-e', 'bash', '-c', inner], { detached: true, stdio: 'ignore' });
    child.unref();
    child.on('error', (e) => logger.warn('[Backlog/refine] x-terminal-emulator not available:', e?.message ?? e));
    return { ok: true };
  } catch (e: any) {
    logger.warn('[Backlog/refine] failed to launch terminal:', e?.message ?? e);
    return { ok: false, reason: `could not open a terminal (${e?.message ?? e})` };
  }
}

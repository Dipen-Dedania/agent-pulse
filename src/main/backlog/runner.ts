// Headless executor for one backlog card: spawns `claude -p` in the card's
// project repo, feeds the prompt via STDIN, and parses the single-JSON-object
// output. Never throws — every failure comes back as a structured result,
// mirroring fireOpener in ../scheduler/opener.
//
// Safety posture (Phase 1, research tasks only):
//  - never passes --dangerously-skip-permissions: headless mode denies
//    permission-gated tools (Write/Edit/Bash) by default, so runs are
//    read-only by construction;
//  - --disallowedTools adds an explicit deny list as belt-and-braces;
//  - the prompt goes over stdin, never argv — user text through `cmd.exe /c`
//    is not quoting-safe (the opener's argv args are fixed constants; ours
//    are not). The one variable argv entry, the card's model, is gated by
//    isSafeModelId (strict charset, no cmd.exe metacharacters).

import { spawn, execFile, execFileSync, ChildProcess } from 'child_process';
import { logger } from '../../common/logger';
import { isSafeModelId } from '../../common/backlog-types';
import { resolveClaudeBin, resetClaudeBinCache } from '../scheduler/opener';

// Verified against the installed CLI (see plan spike): --disallowedTools takes
// a comma-separated list; --output-format json emits one result object with
// result/is_error/total_cost_usd/num_turns/session_id. Note: this CLI version
// has no --max-turns — the time budget kill below is the hard cap.
const DISALLOWED_TOOLS = 'Write,Edit,NotebookEdit,Bash';
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // guard against a runaway stdout
const POSIX_SIGKILL_DELAY_MS = 5_000;

export type RunnerOutcome = 'success' | 'failed' | 'killed';

export interface RunnerResult {
  outcome: RunnerOutcome;
  report?: string;             // final markdown (on success)
  reason?: string;             // failure / kill detail
  killOutcome?: 'killed' | 'paused'; // how a kill should be recorded on the attempt
  costUsd: number | null;
  numTurns: number | null;
  sessionId: string | null;
}

export interface RunnerHandle {
  promise: Promise<RunnerResult>;
  /**
   * Terminate the run. `attemptOutcome` distinguishes a budget overrun
   * ('killed') from a window-end grace expiry ('paused') in the attempt
   * history; the card lands in Paused either way.
   */
  kill: (reason: string, attemptOutcome: 'killed' | 'paused') => void;
  /**
   * Blocking variant for app quit: `before-quit` is synchronous, so an async
   * taskkill may not finish before Electron exits, orphaning the cmd.exe →
   * claude subtree (which keeps spending tokens).
   */
  killSync: (reason: string) => void;
}

export interface ParsedClaudeOutput {
  ok: boolean;
  report?: string;
  reason?: string;
  costUsd: number | null;
  numTurns: number | null;
  sessionId: string | null;
}

/**
 * Parse `claude -p --output-format json` stdout: a single JSON object, though
 * warnings may precede it — scan lines from the end for the result object.
 * Pure function, unit-tested.
 */
export function parseClaudeJsonOutput(stdout: string): ParsedClaudeOutput {
  const fail = (reason: string): ParsedClaudeOutput =>
    ({ ok: false, reason, costUsd: null, numTurns: null, sessionId: null });

  const lines = stdout.trim().split(/\r?\n/);
  let parsed: any = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const candidate = JSON.parse(line);
      if (candidate && typeof candidate === 'object' && 'result' in candidate) {
        parsed = candidate;
        break;
      }
    } catch {
      // keep scanning
    }
  }
  if (!parsed) return fail('no JSON result object found in claude output');

  const costUsd = typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null;
  const numTurns = typeof parsed.num_turns === 'number' ? parsed.num_turns : null;
  const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : null;

  if (parsed.is_error) {
    return { ok: false, reason: typeof parsed.result === 'string' && parsed.result ? parsed.result : 'claude reported an error', costUsd, numTurns, sessionId };
  }
  const report = typeof parsed.result === 'string' ? parsed.result.trim() : '';
  if (!report) {
    return { ok: false, reason: 'claude returned an empty result', costUsd, numTurns, sessionId };
  }
  return { ok: true, report, costUsd, numTurns, sessionId };
}

/** Kill a child and (on Windows) its whole cmd.exe subtree. */
function killTree(child: ChildProcess): void {
  if (child.pid == null || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // `child.kill()` only signals cmd.exe and orphans the real node/claude
    // process underneath — taskkill /t takes the whole tree down.
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], (err) => {
      if (err) logger.warn('[Backlog/runner] taskkill failed:', err.message);
    });
  } else {
    child.kill('SIGTERM');
    const escalate = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    }, POSIX_SIGKILL_DELAY_MS);
    escalate.unref?.();
  }
}

/** Blocking tree kill for the app-quit path. */
function killTreeSync(child: ChildProcess): void {
  if (child.pid == null || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { timeout: 5_000, stdio: 'ignore' });
    } catch (e: any) {
      logger.warn('[Backlog/runner] sync taskkill failed:', e?.message ?? e);
    }
  } else {
    // No blocking escalation on POSIX — SIGKILL immediately, the app is quitting.
    child.kill('SIGKILL');
  }
}

/**
 * Execute one research run: `claude -p` with `cwd` set to the project repo
 * and a hard time budget. `model` (the card's override) is passed as
 * `--model` when set; null falls back to the project/CLI default. The
 * returned handle's `kill` is also used by the engine for window-end grace
 * expiry and app quit.
 */
export function executeCard(prompt: string, cwd: string, budgetMs: number, model?: string | null): RunnerHandle {
  let killInfo: { reason: string; attemptOutcome: 'killed' | 'paused' } | null = null;
  let child: ChildProcess | null = null;

  const promise = new Promise<RunnerResult>((resolve) => {
    const failed = (reason: string): RunnerResult =>
      ({ outcome: 'failed', reason, costUsd: null, numTurns: null, sessionId: null });

    const bin = resolveClaudeBin();
    if (!bin) {
      resolve(failed('claude CLI not found on PATH'));
      return;
    }

    // Windows npm shims are .cmd files spawn can't launch directly — route
    // through cmd.exe (same as the opener). The bin path comes from `where`,
    // and all argv entries are fixed constants; the untrusted prompt goes
    // over stdin.
    const isWin = process.platform === 'win32';
    const file = isWin ? (process.env.ComSpec || 'cmd.exe') : bin;
    const baseArgs = ['-p', '--output-format', 'json', '--disallowedTools', DISALLOWED_TOOLS];
    if (model) {
      // Store normalization should have rejected unsafe values already —
      // re-check here since this string reaches cmd.exe argv.
      if (isSafeModelId(model)) baseArgs.push('--model', model);
      else logger.warn(`[Backlog/runner] ignoring unsafe model id ${JSON.stringify(model)} — using default`);
    }
    const args = isWin ? ['/c', bin, ...baseArgs] : baseArgs;

    let proc: ChildProcess;
    try {
      proc = spawn(file, args, { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e: any) {
      resolve(failed(`failed to spawn claude: ${e?.message ?? e}`));
      return;
    }
    child = proc;

    let stdout = '';
    let stdoutTruncated = false;
    let stderr = '';
    let settled = false;

    const budgetTimer = setTimeout(() => {
      if (killInfo) return; // an earlier kill already owns the outcome
      killInfo = { reason: `time budget exceeded (${Math.round(budgetMs / 60_000)} min)`, attemptOutcome: 'killed' };
      logger.warn(`[Backlog/runner] ${killInfo.reason} — killing process tree`);
      killTree(proc);
    }, budgetMs);
    budgetTimer.unref?.();

    const settle = (result: RunnerResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(budgetTimer);
      resolve(result);
    };

    proc.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf8');
      else stdoutTruncated = true;
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
    });

    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') resetClaudeBinCache();
      settle(failed(`claude process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (killInfo) {
        settle({
          outcome: 'killed',
          reason: killInfo.reason,
          killOutcome: killInfo.attemptOutcome,
          costUsd: null,
          numTurns: null,
          sessionId: null,
        });
        return;
      }
      const parsed = parseClaudeJsonOutput(stdout);
      if (!parsed.ok && stdoutTruncated) {
        settle(failed(`claude output exceeded ${MAX_OUTPUT_BYTES / (1024 * 1024)}MB and was truncated — the result could not be parsed`));
        return;
      }
      if (code !== 0 && !parsed.ok) {
        const detail = stderr.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 500);
        settle(failed(`claude exited with code ${code}${detail ? `: ${detail}` : ''}`));
        return;
      }
      if (!parsed.ok) {
        settle({ outcome: 'failed', reason: parsed.reason, costUsd: parsed.costUsd, numTurns: parsed.numTurns, sessionId: parsed.sessionId });
        return;
      }
      settle({ outcome: 'success', report: parsed.report, costUsd: parsed.costUsd, numTurns: parsed.numTurns, sessionId: parsed.sessionId });
    });

    // Feed the prompt and close stdin so -p reads it as the full input.
    proc.stdin?.on('error', () => { /* EPIPE if the child died early — close handler reports it */ });
    proc.stdin?.write(prompt, 'utf8');
    proc.stdin?.end();
  });

  return {
    promise,
    kill: (reason, attemptOutcome) => {
      if (!child || child.exitCode !== null || killInfo) return;
      killInfo = { reason, attemptOutcome };
      logger.info(`[Backlog/runner] kill requested: ${reason}`);
      killTree(child);
    },
    killSync: (reason) => {
      if (!child || child.exitCode !== null) return;
      if (!killInfo) killInfo = { reason, attemptOutcome: 'paused' };
      logger.info(`[Backlog/runner] sync kill: ${reason}`);
      killTreeSync(child);
    },
  };
}

// Headless executor for one backlog card: spawns `claude -p` in the card's
// project repo (research) or its detached worktree (execution), feeds the
// prompt via STDIN, and parses the single-JSON-object output. Never throws —
// every failure comes back as a structured result, mirroring fireOpener in
// ../scheduler/opener.
//
// Safety posture:
//  - research: never passes --dangerously-skip-permissions — headless mode
//    denies permission-gated tools (Write/Edit/Bash) by default, so runs are
//    read-only by construction; --disallowedTools is belt-and-braces.
//  - execution (Phase 2): --permission-mode acceptEdits auto-approves
//    Write/Edit INSIDE the cwd only (outside prompts → dies headlessly), and
//    Bash stays disallowed — with no Bash the agent structurally cannot run
//    `git commit`/`git push`, so "no commits" needs no fragile command
//    patterns. --setting-sources user stops the target repo's own
//    .claude/settings.json from granting more than we intend. The worktree is
//    the blast-radius limiter; QA commands are run by the ENGINE, not the agent.
//  - the prompt goes over stdin, never argv — user text through `cmd.exe /c`
//    is not quoting-safe (the opener's argv args are fixed constants; ours
//    are not). Variable argv entries are gated: the card's model by
//    isSafeModelId, the resume session id by isSafeSessionId (both strict
//    charsets, no cmd.exe metacharacters). The resume continuation prompt is
//    a fixed constant, so argv is safe for it.

import { spawn, execFile, execFileSync, ChildProcess } from 'child_process';
import { logger } from '../../common/logger';
import { BacklogTaskType, isSafeModelId } from '../../common/backlog-types';
import { resolveClaudeBin, resetClaudeBinCache } from '../scheduler/opener';

// Verified against the installed CLI (2.1.170, Phase 2 spike): --disallowedTools
// takes a comma-separated list; --permission-mode acceptEdits, --setting-sources
// and -r/--resume exist; --output-format json emits one result object with
// result/is_error/total_cost_usd/num_turns/session_id. NO --max-turns in this
// version — the time budget kill below is the hard cap (--max-budget-usd exists
// but card cost estimates are forecasts, not enforcement, so it is not passed).
const RESEARCH_DISALLOWED_TOOLS = 'Write,Edit,NotebookEdit,Bash';
const EXECUTION_DISALLOWED_TOOLS = 'Bash,NotebookEdit';
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // guard against a runaway stdout
const POSIX_SIGKILL_DELAY_MS = 5_000;

// Fixed constant (argv-safe: no cmd.exe metacharacters, no quotes) used with
// --resume — print mode takes the continuation prompt on argv, not stdin.
const RESUME_PROMPT =
  'Continue the task from where you left off. Re-read the current state of the working directory, finish the remaining work, and follow the same output contract as before.';

// Claude session ids are uuid-shaped; anything else never reaches argv.
const SESSION_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export function isSafeSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

// A run that died because the subscription's usage window is exhausted is not
// the card's fault — the engine pauses the card and latches until reset
// instead of blocking it. Pattern-based; unmatched wordings fall back to the
// generic failure path (one card blocked, no cascade thanks to the engine's
// proactive gate).
const USAGE_LIMIT_RE = /usage limit|rate.?limit|limit (?:reached|exceeded)|out of (?:credits?|quota)|exceeded.*quota|hit.*limit/i;
export function isUsageLimitError(text: string | null | undefined): boolean {
  return !!text && USAGE_LIMIT_RE.test(text);
}

export type RunnerOutcome = 'success' | 'failed' | 'killed';

export interface RunnerResult {
  outcome: RunnerOutcome;
  report?: string;             // final markdown (on success)
  reason?: string;             // failure / kill detail
  killOutcome?: 'killed' | 'paused'; // how a kill should be recorded on the attempt
  /** Set when a failure is a usage-window exhaustion, not the card's fault. */
  usageLimit?: boolean;
  costUsd: number | null;
  numTurns: number | null;
  sessionId: string | null;
}

export interface ExecuteCardOptions {
  prompt: string;
  cwd: string;                 // project repo (research) or worktree (execution)
  budgetMs: number;
  taskType: BacklogTaskType;
  model?: string | null;
  /** Resume a paused run's session (execution cards keep their worktree). */
  resumeSessionId?: string | null;
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
 * Execute one card run: `claude -p` with `cwd` set to the project repo
 * (research) or the card's worktree (execution), under a hard time budget.
 * `model` (the card's override) is passed as `--model` when set; null falls
 * back to the project/CLI default. When `resumeSessionId` is set the run
 * continues a paused session in place (fixed continuation prompt on argv);
 * an unusable session id degrades to a fresh run — the worktree still holds
 * the partial work. The returned handle's `kill` is also used by the engine
 * for window-end grace expiry and app quit.
 */
export function executeCard(opts: ExecuteCardOptions): RunnerHandle {
  const { prompt, cwd, budgetMs, taskType, model, resumeSessionId } = opts;
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
    // and all argv entries are fixed constants or strict-charset-gated; the
    // untrusted prompt goes over stdin.
    const isWin = process.platform === 'win32';
    const file = isWin ? (process.env.ComSpec || 'cmd.exe') : bin;
    const baseArgs = taskType === 'execution'
      ? ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits',
         '--disallowedTools', EXECUTION_DISALLOWED_TOOLS, '--setting-sources', 'user']
      : ['-p', '--output-format', 'json', '--disallowedTools', RESEARCH_DISALLOWED_TOOLS];
    if (model) {
      // Store normalization should have rejected unsafe values already —
      // re-check here since this string reaches cmd.exe argv.
      if (isSafeModelId(model)) baseArgs.push('--model', model);
      else logger.warn(`[Backlog/runner] ignoring unsafe model id ${JSON.stringify(model)} — using default`);
    }
    let resuming = false;
    if (resumeSessionId) {
      if (isSafeSessionId(resumeSessionId)) {
        // Print mode takes the continuation prompt on argv, not stdin; both
        // entries are safe (gated id + fixed constant).
        baseArgs.push('--resume', resumeSessionId, RESUME_PROMPT);
        resuming = true;
      } else {
        logger.warn('[Backlog/runner] unsafe session id — starting a fresh run instead of resuming');
      }
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
        settle({
          ...failed(`claude exited with code ${code}${detail ? `: ${detail}` : ''}`),
          usageLimit: isUsageLimitError(detail),
        });
        return;
      }
      if (!parsed.ok) {
        settle({
          outcome: 'failed', reason: parsed.reason,
          usageLimit: isUsageLimitError(parsed.reason),
          costUsd: parsed.costUsd, numTurns: parsed.numTurns, sessionId: parsed.sessionId,
        });
        return;
      }
      settle({ outcome: 'success', report: parsed.report, costUsd: parsed.costUsd, numTurns: parsed.numTurns, sessionId: parsed.sessionId });
    });

    // Feed the prompt and close stdin so -p reads it as the full input. On
    // resume the prompt already went on argv — just close stdin.
    proc.stdin?.on('error', () => { /* EPIPE if the child died early — close handler reports it */ });
    if (!resuming) proc.stdin?.write(prompt, 'utf8');
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

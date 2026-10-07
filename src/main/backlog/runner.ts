// Headless executor for one backlog card. Spawns the card's agent CLI
// (`claude -p` or `codex exec`, via src/main/backlog/agents) in the card's
// project repo (research / qa) or its detached worktree (execution), feeds the
// prompt via STDIN, and hands stdout to the adapter to parse. Never throws —
// every failure comes back as a structured result, mirroring fireOpener in
// ../scheduler/opener.
//
// What lives here is agent-agnostic: process spawn (with the Windows cmd.exe
// shim when the adapter says the bin needs it), the stdin feed, the hard time
// budget, output caps, and tree kills. Everything agent-specific — the bin,
// the argv, the safety posture, output parsing, usage-limit wording — is the
// adapter's. See agents/claude.ts and agents/codex.ts for each posture.
//
// The prompt goes over stdin, never argv — user text through `cmd.exe /c` is
// not quoting-safe. Variable argv entries are gated by the adapters (model by
// isSafeModelId, session/thread id by isSafeSessionId, engine-controlled paths
// quoted by buildCmdShimArgs); the resume continuation prompt is a fixed
// constant.

import { spawn, execFile, execFileSync, ChildProcess } from 'child_process';
import { logger } from '../../common/logger';
import { BacklogTaskType } from '../../common/backlog-types';
import { buildCmdShimArgs } from '../scheduler/opener';
import { AgentAdapter, AgentRunSpec } from './agents';

// Re-exported so existing imports (ipc.ts, tests) keep working after the
// adapter split.
export { isSafeSessionId } from './agents';
export { parseClaudeJsonOutput, isUsageLimitError, classifyNonZeroExit } from './agents/claude';
export type { ParsedClaudeOutput } from './agents/claude';

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // guard against a runaway stdout
const POSIX_SIGKILL_DELAY_MS = 5_000;

export type RunnerOutcome = 'success' | 'failed' | 'killed';

// The executor is asked (by prompt.ts) to end its final message with a
// `STATUS: completed|partial|blocked` line. This is how a clean CLI exit that
// is actually a "couldn't proceed" gets distinguished from a real success —
// the CLI's own exit code says nothing about whether the task was done.
export type SelfReportedStatus = 'completed' | 'partial' | 'blocked';
const SELF_STATUS_RE = /^STATUS:\s*(completed|partial|blocked)\b/i;

/**
 * Pull the executor's self-reported status out of its final markdown. The
 * marker is expected on its own line at the end, so we scan from the bottom
 * and take the last match (a mid-report mention of the word loses to the real
 * footer). Returns null when the agent omitted it — callers fall back to the
 * deterministic empty-diff check.
 */
export function parseSelfReportedStatus(report: string | undefined | null): SelfReportedStatus | null {
  if (!report) return null;
  const lines = report.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = SELF_STATUS_RE.exec(lines[i].trim());
    if (m) return m[1].toLowerCase() as SelfReportedStatus;
  }
  return null;
}

export interface RunnerResult {
  outcome: RunnerOutcome;
  report?: string;             // final markdown (on success)
  /** Executor's self-reported status parsed from the report's STATUS line. */
  selfStatus?: SelfReportedStatus | null;
  reason?: string;             // failure / kill detail
  killOutcome?: 'killed' | 'paused'; // how a kill should be recorded on the attempt
  /** Set when a failure is a usage-window exhaustion, not the card's fault. */
  usageLimit?: boolean;
  costUsd: number | null;
  numTurns: number | null;
  sessionId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ExecuteCardOptions {
  /** The card's agent (Claude Code or Codex). */
  adapter: AgentAdapter;
  prompt: string;
  cwd: string;                 // project repo (research/qa) or worktree (execution)
  budgetMs: number;
  taskType: BacklogTaskType;
  model?: string | null;
  /** Resume a paused run's session (execution cards keep their worktree). */
  resumeSessionId?: string | null;
  /** Claude QA cards: path to the generated chrome-devtools MCP config. */
  mcpConfigPath?: string | null;
  /** Codex QA cards: the Codex config profile carrying the chrome-devtools server. */
  qaProfile?: string | null;
  /** Codex: engine-controlled path for the agent's last message (`-o`). */
  outputFile?: string | null;
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
   * CLI subtree (which keeps spending tokens).
   */
  killSync: (reason: string) => void;
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
 * Execute one card run with the card's agent, `cwd` set to the project repo
 * (research / qa) or the card's worktree (execution), under a hard time
 * budget. `model` (the card's override) is passed through the adapter when
 * set; null falls back to the agent's default. When `resumeSessionId` is set
 * the run continues a paused session in place; an unusable session id
 * degrades to a fresh run — the worktree still holds the partial work. The
 * returned handle's `kill` is also used by the engine for window-end grace
 * expiry and app quit.
 */
export function executeCard(opts: ExecuteCardOptions): RunnerHandle {
  const { adapter, prompt, cwd, budgetMs, taskType, model, resumeSessionId, mcpConfigPath, qaProfile, outputFile } = opts;
  const tag = `[Backlog/runner:${adapter.id}]`;
  let killInfo: { reason: string; attemptOutcome: 'killed' | 'paused' } | null = null;
  let child: ChildProcess | null = null;

  const promise = new Promise<RunnerResult>((resolve) => {
    const failed = (reason: string): RunnerResult =>
      ({ outcome: 'failed', reason, costUsd: null, numTurns: null, sessionId: null, inputTokens: null, outputTokens: null });

    const bin = adapter.resolveBin();
    if (!bin) {
      resolve(failed(`${adapter.id} CLI not found on PATH`));
      return;
    }

    const spec: AgentRunSpec = { taskType, model, resumeSessionId, cwd, mcpConfigPath, qaProfile, outputFile };
    const built = adapter.buildArgs(spec);
    if (!built.ok) {
      resolve(failed(built.reason));
      return;
    }

    // Windows npm shims are .cmd files spawn can't launch directly — route
    // through cmd.exe via buildCmdShimArgs + windowsVerbatimArguments (same as
    // the opener). A bare `['/c', bin, ...]` breaks the moment a SECOND spaced
    // argv entry appears (the resume prompt): cmd then strips the first/last
    // quote and a spaced bin path like `C:\Program Files\...` dies as
    // `'C:\Program' is not recognized`. A real .exe spawns directly.
    const viaCmd = adapter.needsCmdShim(bin);
    const file = viaCmd ? (process.env.ComSpec || 'cmd.exe') : bin;
    const args = viaCmd ? buildCmdShimArgs(bin, built.args) : built.args;

    let proc: ChildProcess;
    try {
      proc = spawn(file, args, {
        cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        windowsVerbatimArguments: viaCmd,
      });
    } catch (e: any) {
      resolve(failed(`failed to spawn ${adapter.id}: ${e?.message ?? e}`));
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
      logger.warn(`${tag} ${killInfo.reason} — killing process tree`);
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
      if (err.code === 'ENOENT') adapter.resetBinCache();
      settle(failed(`${adapter.id} process error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (killInfo) {
        settle({
          outcome: 'killed',
          reason: killInfo.reason,
          killOutcome: killInfo.attemptOutcome,
          costUsd: null, numTurns: null, sessionId: null, inputTokens: null, outputTokens: null,
        });
        return;
      }
      const parsed = adapter.parseOutput(stdout, spec);
      if (!parsed.ok && stdoutTruncated) {
        settle(failed(`${adapter.id} output exceeded ${MAX_OUTPUT_BYTES / (1024 * 1024)}MB and was truncated — the result could not be parsed`));
        return;
      }
      const tokens = { inputTokens: parsed.inputTokens, outputTokens: parsed.outputTokens };
      if (code !== 0 && !parsed.ok) {
        const { reason, usageLimit } = adapter.classifyNonZeroExit(code, stdout, stderr);
        settle({ ...failed(reason), usageLimit, costUsd: parsed.costUsd, numTurns: parsed.numTurns, sessionId: parsed.sessionId, ...tokens });
        return;
      }
      if (!parsed.ok) {
        settle({
          outcome: 'failed', reason: parsed.reason,
          usageLimit: adapter.isUsageLimitError(parsed.reason),
          costUsd: parsed.costUsd, numTurns: parsed.numTurns, sessionId: parsed.sessionId, ...tokens,
        });
        return;
      }
      settle({
        outcome: 'success',
        report: parsed.report,
        selfStatus: parseSelfReportedStatus(parsed.report),
        costUsd: parsed.costUsd, numTurns: parsed.numTurns, sessionId: parsed.sessionId, ...tokens,
      });
    });

    // Feed the prompt and close stdin so the CLI reads it as the full input.
    // On resume the prompt already went on argv — just close stdin.
    proc.stdin?.on('error', () => { /* EPIPE if the child died early — close handler reports it */ });
    if (!built.resuming) proc.stdin?.write(prompt, 'utf8');
    proc.stdin?.end();
  });

  return {
    promise,
    kill: (reason, attemptOutcome) => {
      if (!child || child.exitCode !== null || killInfo) return;
      killInfo = { reason, attemptOutcome };
      logger.info(`${tag} kill requested: ${reason}`);
      killTree(child);
    },
    killSync: (reason) => {
      if (!child || child.exitCode !== null) return;
      if (!killInfo) killInfo = { reason, attemptOutcome: 'paused' };
      logger.info(`${tag} sync kill: ${reason}`);
      killTreeSync(child);
    },
  };
}

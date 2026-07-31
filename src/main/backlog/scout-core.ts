// Shared scout runner (Phase 3 issue population). A "scout" is a read-only
// `claude -p` run that calls an org MCP (GitLab, Linear, …) with ONLY that
// provider's tools allow-listed, so it can only read. The process engine here
// is provider-agnostic — the GitLab and Linear scouts (gitlab-scout.ts,
// linear-scout.ts) supply their own allowlist + prompt and parse the result.
//
// Reuses the runner's output parser + the opener's bin resolver / cmd.exe shim;
// the prompt goes over stdin (never argv). No --strict-mcp-config, so a spawned
// run inherits the user's connected MCP servers (Spike 0 / linear-scout-contract).

import { spawn, execFile, ChildProcess } from 'child_process';
import { logger } from '../../common/logger';
import { isSafeModelId } from '../../common/backlog-types';
import { buildCmdShimArgs, resolveClaudeBin, resetClaudeBinCache } from '../scheduler/opener';
import { parseClaudeJsonOutput, classifyNonZeroExit } from './runner';

// Read-only by construction; belt-and-braces alongside the narrow allowlist.
export const SCOUT_DISALLOWED_TOOLS = 'Write,Edit,Bash,NotebookEdit';
// Default (list_teams / project-id resolve): small, fast calls.
const SCOUT_TIMEOUT_MS = 120_000;
// Issue scans can return a larger payload (see prompt's SCOUT_BOUNDS) and take
// longer to serialize on the cheap model, so they get a wider budget. The scan
// bounds keep a healthy run well under this; the timeout is the safety net for
// a still-oversized team/project rather than the primary control.
export const SCOUT_SCAN_TIMEOUT_MS = 240_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

// Auth/connectivity failures we translate to a "needs re-auth" badge (D8/D9):
// the connector dropped (or was never authenticated), not a real per-card
// failure. Also matches the CLI's "authenticate with … first" guidance.
const AUTH_RE = /authenticat|not connected|unauthor|permission denied|needs? (?:re-?)?auth|\b401\b|\b403\b|forbidden|no access|please (?:connect|log ?in)/i;

export type ScoutConnector = 'connected' | 'needs-auth';

export interface ScoutRunResult {
  ok: boolean;
  connector: ScoutConnector;
  report?: string;
  reason?: string;
  costUsd: number | null;
}

/** Connector verdict from a run: only an auth-shaped failure flips to needs-auth. */
export function classifyConnector(ok: boolean, text: string | null | undefined): ScoutConnector {
  if (ok) return 'connected';
  return AUTH_RE.test(text ?? '') ? 'needs-auth' : 'connected';
}

/**
 * Build the scout argv. Read-only (denies Write/Edit/Bash), allow-lists ONLY
 * the caller's provider tools, forces a cheap model, and never uses
 * --strict-mcp-config (so the run inherits the connected MCP). Exported for tests.
 */
export function buildScoutArgs(model: string, allowedTools: string): string[] {
  const args = [
    '-p', '--output-format', 'json',
    '--disallowedTools', SCOUT_DISALLOWED_TOOLS,
    '--allowedTools', allowedTools,
  ];
  if (isSafeModelId(model)) args.push('--model', model);
  else logger.warn(`[Backlog/scout] ignoring unsafe scoutModel ${JSON.stringify(model)} — using CLI default`);
  return args;
}

/** Kill a scout child and (on Windows) its cmd.exe subtree. */
function killTree(child: ChildProcess): void {
  if (child.pid == null || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => { /* best effort */ });
  } else {
    child.kill('SIGKILL');
  }
}

/**
 * Spawn one read-only scout run, feeding `prompt` over stdin with `allowedTools`
 * allow-listed. Never throws — every failure path resolves a ScoutRunResult.
 */
export function runScout(
  prompt: string,
  model: string,
  allowedTools: string,
  timeoutMs: number = SCOUT_TIMEOUT_MS,
): Promise<ScoutRunResult> {
  return new Promise((resolve) => {
    const done = (r: ScoutRunResult) => resolve(r);
    const bin = resolveClaudeBin();
    if (!bin) {
      resetClaudeBinCache();
      done({ ok: false, connector: 'connected', reason: 'claude CLI not found on PATH', costUsd: null });
      return;
    }
    const isWin = process.platform === 'win32';
    const file = isWin ? (process.env.ComSpec || 'cmd.exe') : bin;
    const baseArgs = buildScoutArgs(model, allowedTools);
    const args = isWin ? buildCmdShimArgs(bin, baseArgs) : baseArgs;

    let proc: ChildProcess;
    try {
      proc = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: isWin });
    } catch (e: any) {
      done({ ok: false, connector: 'connected', reason: `failed to spawn claude: ${e?.message ?? e}`, costUsd: null });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => { timedOut = true; killTree(proc); }, timeoutMs);
    timer.unref?.();
    const settle = (r: ScoutRunResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };

    proc.stdout?.on('data', (c: Buffer) => { if (stdout.length < MAX_OUTPUT_BYTES) stdout += c.toString('utf8'); });
    proc.stderr?.on('data', (c: Buffer) => { if (stderr.length < 64 * 1024) stderr += c.toString('utf8'); });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') resetClaudeBinCache();
      settle({ ok: false, connector: 'connected', reason: `claude process error: ${err.message}`, costUsd: null });
    });
    proc.on('close', (code) => {
      if (timedOut) {
        settle({ ok: false, connector: 'connected', reason: `scout timed out after ${Math.round(timeoutMs / 1000)}s`, costUsd: null });
        return;
      }
      const parsed = parseClaudeJsonOutput(stdout);
      if (parsed.ok) {
        settle({ ok: true, connector: 'connected', report: parsed.report, costUsd: parsed.costUsd });
        return;
      }
      const reason = code !== 0 ? classifyNonZeroExit(code, stdout, stderr).reason : (parsed.reason ?? 'scout produced no result');
      settle({ ok: false, connector: classifyConnector(false, reason), reason, costUsd: parsed.costUsd });
    });

    proc.stdin?.on('error', () => { /* EPIPE if the child died early */ });
    proc.stdin?.write(prompt, 'utf8');
    proc.stdin?.end();
  });
}

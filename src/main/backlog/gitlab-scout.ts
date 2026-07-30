// GitLab scout: a read-only `claude -p` run that calls the org GitLab MCP to
// list issues / resolve a project id, with ONLY the GitLab tools allow-listed
// (so it can only read). Reuses the runner's output parser + the opener's bin
// resolver / cmd.exe shim; the prompt goes over stdin (never argv).
//
// Spike 0 (2026-07-29) verified: a headless run inherits the connected
// `claude.ai Gitlab Cloud` MCP (NO --strict-mcp-config), the tool prefix is
// `mcp__claude_ai_Gitlab_Cloud__`, and the model must be forced cheap (config's
// scoutModel, default claude-haiku-4-5) — inheriting Opus cost ~7× more.
// See backlog-phase3-gitlab-population-plan.md (D1, D2, D10, WS3).

import { spawn, execFile, ChildProcess } from 'child_process';
import { logger } from '../../common/logger';
import { isSafeModelId } from '../../common/backlog-types';
import { buildCmdShimArgs, resolveClaudeBin, resetClaudeBinCache } from '../scheduler/opener';
import { parseClaudeJsonOutput, classifyNonZeroExit } from './runner';
import { buildScoutPrompt, buildScoutResolvePrompt, ScoutFilter } from './prompt';

// The normalized tool prefix a spawned CLI exposes for the server named
// "claude.ai Gitlab Cloud" (verified in Spike 0). If the org renames the
// connector, update this one constant.
const GITLAB_TOOL_PREFIX = 'mcp__claude_ai_Gitlab_Cloud__';
const SCOUT_ALLOWED_TOOLS = ['my_issues', 'list_issues', 'get_project', 'get_issue']
  .map((t) => GITLAB_TOOL_PREFIX + t)
  .join(',');
// Read-only by construction; belt-and-braces alongside the narrow allowlist.
const SCOUT_DISALLOWED_TOOLS = 'Write,Edit,Bash,NotebookEdit';
const SCOUT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

// Auth/connectivity failures we translate to a "needs re-auth" badge (D8/D9):
// the connector dropped, not a real per-card failure.
const AUTH_RE = /authenticat|not connected|unauthor|permission denied|needs? (?:re-?)?auth|\b401\b|\b403\b|forbidden|no access|please (?:connect|log ?in)/i;

export type ScoutConnector = 'connected' | 'needs-auth';

export interface ScoutIssue {
  iid: number;
  title: string;
  description: string;
  webUrl: string;
  labels: string[];
}

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
 * Parse the scout's final message into issues. Tolerates a ```json fence and
 * leading prose; drops malformed rows rather than throwing. Pure + tested.
 */
export function parseScoutIssues(report: string | undefined | null): ScoutIssue[] {
  if (!report) return [];
  let text = report.trim();
  const fence = /^```[a-z]*\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1].trim();
  if (!text.startsWith('[')) {
    const i = text.indexOf('[');
    const j = text.lastIndexOf(']');
    if (i >= 0 && j > i) text = text.slice(i, j + 1);
  }
  let arr: unknown;
  try {
    arr = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: ScoutIssue[] = [];
  for (const r of arr as any[]) {
    if (!r || typeof r !== 'object') continue;
    const iid = typeof r.iid === 'number'
      ? r.iid
      : typeof r.iid === 'string' && /^\d+$/.test(r.iid) ? Number(r.iid) : null;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (iid == null || title.length === 0) continue;
    out.push({
      iid,
      title,
      description: typeof r.description === 'string' ? r.description : '',
      webUrl: typeof r.webUrl === 'string' ? r.webUrl : typeof r.web_url === 'string' ? r.web_url : '',
      labels: Array.isArray(r.labels) ? r.labels.filter((x: unknown): x is string => typeof x === 'string') : [],
    });
  }
  return out;
}

/** Build the scout argv (exported for tests). No --strict-mcp-config (D2). */
export function buildScoutArgs(model: string): string[] {
  const args = [
    '-p', '--output-format', 'json',
    '--disallowedTools', SCOUT_DISALLOWED_TOOLS,
    '--allowedTools', SCOUT_ALLOWED_TOOLS,
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

/** Spawn one read-only scout run, feeding `prompt` over stdin. Never throws. */
function runScout(prompt: string, model: string): Promise<ScoutRunResult> {
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
    const baseArgs = buildScoutArgs(model);
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
    const settle = (r: ScoutRunResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };

    const timer = setTimeout(() => { timedOut = true; killTree(proc); }, SCOUT_TIMEOUT_MS);
    timer.unref?.();

    proc.stdout?.on('data', (c: Buffer) => { if (stdout.length < MAX_OUTPUT_BYTES) stdout += c.toString('utf8'); });
    proc.stderr?.on('data', (c: Buffer) => { if (stderr.length < 64 * 1024) stderr += c.toString('utf8'); });
    proc.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') resetClaudeBinCache();
      settle({ ok: false, connector: 'connected', reason: `claude process error: ${err.message}`, costUsd: null });
    });
    proc.on('close', (code) => {
      if (timedOut) {
        settle({ ok: false, connector: 'connected', reason: `scout timed out after ${SCOUT_TIMEOUT_MS / 1000}s`, costUsd: null });
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

export interface ResolveResult {
  id: number | null;
  connector: ScoutConnector;
  reason?: string;
}

/** Resolve a 'group/sub/project' path to its numeric GitLab id via get_project. */
export async function resolveProjectId(host: string, projectPath: string, model: string): Promise<ResolveResult> {
  const r = await runScout(buildScoutResolvePrompt(host, projectPath), model);
  if (!r.ok) return { id: null, connector: r.connector, reason: r.reason };
  const m = /\d{2,}/.exec(r.report ?? '');
  if (!m) return { id: null, connector: 'connected', reason: 'scout did not return a numeric project id' };
  return { id: Number(m[0]), connector: 'connected' };
}

export interface FetchResult {
  ok: boolean;
  connector: ScoutConnector;
  issues: ScoutIssue[];
  reason?: string;
  costUsd: number | null;
}

/** List open issues for a linked project per its filter. */
export async function fetchIssues(projectId: number, filter: ScoutFilter, model: string): Promise<FetchResult> {
  const r = await runScout(buildScoutPrompt(projectId, filter), model);
  if (!r.ok) return { ok: false, connector: r.connector, issues: [], reason: r.reason, costUsd: r.costUsd };
  return { ok: true, connector: 'connected', issues: parseScoutIssues(r.report), costUsd: r.costUsd };
}

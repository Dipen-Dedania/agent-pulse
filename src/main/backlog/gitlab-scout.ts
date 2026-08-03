// GitLab scout: a read-only `claude -p` run that calls the org GitLab MCP to
// list issues / resolve a project id, with ONLY the GitLab tools allow-listed
// (so it can only read). The process engine lives in scout-core.ts; this file
// supplies the GitLab allowlist + result parsing.
//
// Spike 0 (2026-07-29) verified: a headless run inherits the connected
// `claude.ai Gitlab Cloud` MCP (NO --strict-mcp-config), the tool prefix is
// `mcp__claude_ai_Gitlab_Cloud__`, and the model must be forced cheap (config's
// scoutModel, default claude-haiku-4-5) — inheriting Opus cost ~7× more.
// See backlog-phase3-gitlab-population-plan.md (D1, D2, D10, WS3).

import { buildScoutArgs as coreBuildScoutArgs, classifyConnector, runScout, ScoutConnector, SCOUT_SCAN_TIMEOUT_MS } from './scout-core';
import { extractJsonArray, str, stringArray } from './scout-parse';
import { buildScoutPrompt, buildScoutResolvePrompt, previewDescription, ScoutFilter } from './prompt';

// The normalized tool prefix a spawned CLI exposes for the server named
// "claude.ai Gitlab Cloud" (verified in Spike 0). If the org renames the
// connector, update this one constant.
const GITLAB_TOOL_PREFIX = 'mcp__claude_ai_Gitlab_Cloud__';
const SCOUT_ALLOWED_TOOLS = ['my_issues', 'list_issues', 'get_project', 'get_issue']
  .map((t) => GITLAB_TOOL_PREFIX + t)
  .join(',');

// Re-export so existing callers/tests keep their import site unchanged.
export { classifyConnector, ScoutConnector };

export interface ScoutIssue {
  iid: number;
  title: string;
  description: string;
  webUrl: string;
  labels: string[];
}

/**
 * Parse the scout's final message into issues via the shared extractor (```json
 * fence / prose / object-wrapper tolerant, robust to brackets inside strings);
 * drops malformed rows rather than throwing. Pure + tested.
 */
export function parseScoutIssues(report: string | undefined | null): ScoutIssue[] {
  const arr = extractJsonArray(report);
  if (!arr) return [];
  const out: ScoutIssue[] = [];
  for (const r of arr as any[]) {
    if (!r || typeof r !== 'object') continue;
    // iid is GitLab's per-project issue number — accept a number or a numeric string.
    const iid = typeof r.iid === 'number'
      ? r.iid
      : typeof r.iid === 'string' && /^\d+$/.test(r.iid.trim()) ? Number(r.iid.trim()) : null;
    const title = str(r.title);
    if (iid == null || title.length === 0) continue;
    out.push({
      iid,
      title,
      description: previewDescription(typeof r.description === 'string' ? r.description : ''),
      webUrl: str(r.webUrl) || str(r.web_url),
      labels: stringArray(r.labels),
    });
  }
  return out;
}

/** Build the GitLab scout argv (exported for tests). No --strict-mcp-config (D2). */
export function buildScoutArgs(model: string): string[] {
  return coreBuildScoutArgs(model, SCOUT_ALLOWED_TOOLS);
}

export interface ResolveResult {
  id: number | null;
  connector: ScoutConnector;
  reason?: string;
}

/** Resolve a 'group/sub/project' path to its numeric GitLab id via get_project. */
export async function resolveProjectId(host: string, projectPath: string, model: string): Promise<ResolveResult> {
  const r = await runScout(buildScoutResolvePrompt(host, projectPath), model, SCOUT_ALLOWED_TOOLS);
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
  const r = await runScout(buildScoutPrompt(projectId, filter), model, SCOUT_ALLOWED_TOOLS, SCOUT_SCAN_TIMEOUT_MS);
  if (!r.ok) return { ok: false, connector: r.connector, issues: [], reason: r.reason, costUsd: r.costUsd };
  return { ok: true, connector: 'connected', issues: parseScoutIssues(r.report), costUsd: r.costUsd };
}

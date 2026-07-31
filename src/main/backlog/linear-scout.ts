// Linear scout: a read-only `claude -p` run that calls the org Linear MCP to
// list teams (for the link-time picker) and a team's open issues, with ONLY
// the Linear tools allow-listed. Sibling of gitlab-scout.ts; the process engine
// lives in scout-core.ts.
//
// Contract verified 2026-07-30 against a headless run inheriting the connected
// + authenticated `claude.ai Linear` MCP (see memory: linear-scout-contract):
//   - Tool prefix: `mcp__claude_ai_Linear__`.
//   - `list_teams`  → [{ id (uuid), key ('DEV'), name ('Development') }]
//   - `list_issues` → [{ identifier ('DEV-1036'), title, description, url,
//                        state, labels[], assignee }]
//   - MUST pass --allowedTools or the headless agent never invokes the MCP tool
//     (it tries to shell out and the calls are permission-denied).
// "Connected" ≠ "authenticated": before OAuth the run reports "authenticate
// with Linear first", which scout-core's AUTH_RE classifies as needs-auth.

import { LinearProject, LinearTeam } from '../../common/backlog-types';
import { logger } from '../../common/logger';
import { runScout, ScoutConnector, SCOUT_SCAN_TIMEOUT_MS } from './scout-core';
import { buildLinearProjectsPrompt, buildLinearScoutPrompt, buildLinearTeamsPrompt, previewDescription, ScoutFilter } from './prompt';

const LINEAR_TOOL_PREFIX = 'mcp__claude_ai_Linear__';
const LINEAR_ALLOWED_TOOLS = ['list_teams', 'list_projects', 'list_issues', 'get_issue']
  .map((t) => LINEAR_TOOL_PREFIX + t)
  .join(',');

export { ScoutConnector };
export type { LinearProject, LinearTeam };

export interface LinearIssue {
  identifier: string; // 'DEV-1036' — workspace-unique human ref
  title: string;
  description: string;
  webUrl: string;
  labels: string[];
}

/** Pull the array out of a parsed JSON value: the value itself if it's an
 *  array, else the first array-valued property of an object wrapper the agent
 *  sometimes emits ({ teams: [...] }, { data: [...] }, { results: [...] }). */
function arrayFrom(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

/** Extract a JSON array from a scout report (```json fence / prose / object
 *  wrapper tolerant). Returns null only when no JSON at all could be parsed. */
function extractJsonArray(report: string | undefined | null): unknown[] | null {
  if (!report) return null;
  let text = report.trim();
  const fence = /^```[a-z]*\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fence) text = fence[1].trim();
  // Prefer the outermost array; fall back to an object wrapper ({ teams: [...] }).
  const ai = text.indexOf('[');
  const aj = text.lastIndexOf(']');
  const oi = text.indexOf('{');
  const oj = text.lastIndexOf('}');
  const candidates: string[] = [];
  if (ai >= 0 && aj > ai) candidates.push(text.slice(ai, aj + 1));
  if (oi >= 0 && oj > oi) candidates.push(text.slice(oi, oj + 1));
  if (candidates.length === 0) candidates.push(text);
  for (const c of candidates) {
    try {
      const arr = arrayFrom(JSON.parse(c));
      if (arr) return arr;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Parse a list_teams report into teams; drops rows missing an id or key. */
export function parseLinearTeams(report: string | undefined | null): LinearTeam[] {
  const arr = extractJsonArray(report);
  if (!arr) return [];
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const out: LinearTeam[] = [];
  for (const r of arr as any[]) {
    if (!r || typeof r !== 'object') continue;
    const id = str(r.id);
    if (id.length === 0) continue; // id is the only required field — the stable link key.
    // `key` is display-only and current list_teams no longer returns it; keep it
    // when present (tolerating aliases), else fall back to the name for the label.
    const key = str(r.key) || str(r.teamKey) || str(r.identifier);
    const name = str(r.name);
    out.push({ id, name: name.length > 0 ? name : key || id, ...(key ? { key } : {}) });
  }
  return out;
}

/** Parse a list_projects report into projects; drops rows missing an id or
 *  name (both are needed — the id scopes scans, the name labels the picker). */
export function parseLinearProjects(report: string | undefined | null): LinearProject[] {
  const arr = extractJsonArray(report);
  if (!arr) return [];
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const out: LinearProject[] = [];
  for (const r of arr as any[]) {
    if (!r || typeof r !== 'object') continue;
    const id = str(r.id);
    // list_projects returns the display label under `name`; accept `title` as an
    // alias in case the agent projects a different field selection.
    const name = str(r.name) || str(r.title);
    if (id.length === 0 || name.length === 0) continue;
    out.push({ id, name });
  }
  return out;
}

/**
 * Parse a list_issues report into issues; keys on the string `identifier`
 * (Linear's human ref) and drops rows with no identifier or title. Accepts
 * `url` or `webUrl` for the link.
 */
export function parseLinearIssues(report: string | undefined | null): LinearIssue[] {
  const arr = extractJsonArray(report);
  if (!arr) return [];
  const out: LinearIssue[] = [];
  // The Linear list_issues tool returns the human ref (e.g. "DEV-1036") under
  // `id` when a field selection is used, so accept `id` as an alias — but only
  // when it looks like a human ref (PREFIX-123), never a raw UUID `id`.
  const humanRef = (v: unknown): string =>
    typeof v === 'string' && /^[A-Za-z][A-Za-z0-9]*-\d+$/.test(v.trim()) ? v.trim() : '';
  for (const r of arr as any[]) {
    if (!r || typeof r !== 'object') continue;
    const identifier = (typeof r.identifier === 'string' ? r.identifier.trim() : '') || humanRef(r.id);
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (identifier.length === 0 || title.length === 0) continue;
    out.push({
      identifier,
      title,
      description: previewDescription(typeof r.description === 'string' ? r.description : ''),
      webUrl: typeof r.url === 'string' ? r.url : typeof r.webUrl === 'string' ? r.webUrl : '',
      labels: Array.isArray(r.labels) ? r.labels.filter((x: unknown): x is string => typeof x === 'string') : [],
    });
  }
  return out;
}

export interface TeamsResult {
  ok: boolean;
  connector: ScoutConnector;
  teams: LinearTeam[];
  reason?: string;
}

/** List the workspace's Linear teams for the link-time picker. */
export async function listTeams(model: string): Promise<TeamsResult> {
  const r = await runScout(buildLinearTeamsPrompt(), model, LINEAR_ALLOWED_TOOLS);
  if (!r.ok) return { ok: false, connector: r.connector, teams: [], reason: r.reason };
  const teams = parseLinearTeams(r.report);
  if (teams.length === 0) {
    // Scout ran + authenticated but we parsed zero teams — usually a report the
    // headless agent shaped unexpectedly. Log the raw report (truncated) so the
    // next occurrence is diagnosable rather than a silent empty list.
    logger.warn(`[Backlog/linear] list_teams parsed 0 teams. Raw report: ${JSON.stringify((r.report ?? '').slice(0, 2000))}`);
    return { ok: false, connector: 'connected', teams: [], reason: 'no Linear teams returned' };
  }
  return { ok: true, connector: 'connected', teams };
}

export interface ProjectsResult {
  ok: boolean;
  connector: ScoutConnector;
  projects: LinearProject[];
  reason?: string;
}

/** List a team's Linear projects for the optional link-time narrowing step. */
export async function listProjects(teamId: string, model: string): Promise<ProjectsResult> {
  const r = await runScout(buildLinearProjectsPrompt(teamId), model, LINEAR_ALLOWED_TOOLS);
  if (!r.ok) return { ok: false, connector: r.connector, projects: [], reason: r.reason };
  const projects = parseLinearProjects(r.report);
  // Zero projects is a legitimate result here (a team may have none), so unlike
  // list_teams we don't treat it as a failure — the picker just offers only the
  // "all issues in the team" option. Log for diagnosability if the report looked
  // non-empty but parsed to nothing.
  if (projects.length === 0 && (r.report ?? '').trim().length > 2) {
    logger.warn(`[Backlog/linear] list_projects parsed 0 projects. Raw report: ${JSON.stringify((r.report ?? '').slice(0, 2000))}`);
  }
  return { ok: true, connector: 'connected', projects };
}

export interface LinearFetchResult {
  ok: boolean;
  connector: ScoutConnector;
  issues: LinearIssue[];
  reason?: string;
  costUsd: number | null;
}

/** List open issues for a linked Linear team per its filter. When `projectId`
 *  is set, scans are scoped to that single Linear project within the team. */
export async function fetchIssues(teamId: string, filter: ScoutFilter, model: string, projectId?: string): Promise<LinearFetchResult> {
  const r = await runScout(buildLinearScoutPrompt(teamId, filter, projectId), model, LINEAR_ALLOWED_TOOLS, SCOUT_SCAN_TIMEOUT_MS);
  if (!r.ok) return { ok: false, connector: r.connector, issues: [], reason: r.reason, costUsd: r.costUsd };
  return { ok: true, connector: 'connected', issues: parseLinearIssues(r.report), costUsd: r.costUsd };
}

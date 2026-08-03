// JIRA scout: a read-only `claude -p` run that calls the org Atlassian (Rovo) MCP
// to list sites (Step 1 of the link picker), a site's Jira projects (Step 2), and
// a project's open issues, with ONLY the Jira READ tools allow-listed. Sibling of
// gitlab-scout.ts / linear-scout.ts; the process engine lives in scout-core.ts.
//
// Contract verified 2026-07-31 against a headless run inheriting the connected
// + authenticated `claude.ai Atlassian` MCP against `zuru.atlassian.net`
// (see jira-plan.md §3):
//   - Tool prefix: `mcp__claude_ai_Atlassian__` (camelCase preserved verbatim).
//   - getAccessibleAtlassianResources → [{ id (cloudId), url, name, scopes[] }]
//     (returns DUPLICATE rows per scope group — dedupe by id).
//   - getVisibleJiraProjects(cloudId) → { values: [{ id, key, name, … }], … }
//   - searchJiraIssuesUsingJql(cloudId, jql) → { issues: { nodes: [...] }, … }
//     (GraphQL envelope — issues are under issues.nodes[], NOT a flat array).
//   - MUST pass --allowedTools or the headless agent never invokes the MCP tool.
// A per-project no-permission result comes back as an in-band { error, message }
// object (empty nodes), NOT an exception, and correctly does NOT match
// scout-core's AUTH_RE — it stays `connected` and surfaces as a scan reason.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { JiraProject, JiraSite } from '../../common/backlog-types';
import { logger } from '../../common/logger';
import { runScout, ScoutConnector, ScoutRunResult, SCOUT_SCAN_TIMEOUT_MS } from './scout-core';
import { buildJiraProjectsPrompt, buildJiraScoutPrompt, buildJiraSitesPrompt, JIRA_OFFLOADED_SENTINEL, previewDescription, ScoutFilter } from './prompt';

const JIRA_TOOL_PREFIX = 'mcp__claude_ai_Atlassian__';
const JIRA_ALLOWED_TOOLS = [
  'getAccessibleAtlassianResources', // Common — resolve cloudId (Step 1)
  'getVisibleJiraProjects',          // read_jira — link-time project picker (Step 2)
  'searchJiraIssuesUsingJql',        // search_jira — the scan workhorse
  'getJiraIssue',                    // read_jira — fallback if search omits fields
]
  .map((t) => JIRA_TOOL_PREFIX + t)
  .join(',');
// No user tool: JQL `assignee = currentUser()` resolves server-side.

export { ScoutConnector };
export type { JiraProject, JiraSite };

// In a headless run the org MCP tools are DEFERRED (loaded via tool search), and
// the cheap model occasionally rationalizes it "needs authorization" and returns
// prose instead of calling the tool (see prompt.ts JIRA_TOOL_DIRECTIVE). Such a
// report has no parseable JSON array of issues — even when it contains a stray
// bracket (a markdown [link], a "[1]"), which an `includes('[')` check would let
// slip through to a silent 0-issue parse. Keying on "extractJsonArray finds
// nothing" catches those: a genuine result (an array of issues OR a clean []) is
// non-null and never retries, while a prose bail is null and retries ONCE — a
// genuine refusal usually resolves on the second try.
function looksLikeRefusal(r: ScoutRunResult): boolean {
  if (!r.ok) return false;
  // The OFFLOADED sentinel is a VALID outcome (the result was saved to a file the runner
  // reads), not a prose bail — do not waste a retry (and another huge tool call) on it.
  if ((r.report ?? '').trim().toUpperCase().includes(JIRA_OFFLOADED_SENTINEL)) return false;
  return extractJsonArray(r.report) === null;
}

// JIRA scouts are pinned to Sonnet, NOT the configurable cheap scoutModel the
// GitLab/Linear scouts use. JIRA's payload is uniquely heavy (the tool returns the
// full Jira REST v3 representation per issue), so the search MUST reliably pass a
// `fields` restriction and must NOT bail when a result offloads. Haiku flakily
// omits `fields`, narrates, or gives up on the offloaded file and hangs the scan
// to the 240s timeout (observed repeatedly on DSOC); Sonnet passes the params and
// returns in ~3 turns. ~3× haiku token price, but the scan is small (fields-scoped)
// and infrequent — correctness wins. Overrides the model threaded from config.
const JIRA_SCOUT_MODEL = 'claude-sonnet-4-6';

/** runScout with a single retry when the report is a prose refusal (no JSON array). */
async function runJiraScout(prompt: string, timeoutMs?: number): Promise<ScoutRunResult> {
  const first = await runScout(prompt, JIRA_SCOUT_MODEL, JIRA_ALLOWED_TOOLS, timeoutMs);
  if (!looksLikeRefusal(first)) return first;
  logger.warn('[Backlog/jira] scout returned prose without a JSON array — retrying once.');
  return runScout(prompt, JIRA_SCOUT_MODEL, JIRA_ALLOWED_TOOLS, timeoutMs);
}

export interface JiraIssue {
  issueId: string;   // numeric issue id — STABLE across project moves → fingerprint
  issueKey: string;  // 'DSOC-482' — human key, display / ref (can change on move)
  title: string;
  description: string;
  webUrl: string;
  labels: string[];
}

/** Does this array contain at least one record (an issue/site/project object)
 *  rather than being a scalar array such as a `labels` string list? Deliberately
 *  false for [] — an EMPTY inner `labels:[]` must not be mistaken for an empty
 *  result. A genuine empty scan is recognised only at the array's leading `[`
 *  (see extractJsonArray), never by matching an empty array anywhere in the text. */
function looksLikeRecords(arr: unknown[]): boolean {
  return arr.some((e) => e !== null && typeof e === 'object' && !Array.isArray(e));
}

/** Walk from `start` (which points at `open`) to the matching `close`, ignoring
 *  brackets inside JSON string literals. Returns the balanced span (inclusive)
 *  or null if it never balances. */
function balancedFrom(text: string, start: number, open: string, close: string): string | null {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

/** First balanced array of records at any `[`, ignoring brackets inside string
 *  literals. Trying EVERY opener means a stray bracket in a prose preamble or
 *  inside a description (JIRA text is full of markdown [links]) can't misalign
 *  the span the way a naive indexOf/lastIndexOf slice would; requiring records
 *  (see looksLikeRecords) means a complete inner `labels` array can't be mistaken
 *  for the outer issues array when the latter is truncated and never balances. */
function firstRecordArray(text: string): unknown[] | null {
  for (let i = text.indexOf('['); i >= 0; i = text.indexOf('[', i + 1)) {
    const span = balancedFrom(text, i, '[', ']');
    if (!span) continue;
    try {
      const parsed = JSON.parse(span);
      if (Array.isArray(parsed) && looksLikeRecords(parsed)) return parsed;
    } catch {
      /* not JSON starting here — try the next opener */
    }
  }
  return null;
}

/** Salvage the complete `{…}` objects from a (possibly truncated) array region:
 *  scan from the first `[`, take each balanced top-level object, and stop at the
 *  first that doesn't close (the truncated tail). Recovers N-1 issues when a
 *  chatty model hand-reformats the tool result into its final message and that
 *  message is cut off mid-array — the observed DSOC failure (10 issues fetched,
 *  0 parsed because the array never closed). Advancing past each object's full
 *  span skips nested objects (node.fields{…}) so only array elements are taken. */
function salvageArrayObjects(text: string): unknown[] | null {
  const from = text.indexOf('[');
  if (from < 0) return null;
  const out: unknown[] = [];
  for (let j = text.indexOf('{', from); j >= 0; j = text.indexOf('{', j)) {
    const span = balancedFrom(text, j, '{', '}');
    if (!span) break; // final object is truncated — keep the complete ones
    try { out.push(JSON.parse(span)); } catch { /* not an object here — skip */ }
    j += span.length;
  }
  return out.length > 0 ? out : null;
}

/** Extract a JSON array from a scout report (```json fence / prose / object
 *  wrapper tolerant, robust to brackets inside string values, and to a truncated
 *  trailing element). Returns null only when no JSON object could be parsed. */
function extractJsonArray(report: string | undefined | null): unknown[] | null {
  if (!report) return null;
  const text = report.trim();
  // Prefer a fenced code block's contents (the scout sometimes wraps the array
  // in ```json … ``` behind a prose preamble), then fall back to the whole text.
  const fence = /```[a-z]*\s*([\s\S]*?)```/i.exec(text);
  // A truncated report has an UNCLOSED fence, so the regex won't match it — fall
  // back to the whole text in that case (which is where salvage earns its keep).
  const haystacks = fence ? [fence[1].trim(), text] : [text];
  for (const h of haystacks) {
    // When a haystack IS the array (fence content, or a raw `[…]`/`[]` reply), its
    // leading `[` is authoritative: a balanced `[]` is a genuine no-results scan,
    // a records array is the result, and a non-balancing `[` is a truncated outer
    // array whose complete elements we salvage below.
    if (h.startsWith('[')) {
      const span = balancedFrom(h, 0, '[', ']');
      if (span) {
        try {
          const parsed = JSON.parse(span);
          if (Array.isArray(parsed) && (parsed.length === 0 || looksLikeRecords(parsed))) return parsed;
        } catch { /* fall through to the scanners */ }
      }
    }
    // Otherwise: the first records array anywhere (skips prose brackets and scalar
    // arrays like labels), then salvage a truncated one's complete elements.
    const arr = firstRecordArray(h) ?? salvageArrayObjects(h);
    if (arr) return arr;
  }
  return null;
}

/** Parse a getAccessibleAtlassianResources report into sites. The tool returns
 *  one row PER SCOPE GROUP, so the same site appears multiple times — dedupe by
 *  cloudId (id). Drops rows missing an id. Accepts `cloudId`/`url`/`siteUrl`
 *  aliases in case the scout reshapes the fields via the prompt. */
export function parseJiraSites(report: string | undefined | null): JiraSite[] {
  const arr = extractJsonArray(report);
  if (!arr) return [];
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const seen = new Set<string>();
  const out: JiraSite[] = [];
  for (const r of arr as any[]) {
    if (!r || typeof r !== 'object') continue;
    const cloudId = str(r.cloudId) || str(r.id);
    if (cloudId.length === 0 || seen.has(cloudId)) continue; // id is the required, dedup key.
    const siteUrl = str(r.siteUrl) || str(r.url);
    const name = str(r.name) || siteUrl || cloudId;
    seen.add(cloudId);
    out.push({ cloudId, siteUrl, name });
  }
  return out;
}

/** Parse a getVisibleJiraProjects report into projects; drops rows missing a key
 *  or name. Projects live under `.values[]`; extractJsonArray unwraps that. */
export function parseJiraProjects(report: string | undefined | null): JiraProject[] {
  const arr = extractJsonArray(report);
  if (!arr) return [];
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const out: JiraProject[] = [];
  for (const r of arr as any[]) {
    if (!r || typeof r !== 'object') continue;
    const key = str(r.key);
    const name = str(r.name) || str(r.title) || key;
    if (key.length === 0 || name.length === 0) continue;
    out.push({ key, name });
  }
  return out;
}

/**
 * Parse a searchJiraIssuesUsingJql report into issues. Issues live under the
 * GraphQL envelope's `issues.nodes[]`; extractJsonArray finds that array (it's
 * the first array-valued property once nested wrappers are unwrapped, but the
 * scout is asked to flatten to nodes — accept either). Reads node.id (stable
 * numeric id → fingerprint), node.key (display), node.fields.summary/labels/
 * description, node.webUrl. Requires a non-empty issueId AND title; drops the
 * rest. Tolerant of the scout reshaping fields to top-level aliases.
 */
export function parseJiraIssues(report: string | undefined | null): JiraIssue[] {
  const arr = extractJsonArray(report);
  if (!arr) return [];
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
  const out: JiraIssue[] = [];
  for (const r of arr as any[]) {
    if (!r || typeof r !== 'object') continue;
    const fields = (r.fields && typeof r.fields === 'object' ? r.fields : {}) as Record<string, unknown>;
    const issueId = str(r.issueId) || str(r.id);
    const issueKey = str(r.issueKey) || str(r.key);
    const title = str(r.title) || str(fields.summary) || str(r.summary);
    if (issueId.length === 0 || title.length === 0) continue;
    const webUrl = str(r.webUrl) || str(r.url);
    const rawLabels = Array.isArray(r.labels) ? r.labels : Array.isArray(fields.labels) ? fields.labels : [];
    const description =
      typeof r.description === 'string' ? r.description : typeof fields.description === 'string' ? fields.description : '';
    out.push({
      issueId,
      issueKey,
      title,
      description: previewDescription(description),
      webUrl,
      labels: (rawLabels as unknown[]).filter((x): x is string => typeof x === 'string'),
    });
  }
  return out;
}

export interface SitesResult {
  ok: boolean;
  connector: ScoutConnector;
  sites: JiraSite[];
  reason?: string;
}

/** List the user's accessible Atlassian sites for the link-time Step-1 picker. */
export async function listSites(): Promise<SitesResult> {
  const r = await runJiraScout(buildJiraSitesPrompt());
  if (!r.ok) return { ok: false, connector: r.connector, sites: [], reason: r.reason };
  const sites = parseJiraSites(r.report);
  if (sites.length === 0) {
    logger.warn(`[Backlog/jira] getAccessibleAtlassianResources parsed 0 sites. Raw report: ${JSON.stringify((r.report ?? '').slice(0, 2000))}`);
    return { ok: false, connector: 'connected', sites: [], reason: 'no Atlassian sites returned' };
  }
  logger.info(`[Backlog/jira] listSites → ${sites.length} site(s): ${sites.map((s) => s.name).join(', ')}`);
  return { ok: true, connector: 'connected', sites };
}

export interface ProjectsResult {
  ok: boolean;
  connector: ScoutConnector;
  projects: JiraProject[];
  reason?: string;
}

/** List a site's Jira projects for the mandatory Step-2 picker. */
export async function listProjects(cloudId: string): Promise<ProjectsResult> {
  const r = await runJiraScout(buildJiraProjectsPrompt(cloudId));
  if (!r.ok) return { ok: false, connector: r.connector, projects: [], reason: r.reason };
  const projects = parseJiraProjects(r.report);
  // Zero projects is a legitimate result (a site the user can't browse any project
  // on), so unlike listSites we don't fail — log only if the report looked non-empty.
  if (projects.length === 0 && (r.report ?? '').trim().length > 2) {
    logger.warn(`[Backlog/jira] getVisibleJiraProjects parsed 0 projects. Raw report: ${JSON.stringify((r.report ?? '').slice(0, 2000))}`);
  } else {
    logger.info(`[Backlog/jira] listProjects(${cloudId}) → ${projects.length} project(s)`);
  }
  return { ok: true, connector: 'connected', projects };
}

export interface JiraFetchResult {
  ok: boolean;
  connector: ScoutConnector;
  issues: JiraIssue[];
  reason?: string;
  costUsd: number | null;
}

/**
 * Locate the offloaded searchJiraIssuesUsingJql tool-result file for a scout run and
 * return its raw JSON, or null. The Rovo Jira search tool ignores `fields`, clamps
 * maxResults to >=50, and returns the full REST v3 rep, so a busy project's result
 * (170KB+) exceeds the CLI tool-result token cap and is saved to
 *   <home>/.claude/projects/<encoded-cwd>/<sessionId>/tool-results/mcp-…searchJiraIssuesUsingJql-*.txt
 * which the read-only scout can't consume but Node can (no token limit). Prefer the run's
 * own sessionId; when it's absent (the run timed out before emitting JSON) fall back to the
 * newest matching file written since the run began — scans run one at a time, so that's ours.
 */
function readOffloadedSearchResult(sessionId: string | null | undefined, sinceMs: number): string | null {
  try {
    const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsRoot)) return null;
    const isSearchFile = (f: string): boolean => f.includes('searchJiraIssuesUsingJql') && f.endsWith('.txt');
    const candidates: { file: string; mtimeMs: number }[] = [];
    for (const proj of fs.readdirSync(projectsRoot)) {
      const projPath = path.join(projectsRoot, proj);
      let sessions: string[];
      try {
        sessions = sessionId ? [sessionId] : fs.readdirSync(projPath);
      } catch { continue; }
      for (const sess of sessions) {
        const trDir = path.join(projPath, sess, 'tool-results');
        let names: string[];
        try { names = fs.readdirSync(trDir); } catch { continue; }
        for (const f of names) {
          if (!isSearchFile(f)) continue;
          const full = path.join(trDir, f);
          try {
            const mtimeMs = fs.statSync(full).mtimeMs;
            // With a known sessionId the dir already scopes to this run; without it, only
            // accept files written during this run so a stale prior scan's file can't leak.
            if (sessionId || mtimeMs >= sinceMs) candidates.push({ file: full, mtimeMs });
          } catch { /* skip unreadable entry */ }
        }
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return fs.readFileSync(candidates[0].file, 'utf8');
  } catch (e: any) {
    logger.warn(`[Backlog/jira] failed to read offloaded search result: ${e?.message ?? e}`);
    return null;
  }
}

/** List open issues for a linked JIRA project per its filter. cloudId scopes the
 *  call; projectKey scopes the JQL (`project = KEY`). A busy project's result is
 *  offloaded to a file (see readOffloadedSearchResult) — we read it directly rather
 *  than depend on the read-only scout consuming it. */
export async function fetchIssues(cloudId: string, projectKey: string, filter: ScoutFilter): Promise<JiraFetchResult> {
  const startedMs = Date.now();
  const r = await runJiraScout(buildJiraScoutPrompt(cloudId, projectKey, filter), SCOUT_SCAN_TIMEOUT_MS);

  // Inline path: a small project's issues come back in the model's report directly.
  let issues = parseJiraIssues(r.report);
  let via = 'inline';

  // Offloaded path: the model saw a too-large result and emitted the OFFLOADED sentinel
  // (or the run failed/timed out or returned nothing). The tool wrote the full result to
  // a file BEFORE the model gave up, so read + parse that file directly.
  const sentinel = (r.report ?? '').trim().toUpperCase().includes(JIRA_OFFLOADED_SENTINEL);
  if (issues.length === 0 && (sentinel || !r.ok || (r.report ?? '').trim().length === 0)) {
    const raw = readOffloadedSearchResult(r.sessionId, startedMs);
    if (raw) {
      const fromFile = parseJiraIssues(raw);
      if (fromFile.length > 0) { issues = fromFile; via = sentinel ? 'offload-file' : 'offload-file(recovered)'; }
    }
  }

  if (issues.length > 0) {
    logger.info(`[Backlog/jira] fetchIssues(${projectKey}, ${filter.mode}) → ${issues.length} issue(s) via ${via}, cost $${r.costUsd ?? 0}`);
    return { ok: true, connector: 'connected', issues, costUsd: r.costUsd };
  }

  // Nothing from either path. A failed scout (timeout/auth) is a real failure to surface;
  // an ok run with no issues is a genuine empty result (log head+tail to disambiguate).
  if (!r.ok) return { ok: false, connector: r.connector, issues: [], reason: r.reason, costUsd: r.costUsd };
  const report = r.report ?? '';
  const head = JSON.stringify(report.slice(0, 1500));
  const tail = report.length > 1500 ? ` … [len=${report.length}] tail=${JSON.stringify(report.slice(-500))}` : '';
  logger.warn(`[Backlog/jira] fetchIssues(${projectKey}, ${filter.mode}) parsed 0 issues. Raw report: ${head}${tail}`);
  logger.info(`[Backlog/jira] fetchIssues(${projectKey}, ${filter.mode}) → 0 issue(s), cost $${r.costUsd ?? 0}`);
  return { ok: true, connector: 'connected', issues: [], costUsd: r.costUsd };
}

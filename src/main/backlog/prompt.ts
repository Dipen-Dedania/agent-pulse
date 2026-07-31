import { BacklogCard } from '../../common/backlog-types';

export interface PromptAttachment {
  filename: string;
  content: string;
}

/**
 * Render attached files as a markdown section for the executor prompt. Each
 * file is fenced with a backtick run longer than any run inside its content, so
 * a file that itself contains ``` can't break out of its block. Returns an
 * empty array (no lines) when there are no attachments.
 */
function attachmentLines(attachments: PromptAttachment[]): string[] {
  if (!attachments || attachments.length === 0) return [];
  const lines: string[] = [
    '',
    '## Attached files',
    'These files are attached to this card as authoritative input. Use their',
    'contents directly — they may not exist on disk in your working directory.',
  ];
  for (const att of attachments) {
    const longestTick = (att.content.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
    const fence = '`'.repeat(Math.max(3, longestTick + 1));
    lines.push('', `### ${att.filename}`, fence, att.content, fence);
  }
  return lines;
}

// Phase 1 contract: research only. The runner never grants write permissions
// (headless `claude -p` denies Write/Edit/Bash by default and we add
// --disallowedTools as belt-and-braces), so this instruction is the third
// layer — it shapes the output into a report instead of attempted edits.
const RESEARCH_CONTRACT = `---
This is a READ-ONLY research task. Do not create, modify, or delete any files;
do not run commands that change state. Investigate using read-only tools only.

Output your findings as a complete, self-contained markdown report as your
final message. The final message IS the deliverable — include all sections,
details, and file references in it.

Finish your final message with a status line on its own line, exactly one of:
  STATUS: completed  — the task is fully answered
  STATUS: partial    — useful findings, but the task is not fully answered
  STATUS: blocked    — you could not proceed (explain why above, e.g. a needed
                       file or context was unavailable). Do not guess.`;

/** Build the headless executor prompt for a research card. */
export function buildResearchPrompt(
  card: Pick<BacklogCard, 'title' | 'description'>,
  attachments: PromptAttachment[] = [],
): string {
  const description = card.description.trim();
  return [
    `# Research task: ${card.title.trim()}`,
    '',
    description.length > 0 ? description : 'No further description was provided — interpret the title.',
    ...attachmentLines(attachments),
    '',
    RESEARCH_CONTRACT,
  ].join('\n');
}

// Phase 2 execution contract. Layer 3 of the safety posture: the runner
// already denies Bash (no git possible) and confines Write/Edit to the
// worktree cwd via acceptEdits — this shapes behavior and the output format.
const EXECUTION_CONTRACT = `---
This is a CODE CHANGE task running in an isolated git worktree.

Rules:
- Edit files only inside the current working directory.
- Do NOT commit, stage, branch, or push — leave ALL changes as uncommitted
  files in the working tree. The diff is your deliverable.
- If the task turns out to be impossible or unsafe, change nothing and explain
  why in your final message.

When done, output a concise markdown summary as your final message: what
changed and why, file-by-file notes, and anything a reviewer should verify.
The summary is stored on the card next to the captured diff.

Finish your final message with a status line on its own line, exactly one of:
  STATUS: completed  — the change is fully implemented
  STATUS: partial    — real progress, but not everything was finished
  STATUS: blocked    — you could not proceed and changed nothing (explain why
                       above, e.g. a needed file or context was unavailable).
                       Do not guess at an implementation you cannot verify.`;

// QA contract: research's read-only posture + chrome-devtools-mcp browser
// tools. The runner allows ONLY mcp__chrome-devtools__* beyond the read-only
// defaults (Write/Edit/Bash stay disallowed), so "changes nothing" is
// structural; screenshots are written by the MCP server via take_screenshot's
// filePath parameter, not by the agent.
const QA_CONTRACT = `---
This is a READ-ONLY QA verification task. Do not create, modify, or delete any
project files; do not run commands that change state. You have browser tools
(chrome-devtools-mcp) to inspect the running app, plus read-only access to the
repository for cross-referencing code.

Method:
1. Open the app URL with the browser tools. If the page does not load, stop
   and report STATUS: blocked with what you observed — do not guess.
2. For EACH acceptance criterion: verify it against the live UI using
   take_snapshot (DOM/accessibility tree), take_screenshot (visuals),
   list_console_messages (runtime errors), and interactions (click, fill,
   navigate) as needed.
3. Save evidence screenshots with take_screenshot's filePath parameter — one
   per criterion where visual evidence is meaningful. filePath MUST be the
   ABSOLUTE path of the screenshots directory given below joined with a
   descriptive kebab-case filename ending in .png. NEVER pass a bare or
   relative filePath — a relative path is written outside the artifacts
   directory and the screenshot is lost.
   Embed each screenshot in your report with markdown image syntax using the
   BARE filename only (no directory), e.g.
   ![theme toggle in dark mode](theme-toggle-dark.png) — the report viewer
   resolves bare filenames and renders these inline.

Output your findings as a complete, self-contained markdown QA report as your
final message. The final message IS the deliverable. Structure it as:
- A one-line overall verdict first (e.g. "4/5 criteria pass").
- A "## Criteria" section with one entry per criterion: PASS or FAIL, what you
  checked, what you observed, and the screenshot filename(s) if any.
- A "## Console & errors" section noting any console errors or failed network
  requests (or "none observed").

Finish your final message with a status line on its own line, exactly one of:
  STATUS: completed  — every criterion was checked (pass OR fail — a failing
                       criterion is still a completed QA run)
  STATUS: partial    — some criteria could not be checked (say which and why)
  STATUS: blocked    — the app was unreachable or QA could not proceed at all`;

/** Build the headless executor prompt for a QA (browser verification) card. */
export function buildQaPrompt(
  card: Pick<BacklogCard, 'title' | 'description' | 'acceptanceCriteria' | 'qaUrl'>,
  screenshotsDir: string,
  attachments: PromptAttachment[] = [],
): string {
  const description = card.description.trim();
  const criteria = card.acceptanceCriteria.filter((c) => c.trim().length > 0);
  return [
    `# QA task: ${card.title.trim()}`,
    '',
    description.length > 0 ? description : 'No further description was provided — interpret the title.',
    '',
    `App URL: ${card.qaUrl ?? '(none set — the card description must say what to open; if it does not, report STATUS: blocked)'}`,
    `Screenshots directory (absolute, already exists): ${screenshotsDir}`,
    `Example take_screenshot filePath: ${screenshotsDir}${screenshotsDir.includes('\\') ? '\\' : '/'}criterion-1-login.png`,
    ...(criteria.length > 0
      ? ['', '## Acceptance criteria to verify', ...criteria.map((c, i) => `${i + 1}. ${c.trim()}`)]
      : ['', '## Acceptance criteria to verify', 'None were provided — derive sensible checks from the title and description, and list the checks you performed in the report.']),
    ...attachmentLines(attachments),
    '',
    QA_CONTRACT,
  ].join('\n');
}

// ── GitLab scout prompts (Phase 3 population) ────────────────────────────────
// The scout is a read-only `claude -p` run with only the GitLab MCP tools
// allow-listed (see gitlab-scout.ts). These prompts steer it to emit strict
// JSON so parseScoutIssues can consume the result deterministically. Prompts go
// over stdin, so interpolated ids/labels never touch argv.

// Scan bounds (Phase 3). A busy team/project can return an issue payload large
// enough to trip the CLI's large-tool-result offload, which balloons ONE scan
// into many turns / minutes and blows the scout timeout (see scout-core's
// SCOUT_SCAN_TIMEOUT_MS). Issue COUNT is the primary lever — keep the tool
// result small so no offload happens; the description preview bounds each row
// (and what an imported card stores). Kept generous enough that a candidate
// card stays useful — the full issue is one click away via its webUrl.
export const SCOUT_MAX_ISSUES = 50;
export const SCOUT_DESC_PREVIEW_CHARS = 500;

const SCOUT_BOUNDS =
  `Return at most ${SCOUT_MAX_ISSUES} issues (the most recently updated). If the tool supports a ` +
  `result limit or page size, request that many and do not page further; otherwise take the first ` +
  `${SCOUT_MAX_ISSUES}. For each issue, include only the first ${SCOUT_DESC_PREVIEW_CHARS} characters ` +
  `of its description.`;

/** Cap a description to the scan preview length. Belt-and-braces: SCOUT_BOUNDS
 *  already asks the scout to truncate, but a model may ignore it, so the parser
 *  enforces the bound before a candidate is stored. */
export function previewDescription(s: string): string {
  if (s.length <= SCOUT_DESC_PREVIEW_CHARS) return s;
  return s.slice(0, SCOUT_DESC_PREVIEW_CHARS).trimEnd() + '…';
}

const SCOUT_CONTRACT = `---
Return ONLY a JSON array as your final message — no prose, no markdown code fences.
Each element must be exactly:
  { "iid": <number>, "title": <string>, "description": <string>, "webUrl": <string>, "labels": <string[]> }
Use the issue's IID (its per-project number), its web URL, and its label names.
${SCOUT_BOUNDS}
If there are no matching issues, return []. Call the GitLab tool at most once.`;

/** Resolve a 'group/sub/project' path to its numeric GitLab id. */
export function buildScoutResolvePrompt(host: string, projectPath: string): string {
  return [
    `Resolve the GitLab project "${projectPath}" on host ${host} using the GitLab MCP get_project tool.`,
    'Return ONLY its numeric project id as a bare number — no prose, no punctuation, no code fences.',
  ].join('\n');
}

export interface ScoutFilter {
  mode: 'assigned' | 'all' | 'label';
  labels: string[];
}

/** List open issues for a project per the filter mode; output is strict JSON. */
export function buildScoutPrompt(projectId: number, filter: ScoutFilter): string {
  let instruction: string;
  if (filter.mode === 'assigned') {
    instruction =
      `List the OPEN issues assigned to me in GitLab project id ${projectId}. ` +
      `Use the GitLab MCP my_issues tool with project_id=${projectId} and state=opened.`;
  } else if (filter.mode === 'label') {
    const labels = filter.labels.filter((l) => l.trim().length > 0);
    instruction = labels.length > 0
      ? `List the OPEN issues in GitLab project id ${projectId} carrying the label(s) ${labels.join(', ')}. ` +
        `Use the GitLab MCP list_issues tool with project_id=${projectId}, state=opened, and labels=[${labels.join(', ')}].`
      : `List the OPEN issues in GitLab project id ${projectId}. ` +
        `Use the GitLab MCP list_issues tool with project_id=${projectId} and state=opened.`;
  } else {
    instruction =
      `List ALL OPEN issues in GitLab project id ${projectId}. ` +
      `Use the GitLab MCP list_issues tool with project_id=${projectId} and state=opened.`;
  }
  return [instruction, '', SCOUT_CONTRACT].join('\n');
}

// ── Linear scout prompts (Phase 3 population) ────────────────────────────────
// Sibling of the GitLab scout prompts. The Linear scout is a read-only
// `claude -p` run with only the Linear MCP tools allow-listed (see
// linear-scout.ts). Prompts go over stdin, so interpolated ids/labels never
// touch argv. Contract verified 2026-07-30 (memory: linear-scout-contract).

const LINEAR_SCOUT_CONTRACT = `---
Return ONLY a JSON array as your final message — no prose, no markdown code fences.
Each element must be exactly:
  { "identifier": <string>, "title": <string>, "description": <string>, "url": <string>, "labels": <string[]> }
The list_issues tool returns the issue's human reference (e.g. "DEV-1036") in its
\`id\` field — map that to "identifier" in your output. If you request a field
selection, never ask for a field named "identifier"; the tool has no such field
and will reject the call. Use the issue's web URL and its label names.
${SCOUT_BOUNDS}
If there are no matching issues, return []. Call the Linear tool at most once.`;

/** List the workspace's Linear teams for the link-time picker; strict JSON. */
export function buildLinearTeamsPrompt(): string {
  return [
    'List my Linear teams using the Linear MCP list_teams tool.',
    'Return ONLY a JSON array of objects with fields id and name (include key if the',
    'tool provides one) — no prose, no notes, no code fences.',
  ].join('\n');
}

/** List a Linear team's projects for the optional link-time narrowing step. The
 *  list_projects tool takes a `team` param (the team id); strict JSON out. */
export function buildLinearProjectsPrompt(teamId: string): string {
  return [
    `List the projects in the Linear team with id ${teamId} using the Linear MCP list_projects tool with team=${teamId}.`,
    'Return ONLY a JSON array of objects with fields id and name — no prose, no notes, no code fences.',
  ].join('\n');
}

/** List open issues for a Linear team per the filter mode; output is strict
 *  JSON. When `projectId` is set, scope to that single Linear project (the
 *  list_issues `project` filter param) instead of the whole team. */
export function buildLinearScoutPrompt(teamId: string, filter: ScoutFilter, projectId?: string): string {
  // Optional narrowing clause appended to every filter mode's instruction. The
  // Linear list_issues param for a single project is `project` (NOT projectId).
  const scope = projectId && projectId.trim().length > 0
    ? ` Restrict to the Linear project with id ${projectId} by passing project=${projectId} to the tool.`
    : '';
  let instruction: string;
  if (filter.mode === 'assigned') {
    instruction =
      `List the OPEN issues assigned to me in the Linear team with id ${teamId}. ` +
      `Use the Linear MCP list_issues tool filtered to that team, assignee = me, and open (non-completed, non-canceled) states.`;
  } else if (filter.mode === 'label') {
    const labels = filter.labels.filter((l) => l.trim().length > 0);
    instruction = labels.length > 0
      ? `List the OPEN issues in the Linear team with id ${teamId} carrying the label(s) ${labels.join(', ')}. ` +
        `Use the Linear MCP list_issues tool filtered to that team, those labels, and open states.`
      : `List the OPEN issues in the Linear team with id ${teamId}. ` +
        `Use the Linear MCP list_issues tool filtered to that team and open states.`;
  } else {
    instruction =
      `List ALL OPEN issues in the Linear team with id ${teamId}. ` +
      `Use the Linear MCP list_issues tool filtered to that team and open (non-completed, non-canceled) states.`;
  }
  return [instruction + scope, '', LINEAR_SCOUT_CONTRACT].join('\n');
}

/** Build the headless executor prompt for an execution card. */
export function buildExecutionPrompt(
  card: Pick<BacklogCard, 'title' | 'description' | 'acceptanceCriteria'>,
  attachments: PromptAttachment[] = [],
): string {
  const description = card.description.trim();
  const criteria = card.acceptanceCriteria.filter((c) => c.trim().length > 0);
  return [
    `# Task: ${card.title.trim()}`,
    '',
    description.length > 0 ? description : 'No further description was provided — interpret the title.',
    ...(criteria.length > 0
      ? ['', '## Acceptance criteria', ...criteria.map((c, i) => `${i + 1}. ${c.trim()}`)]
      : []),
    ...attachmentLines(attachments),
    '',
    EXECUTION_CONTRACT,
  ].join('\n');
}

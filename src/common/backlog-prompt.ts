import { BacklogCard, BacklogTaskType } from './backlog-types';

// Executor prompt builders for backlog cards. These live in src/common (not
// src/main) so the renderer's card-editor prompt preview can import the SAME
// builders the runner uses — a single source of truth means the preview can't
// drift from what actually runs. The runner (src/main/backlog/engine.ts) and
// its tests import these via src/main/backlog/prompt.ts, which re-exports them.
// The GitLab/Linear/JIRA scout prompts stay in src/main — they're main-only.

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
export function attachmentLines(attachments: PromptAttachment[]): string[] {
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

// Research contract. The runner never grants write access (Claude: headless
// `claude -p` denies Write/Edit/Bash and we add --disallowedTools; Codex:
// `-s read-only` sandbox), so this instruction is the last layer — it shapes
// the output into a report instead of attempted edits. Wording is agent-
// neutral: capabilities, not tool names.
const RESEARCH_CONTRACT = `---
This is a READ-ONLY research task. Do not create, modify, or delete any files;
do not run commands that change state. Investigate using read-only means only
(reading files, searching, listing).

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

// Execution contract. Last layer of the safety posture: the runner confines
// edits to the worktree (Claude: acceptEdits with no Bash, so git is
// impossible; Codex: workspace-write sandbox, where the worktree's git dir in
// the main repo is outside the writable root) and the engine folds any commit
// back into the working tree before capturing the diff — this shapes behavior
// and the output format. Wording is agent-neutral.
const EXECUTION_CONTRACT = `---
This is a CODE CHANGE task running in an isolated git worktree.

Rules:
- Edit files only inside the current working directory.
- Do NOT commit, stage, branch, or push — leave ALL changes as uncommitted
  files in the working tree. The diff is your deliverable. If a git command
  is denied, that is expected: do not retry it or work around it.
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
// tools. The runner keeps the run read-only (Claude: only the chrome-devtools
// MCP tools are allowed beyond the read-only defaults; Codex: `-s read-only`
// with the MCP server injected via a config profile), so "changes nothing" is
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

// ── Prompt preview (card editor) ─────────────────────────────────────────────
// The renderer's "Preview prompt" button assembles the exact prompt the runner
// would send, from live editor state, by routing to the builder above that
// matches the card's task type. A QA card's screenshots directory is an
// absolute path assigned only when the card actually runs, so the preview uses
// this labeled placeholder in its place.
export const PREVIEW_SCREENSHOTS_DIR = '«screenshots directory — assigned when the card runs»';

export interface PreviewInput {
  title: string;
  description: string;
  taskType: BacklogTaskType;
  acceptanceCriteria: string[];
  qaUrl: string | null;
}

/** Assemble the executor prompt for the card editor's preview. Mirrors the
 *  runner's own dispatch in engine.ts so the preview matches what will run. */
export function buildPreviewPrompt(input: PreviewInput, attachments: PromptAttachment[] = []): string {
  if (input.taskType === 'execution') {
    return buildExecutionPrompt(
      { title: input.title, description: input.description, acceptanceCriteria: input.acceptanceCriteria },
      attachments,
    );
  }
  if (input.taskType === 'qa') {
    return buildQaPrompt(
      {
        title: input.title,
        description: input.description,
        acceptanceCriteria: input.acceptanceCriteria,
        qaUrl: input.qaUrl,
      },
      PREVIEW_SCREENSHOTS_DIR,
      attachments,
    );
  }
  return buildResearchPrompt({ title: input.title, description: input.description }, attachments);
}

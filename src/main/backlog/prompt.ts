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

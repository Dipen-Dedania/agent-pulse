import { BacklogCard } from '../../common/backlog-types';

// Phase 1 contract: research only. The runner never grants write permissions
// (headless `claude -p` denies Write/Edit/Bash by default and we add
// --disallowedTools as belt-and-braces), so this instruction is the third
// layer — it shapes the output into a report instead of attempted edits.
const RESEARCH_CONTRACT = `---
This is a READ-ONLY research task. Do not create, modify, or delete any files;
do not run commands that change state. Investigate using read-only tools only.

Output your findings as a complete, self-contained markdown report as your
final message. The final message IS the deliverable — include all sections,
details, and file references in it.`;

/** Build the headless executor prompt for a research card. */
export function buildResearchPrompt(card: Pick<BacklogCard, 'title' | 'description'>): string {
  const description = card.description.trim();
  return [
    `# Research task: ${card.title.trim()}`,
    '',
    description.length > 0 ? description : 'No further description was provided — interpret the title.',
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
The summary is stored on the card next to the captured diff.`;

/** Build the headless executor prompt for an execution card. */
export function buildExecutionPrompt(
  card: Pick<BacklogCard, 'title' | 'description' | 'acceptanceCriteria'>,
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
    '',
    EXECUTION_CONTRACT,
  ].join('\n');
}

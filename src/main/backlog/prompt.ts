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

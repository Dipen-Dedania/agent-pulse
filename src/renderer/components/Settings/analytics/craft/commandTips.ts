import { ClaudeCommandsPayload, TimelineRange } from '../../../../../common/timeline-types';
import type { Band } from './craftModel';

// Tips for the Slash commands card. Pure: each rule reads the user's own
// numbers and stays silent unless it fires. Command names are wrapped in
// backticks; the card renders those as code.
//
// Every factual claim was checked against code.claude.com (2026-11-23):
//  - `claude --continue` loads the most recent conversation in the current directory;
//  - `/model` saves the choice as the default for new sessions (user settings);
//  - a `model` key in a project's `.claude/settings.json` sets that project's
//    starting model and takes precedence over the user default;
//  - `/context` shows context usage; `/rewind` rolls back to a checkpoint.

export interface CommandTip {
  id: 'typos' | 'resume' | 'compact' | 'model' | 'discover' | 'fresh-starts';
  text: string;
  tone: 'tip' | 'positive';
}

export interface CommandTipContext {
  // From the compaction facts (trigger_kind), not the /compact command count,
  // so both sides of the share come from one source.
  compactions?: { total: number; manual: number } | null;
  contextBand?: Band | null;          // the scorecard's Context hygiene band
}

export const MAX_COMMAND_TIPS = 3;
const MIN_TYPOS = 2;
const RESUME_PER_WEEK = 10;
const MODEL_SWITCHES = 10;
const MIN_COMPACTIONS = 5;
const MANUAL_COMPACT_SHARE = 0.1;

const RANGE_WEEKS: Record<TimelineRange, number> = { '7d': 1, '30d': 30 / 7, '90d': 90 / 7, '1y': 365 / 7 };

const DISCOVERY_TEXT: Record<string, string> = {
  context: "Try `/context` to see what's filling your context window.",
  rewind: 'Try `/rewind` to roll the conversation or your code back to an earlier checkpoint.',
};

const cmd = (name: string) => `\`/${name}\``;

function typoTip(payload: ClaudeCommandsPayload): CommandTip | null {
  const typos = payload.unknown.filter((u) => u.suggestion !== null);
  const uses = typos.reduce((sum, u) => sum + u.count, 0);
  if (uses < MIN_TYPOS) return null;
  // Lead with the command that was mistyped most.
  const bySuggestion = new Map<string, { uses: number; names: string[] }>();
  for (const t of typos) {
    const group = bySuggestion.get(t.suggestion!) ?? { uses: 0, names: [] };
    group.uses += t.count;
    group.names.push(t.name);
    bySuggestion.set(t.suggestion!, group);
  }
  const [target, group] = Array.from(bySuggestion.entries()).sort((a, b) => b[1].uses - a[1].uses)[0];
  const names = group.names.slice(0, 2).map(cmd);
  const example = names.length === 2
    ? `${names[0]} and ${names[1]} look like ${cmd(target)}.`
    : `${names[0]} looks like ${cmd(target)}.`;
  return { id: 'typos', tone: 'tip', text: `${uses} commands look like typos. ${example}` };
}

export function commandTips(payload: ClaudeCommandsPayload, ctx: CommandTipContext = {}): CommandTip[] {
  const tips: CommandTip[] = [];
  const typed = payload.top.filter((row) => row.count > 0);
  const countOf = (name: string) => typed.find((row) => row.canonical === name)?.count ?? 0;

  const typos = typoTip(payload);
  if (typos) tips.push(typos);

  const resumes = countOf('resume');
  const resumeRank = typed.findIndex((row) => row.canonical === 'resume');
  if (resumes > 0 && ((resumeRank >= 0 && resumeRank < 3) || resumes / RANGE_WEEKS[payload.range] >= RESUME_PER_WEEK)) {
    tips.push({
      id: 'resume', tone: 'tip',
      text: `You ran ${cmd('resume')} ${resumes} times. \`claude --continue\` reopens the most recent conversation in the current folder straight from the terminal.`,
    });
  }

  const compactions = ctx.compactions;
  if (
    compactions && compactions.total >= MIN_COMPACTIONS
    && compactions.manual / compactions.total < MANUAL_COMPACT_SHARE
    && (ctx.contextBand === 'ok' || ctx.contextBand === 'needs-work')
  ) {
    tips.push({
      id: 'compact', tone: 'tip',
      text: `You started ${compactions.manual} of ${compactions.total} compactions yourself. Run ${cmd('compact')} with a note on what to keep before the context fills, instead of waiting for auto-compaction.`,
    });
  }

  const models = countOf('model');
  if (models >= MODEL_SWITCHES) {
    tips.push({
      id: 'model', tone: 'tip',
      text: `You ran ${cmd('model')} ${models} times. It saves your pick as the default for new sessions; a \`model\` key in a project's \`.claude/settings.json\` gives that project its own starting model.`,
    });
  }

  const undiscovered = payload.neverUsed.find((name) => DISCOVERY_TEXT[name]);
  if (undiscovered) tips.push({ id: 'discover', tone: 'tip', text: DISCOVERY_TEXT[undiscovered] });

  if (typed[0]?.canonical === 'clear') {
    tips.push({
      id: 'fresh-starts', tone: 'positive',
      text: `Fresh starts are your habit (${cmd('clear')} ×${typed[0].count}), which keeps each context small.`,
    });
  }

  return tips.slice(0, MAX_COMMAND_TIPS);
}

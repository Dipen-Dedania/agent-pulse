// On-demand "personalised coaching" for the Analytics → Your craft scorecard.
//
// A headless `claude -p` run reads ONLY the aggregate CraftPayload numbers
// (activity_facts never stores prompt text, so none can be sent) and returns a
// few concrete suggestions as JSON. The run gets no tools and no MCP servers:
// every built-in tool is denied and --strict-mcp-config with no --mcp-config
// loads zero servers. It is started only by an explicit click in the UI.

import { CraftCoachingResult, CraftMetrics, CraftPayload } from '../../common/timeline-types';
import { isSafeModelId } from '../../common/backlog-types';
import { runClaudeOneShot } from '../backlog/scout-core';

export const COACHING_TIMEOUT_MS = 90_000;
export const COACHING_MAX_TIPS = 5;
const COACHING_MAX_TIP_CHARS = 280;

// Every built-in tool. The run only needs to read its prompt and answer.
export const COACHING_DISALLOWED_TOOLS =
  'Bash,Edit,Write,NotebookEdit,Read,Grep,Glob,Agent,Task,WebFetch,WebSearch,TodoWrite';

export function buildCoachingArgs(model: string): string[] {
  const args = [
    '-p', '--output-format', 'json',
    '--strict-mcp-config',
    '--disallowedTools', COACHING_DISALLOWED_TOOLS,
  ];
  if (isSafeModelId(model)) args.push('--model', model);
  return args;
}

const RANGE_WORDS: Record<CraftPayload['range'], string> = {
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
  '90d': 'the last 90 days',
  '1y': 'the last year',
};

// Rounded so the prompt carries readable figures, not float noise.
function round(n: number | null, digits = 1): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function describeMetrics(m: CraftMetrics) {
  return {
    promptsWithText: m.prompts,
    medianWordsPerPrompt: round(m.medianWords),
    pctPromptsUnder10Words: round(m.shortPromptPct),
    pctSessionsOpenedWith40PlusWords: round(m.detailedOpenerPct),
    sessions: m.sessions,
    pctOnePromptSessions: round(m.oneShotPct),
    avgPromptsPerSession: round(m.avgPromptsPerSession),
    medianSecondsBetweenPrompts: m.medianThinkMs === null ? null : round(m.medianThinkMs / 1000, 0),
    autoCompactionsPerSession: round(m.autoCompactionsPerSession, 2),
    pctSessionsReachingContext80: round(m.highPressurePct),
    avgPromptCacheHitPct: m.avgCacheHitRatio === null ? null : round(m.avgCacheHitRatio * 100),
    pctSessionsUsingSubagents: round(m.delegationPct),
    pctEngagedTimeWaitingOnUser: round(m.waitPct),
    avgSecondsPerPermissionWait: m.avgWaitMs === null ? null : round(m.avgWaitMs / 1000, 0),
  };
}

/**
 * The coaching prompt. Contains only metric names and numbers derived from the
 * payload — never prompt text, titles, project names or paths.
 */
export function buildCoachingPrompt(payload: CraftPayload): string {
  const data = {
    window: RANGE_WORDS[payload.range],
    current: describeMetrics(payload.current),
    previousWindow: payload.previous ? describeMetrics(payload.previous) : null,
    openingPromptVsSessionLength: {
      sessionsOpenedWithShortPrompt: payload.correlation.shortSessions,
      avgPromptsWhenOpenerAtMost15Words: round(payload.correlation.shortAvgPrompts),
      sessionsOpenedWithDetailedPrompt: payload.correlation.detailedSessions,
      avgPromptsWhenOpenerAtLeast40Words: round(payload.correlation.detailedAvgPrompts),
    },
  };
  return [
    'You are coaching a software developer on how they work with AI coding agents',
    '(Claude Code, Codex and similar). Below are aggregate usage statistics measured',
    'locally on their machine. null means "not measured".',
    '',
    JSON.stringify(data, null, 2),
    '',
    `Give 3–${COACHING_MAX_TIPS} specific, actionable suggestions to help them get better results from`,
    'their agents, grounded in these numbers. Lead each with the habit to change, cite the',
    'number that motivated it, and keep each under 40 words. Skip anything the numbers',
    'show they already do well. Do not use any tools.',
    '',
    'Reply with ONLY a JSON object of the form {"tips": ["...", "..."]} and nothing else.',
  ].join('\n');
}

/** Parse the model's reply into tips; null when it isn't the requested JSON. */
export function parseCoachingTips(report: string): string[] | null {
  const text = report.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const tips = (parsed as { tips?: unknown })?.tips;
  if (!Array.isArray(tips)) return null;
  const out = tips
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => (t.length > COACHING_MAX_TIP_CHARS ? `${t.slice(0, COACHING_MAX_TIP_CHARS - 1)}…` : t))
    .slice(0, COACHING_MAX_TIPS);
  return out.length > 0 ? out : null;
}

export async function runCoaching(payload: CraftPayload, model: string): Promise<CraftCoachingResult> {
  const result = await runClaudeOneShot(
    buildCoachingPrompt(payload),
    buildCoachingArgs(model),
    COACHING_TIMEOUT_MS,
    'coaching',
  );
  const generatedAt = Date.now();
  if (!result.ok) {
    return { ok: false, tips: [], reason: result.reason ?? 'coaching run failed', costUsd: result.costUsd, generatedAt };
  }
  const tips = parseCoachingTips(result.report ?? '');
  if (!tips) {
    return { ok: false, tips: [], reason: 'The coaching reply was not in the expected format. Try again.', costUsd: result.costUsd, generatedAt };
  }
  return { ok: true, tips, costUsd: result.costUsd, generatedAt };
}

// "Your craft" scorecard model — pure functions, no React.
//
// Turns the aggregate CraftPayload into per-skill verdicts: a plain-language
// band from transparent heuristics, a trend against the user's own previous
// period, and one concrete tip. There are no industry benchmarks for any of
// this, so every threshold is a first guess kept in THRESHOLDS below and shown
// to the user verbatim (SkillView.rule) rather than dressed up as a score.

import { CRAFT_SHORT_PROMPT_WORDS, CraftCorrelation, CraftMetrics, CraftPayload } from '../../../../../common/timeline-types';

export type SkillId = 'clarity' | 'context' | 'delegation' | 'flow' | 'shape';
export type Band = 'strong' | 'ok' | 'needs-work';
export type Trend = 'better' | 'worse' | 'steady';
export type SignalFormat = 'pct' | 'words' | 'ratio' | 'perSession' | 'prompts' | 'duration';
/** Which way the raw number moved, independent of whether that is good. */
export type Direction = 'up' | 'down' | 'flat';

export interface SignalView {
  label: string;
  value: number | null;            // null → not measured in this window
  format: SignalFormat;
  trend: Trend | null;             // null → no comparable previous value
  direction: Direction | null;     // null whenever trend is null
}

export interface SkillView {
  id: SkillId;
  name: string;
  judged: boolean;                 // false → informational (Session shape): never banded
  enoughData: boolean;
  band: Band | null;               // null when !judged or !enoughData
  trend: Trend | null;
  signals: SignalView[];
  reason: string | null;           // why this band, with the number that decided it
  tip: string;
  rule: string;                    // the thresholds, in words, for the info tooltip
  note?: string;                   // coverage caveat
}

// ─── Thresholds (first guesses; tune against real data) ──────────────────────

export const THRESHOLDS = {
  minPrompts: 20,
  minSessions: 5,
  minStatuslineSessions: 5,
  minEngagedMs: 30 * 60 * 1000,
  clarity: { strongShortPctBelow: 25, strongMedianAtLeast: 20, weakShortPctAbove: 50, weakMedianBelow: 8 },
  context: { strongPressurePctBelow: 10, strongAutoPerSessionBelow: 0.05, weakPressurePctAbove: 30, weakAutoPerSessionAbove: 0.3 },
  delegation: { strongPctAtLeast: 20, weakPctBelow: 5, weakNeedsAvgPromptsAtLeast: 4 },
  flow: { strongWaitPctBelow: 5, weakWaitPctAbove: 20 },
  shape: { oneShotHeavyPctAbove: 60, longSessionAvgPromptsAbove: 15 },
  trend: { relativeChange: 0.1, minPctPoints: 2 },
  correlation: { minSessionsPerGroup: 5, minRatio: 1.3 },
} as const;

// ─── Tips ────────────────────────────────────────────────────────────────────

export const TIPS: Record<Exclude<SkillId, 'shape'>, Record<Band, string>> = {
  clarity: {
    'needs-work': 'Open with the goal, the files involved, and what "done" looks like. One clear paragraph up front saves several corrective follow-ups.',
    ok: 'Before sending, add the one constraint the agent can\'t infer: the test to run, the file to leave alone, or the pattern to follow.',
    strong: 'Your prompts carry real context. Move instructions you repeat into CLAUDE.md or AGENTS.md so you stop retyping them.',
  },
  context: {
    'needs-work': 'Start a fresh session between unrelated tasks, and compact yourself at a natural break instead of letting it trigger mid-task.',
    ok: 'When a session gets past about 60% of its context, finish the current step and compact with a note about what matters next.',
    strong: 'Your sessions stay lean. Keep scoping one task per session.',
  },
  delegation: {
    'needs-work': 'For broad searches or independent sub-tasks, ask the agent to use subagents. They keep the main context clean and can run in parallel.',
    ok: 'Try handing codebase exploration and review passes to subagents. They return a summary instead of filling your context.',
    strong: 'You delegate well. Give each subagent a clear brief and a narrow scope to keep its results sharp.',
  },
  flow: {
    'needs-work': 'Agents spend a lot of time waiting on you. Pre-approve safe commands (tests, lint, git status) in your permission settings so they keep moving.',
    ok: 'Look at which permission prompts you always approve, and add those commands to your allowlist.',
    strong: 'Agents rarely wait on you. Review your allowlist now and then so it stays safe as well as fast.',
  },
};

export const NOT_ENOUGH_DATA_TIP = 'Not enough activity in this window to judge this yet. Try a longer range.';

const SHAPE_TIPS = {
  oneShotHeavy: 'Most sessions are a single prompt. That suits quick questions; for real tasks, staying in one session keeps what the agent has already learned.',
  long: 'Your sessions run long. Splitting big tasks into one session per step keeps each context focused.',
  balanced: 'Your sessions have a healthy back-and-forth. Nothing to change here.',
};

// ─── Trend ───────────────────────────────────────────────────────────────────

/**
 * Direction of one signal between periods. `better` says which way is good.
 * Below a 10% relative change it is "steady"; a percentage must also move by
 * at least 2 points so 2% → 2.5% doesn't read as a 25% swing.
 */
export function signalTrend(
  cur: number | null,
  prev: number | null,
  better: 'up' | 'down',
  format: SignalFormat,
): Trend | null {
  if (cur === null || prev === null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  const diff = cur - prev;
  if (format === 'pct' && Math.abs(diff) < THRESHOLDS.trend.minPctPoints) return 'steady';
  if (prev === 0) {
    if (cur === 0) return 'steady';
  } else if (Math.abs(diff) / Math.abs(prev) < THRESHOLDS.trend.relativeChange) {
    return 'steady';
  }
  const up = diff > 0;
  return up === (better === 'up') ? 'better' : 'worse';
}

/** Majority of the signal trends; ties are "steady"; none comparable → null. */
export function combineTrends(trends: Array<Trend | null>): Trend | null {
  const known = trends.filter((t): t is Trend => t !== null);
  if (known.length === 0) return null;
  const better = known.filter((t) => t === 'better').length;
  const worse = known.filter((t) => t === 'worse').length;
  if (better > worse) return 'better';
  if (worse > better) return 'worse';
  return 'steady';
}

// ─── Per-skill evaluation ────────────────────────────────────────────────────

interface SignalSpec {
  label: string;
  format: SignalFormat;
  pick: (m: CraftMetrics) => number | null;
  better: 'up' | 'down' | null;  // null → shown but never trended
  counts: boolean;                // feeds the skill's trend
}

function buildSignals(
  specs: SignalSpec[],
  cur: CraftMetrics,
  prev: CraftMetrics | null,
): { signals: SignalView[]; trend: Trend | null } {
  const signals = specs.map((s): SignalView => {
    const value = s.pick(cur);
    const before = prev ? s.pick(prev) : null;
    const trend = prev && s.better ? signalTrend(value, before, s.better, s.format) : null;
    let direction: Direction | null = null;
    if (trend === 'steady') direction = 'flat';
    else if (trend) direction = (value as number) > (before as number) ? 'up' : 'down';
    return { label: s.label, value, format: s.format, trend, direction };
  });
  const trend = combineTrends(signals.filter((_, i) => specs[i].counts).map((s) => s.trend));
  return { signals, trend };
}

function clarity(cur: CraftMetrics, prev: CraftMetrics | null): SkillView {
  const t = THRESHOLDS.clarity;
  const enoughData = cur.prompts >= THRESHOLDS.minPrompts;
  const prevOk = prev && prev.prompts >= THRESHOLDS.minPrompts ? prev : null;
  const { signals, trend } = buildSignals([
    { label: 'Median prompt', format: 'words', pick: (m) => (m.prompts > 0 ? m.medianWords : null), better: 'up', counts: true },
    { label: 'Sessions opened in detail (40+ words)', format: 'pct', pick: (m) => (m.openedSessions > 0 ? m.detailedOpenerPct : null), better: 'up', counts: true },
  ], cur, prevOk);

  let band: Band | null = null;
  let reason: string | null = null;
  if (enoughData) {
    const short = cur.shortPromptPct ?? 0;
    const shortTxt = `${Math.round(short)}% of your prompts are ${CRAFT_SHORT_PROMPT_WORDS} words or fewer`;
    const medianTxt = `your median prompt is ${Math.round(cur.medianWords)} words`;
    if (short > t.weakShortPctAbove) {
      band = 'needs-work';
      reason = `${shortTxt}. Above ${t.weakShortPctAbove}% counts as needs work.`;
    } else if (cur.medianWords < t.weakMedianBelow) {
      band = 'needs-work';
      reason = `${cap(medianTxt)}. Under ${t.weakMedianBelow} counts as needs work.`;
    } else if (short < t.strongShortPctBelow && cur.medianWords >= t.strongMedianAtLeast) {
      band = 'strong';
      reason = `Only ${Math.round(short)}% of your prompts are ${CRAFT_SHORT_PROMPT_WORDS} words or fewer, and ${medianTxt}.`;
    } else {
      band = 'ok';
      reason = `${shortTxt}, and ${medianTxt}. Strong is under ${t.strongShortPctBelow}% with a ${t.strongMedianAtLeast}+ word median.`;
    }
  }
  return {
    id: 'clarity',
    name: 'Prompt clarity',
    judged: true,
    enoughData,
    band,
    trend: enoughData ? trend : null,
    signals,
    reason,
    tip: band ? TIPS.clarity[band] : NOT_ENOUGH_DATA_TIP,
    rule:
      `Strong: under ${t.strongShortPctBelow}% of prompts are ${CRAFT_SHORT_PROMPT_WORDS} words or fewer, and the median is ` +
      `${t.strongMedianAtLeast}+ words. Needs work: over ${t.weakShortPctAbove}% are that short, or the median is under ` +
      `${t.weakMedianBelow} words. Judged from ${THRESHOLDS.minPrompts}+ prompts.`,
  };
}

function context(cur: CraftMetrics, prev: CraftMetrics | null): SkillView {
  const t = THRESHOLDS.context;
  const pressureOf = (m: CraftMetrics) =>
    m.statuslineSessions >= THRESHOLDS.minStatuslineSessions ? m.highPressurePct : null;
  const enoughData = cur.activitySessions >= THRESHOLDS.minSessions;
  const prevOk = prev && prev.activitySessions >= THRESHOLDS.minSessions ? prev : null;
  const { signals, trend } = buildSignals([
    { label: 'Auto-compactions / session', format: 'perSession', pick: (m) => m.autoCompactionsPerSession, better: 'down', counts: true },
    { label: 'Sessions reaching 80% context', format: 'pct', pick: pressureOf, better: 'down', counts: true },
    { label: 'Prompt cache hit', format: 'ratio', pick: (m) => m.avgCacheHitRatio, better: 'up', counts: false },
  ], cur, prevOk);

  let band: Band | null = null;
  let reason: string | null = null;
  if (enoughData) {
    const auto = cur.autoCompactionsPerSession ?? 0;
    const pressure = pressureOf(cur);
    const autoTxt = `${auto.toFixed(2)} auto-compactions per session`;
    const pressureTxt = pressure !== null ? `${Math.round(pressure)}% of sessions reached 80% of their context` : null;
    if (auto > t.weakAutoPerSessionAbove) {
      band = 'needs-work';
      reason = `${cap(autoTxt)}. Above ${t.weakAutoPerSessionAbove} counts as needs work.`;
    } else if (pressure !== null && pressure > t.weakPressurePctAbove) {
      band = 'needs-work';
      reason = `${pressureTxt}. Above ${t.weakPressurePctAbove}% counts as needs work.`;
    } else if (auto < t.strongAutoPerSessionBelow && (pressure === null || pressure < t.strongPressurePctBelow)) {
      band = 'strong';
      reason = `Only ${autoTxt}${pressureTxt ? `, and ${pressureTxt}` : ''}.`;
    } else {
      band = 'ok';
      reason = `${cap(autoTxt)}${pressureTxt ? `, and ${pressureTxt}` : ''}. ` +
        `Strong is under ${t.strongAutoPerSessionBelow} per session and under ${t.strongPressurePctBelow}% of sessions.`;
    }
  }
  return {
    id: 'context',
    name: 'Context hygiene',
    judged: true,
    enoughData,
    band,
    trend: enoughData ? trend : null,
    signals,
    reason,
    tip: band ? TIPS.context[band] : NOT_ENOUGH_DATA_TIP,
    rule:
      `Strong: under ${t.strongAutoPerSessionBelow} auto-compactions per session and under ${t.strongPressurePctBelow}% of ` +
      `sessions reaching 80%+ full. Needs work: over ${t.weakAutoPerSessionAbove} per session, or over ` +
      `${t.weakPressurePctAbove}% of sessions 80%+ full. Judged from ${THRESHOLDS.minSessions}+ sessions.`,
    note: cur.statuslineSessions >= THRESHOLDS.minStatuslineSessions
      ? undefined
      : 'Context fill and cache figures need the Claude Code status line, so this rests on compactions alone.',
  };
}

function delegation(cur: CraftMetrics, prev: CraftMetrics | null): SkillView {
  const t = THRESHOLDS.delegation;
  const enoughData = cur.activitySessions >= THRESHOLDS.minSessions;
  const prevOk = prev && prev.activitySessions >= THRESHOLDS.minSessions ? prev : null;
  const { signals, trend } = buildSignals([
    { label: 'Sessions using subagents', format: 'pct', pick: (m) => m.delegationPct, better: 'up', counts: true },
  ], cur, prevOk);

  let band: Band | null = null;
  let reason: string | null = null;
  if (enoughData) {
    const pct = cur.delegationPct ?? 0;
    const avg = cur.avgPromptsPerSession ?? 0;
    const deep = avg >= t.weakNeedsAvgPromptsAtLeast;
    const pctTxt = `${Math.round(pct)}% of your sessions used a subagent`;
    if (pct >= t.strongPctAtLeast) {
      band = 'strong';
      reason = `${pctTxt}.`;
    } else if (pct < t.weakPctBelow && deep) {
      band = 'needs-work';
      reason = `Only ${pctTxt}, though sessions average ${avg.toFixed(1)} prompts.`;
    } else {
      band = 'ok';
      reason = `${cap(pctTxt)}. Strong starts at ${t.strongPctAtLeast}%.`;
    }
  }
  return {
    id: 'delegation',
    name: 'Delegation',
    judged: true,
    enoughData,
    band,
    trend: enoughData ? trend : null,
    signals,
    reason,
    tip: band ? TIPS.delegation[band] : NOT_ENOUGH_DATA_TIP,
    rule:
      `Strong: ${t.strongPctAtLeast}%+ of sessions use a subagent. Needs work: under ${t.weakPctBelow}%, and only when ` +
      `sessions average ${t.weakNeedsAvgPromptsAtLeast}+ prompts (short sessions rarely need one). ` +
      `Judged from ${THRESHOLDS.minSessions}+ sessions.`,
  };
}

function flow(cur: CraftMetrics, prev: CraftMetrics | null): SkillView {
  const t = THRESHOLDS.flow;
  const enoughData = cur.engagedMs >= THRESHOLDS.minEngagedMs;
  const prevOk = prev && prev.engagedMs >= THRESHOLDS.minEngagedMs ? prev : null;
  const { signals, trend } = buildSignals([
    { label: 'Time waiting on you', format: 'pct', pick: (m) => m.waitPct, better: 'down', counts: true },
    { label: 'Average wait', format: 'duration', pick: (m) => m.avgWaitMs, better: 'down', counts: false },
  ], cur, prevOk);

  let band: Band | null = null;
  let reason: string | null = null;
  if (enoughData) {
    const wait = cur.waitPct ?? 0;
    const waitTxt = `Agents spent ${Math.round(wait)}% of their active time waiting on you`;
    if (wait > t.weakWaitPctAbove) {
      band = 'needs-work';
      reason = `${waitTxt}. Above ${t.weakWaitPctAbove}% counts as needs work.`;
    } else if (wait < t.strongWaitPctBelow) {
      band = 'strong';
      reason = `${waitTxt}.`;
    } else {
      band = 'ok';
      reason = `${waitTxt}. Strong is under ${t.strongWaitPctBelow}%.`;
    }
  }
  return {
    id: 'flow',
    name: 'Flow',
    judged: true,
    enoughData,
    band,
    trend: enoughData ? trend : null,
    signals,
    reason,
    tip: band ? TIPS.flow[band] : NOT_ENOUGH_DATA_TIP,
    rule:
      `Share of agents' engaged time spent blocked on a permission or question from you. Strong: under ` +
      `${t.strongWaitPctBelow}%. Needs work: over ${t.weakWaitPctAbove}%. Judged from 30+ minutes of agent activity.`,
    note: cur.waitEpisodes === 0 && enoughData
      ? 'No waits recorded. Either none happened or your agents don\'t report them.'
      : undefined,
  };
}

function shape(cur: CraftMetrics, prev: CraftMetrics | null): SkillView {
  const t = THRESHOLDS.shape;
  const enoughData = cur.sessions >= THRESHOLDS.minSessions;
  const prevOk = prev && prev.sessions >= THRESHOLDS.minSessions ? prev : null;
  // Neither direction is "better" for session shape, so its signals never trend.
  const { signals } = buildSignals([
    { label: 'One-prompt sessions', format: 'pct', pick: (m) => m.oneShotPct, better: null, counts: false },
    { label: 'Prompts / session', format: 'prompts', pick: (m) => m.avgPromptsPerSession, better: null, counts: false },
    { label: 'Think time', format: 'duration', pick: (m) => m.medianThinkMs, better: null, counts: false },
  ], cur, prevOk);

  let tip = NOT_ENOUGH_DATA_TIP;
  if (enoughData) {
    if ((cur.oneShotPct ?? 0) > t.oneShotHeavyPctAbove) tip = SHAPE_TIPS.oneShotHeavy;
    else if ((cur.avgPromptsPerSession ?? 0) > t.longSessionAvgPromptsAbove) tip = SHAPE_TIPS.long;
    else tip = SHAPE_TIPS.balanced;
  }
  return {
    id: 'shape',
    name: 'Session shape',
    judged: false,
    enoughData,
    band: null,
    trend: null,
    signals,
    reason: null,
    tip,
    rule: 'How your sessions are shaped. Not rated: whether a one-prompt or a long session is right depends on the task.',
  };
}

export function evaluateCraft(payload: CraftPayload): SkillView[] {
  const { current, previous } = payload;
  return [
    clarity(current, previous),
    context(current, previous),
    delegation(current, previous),
    flow(current, previous),
    shape(current, previous),
  ];
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Focus + ordering (the scorecard layout) ─────────────────────────────────

const BAND_RANK: Record<Band, number> = { 'needs-work': 0, ok: 1, strong: 2 };
const TREND_RANK: Record<Trend, number> = { worse: 0, steady: 1, better: 2 };

function skillRank(s: SkillView): number {
  if (!s.judged) return 5;
  if (!s.enoughData || !s.band) return 4;
  return BAND_RANK[s.band];
}

/** Tile order: needs work, OK, strong, then not enough data, then unrated. Stable within a group. */
export function sortSkills(skills: SkillView[]): SkillView[] {
  return skills
    .map((s, i) => ({ s, i }))
    .sort((a, b) => skillRank(a.s) - skillRank(b.s) || a.i - b.i)
    .map(({ s }) => s);
}

/**
 * The one skill to work on first: the lowest band, and within it the one
 * slipping most. An OK skill only qualifies when nothing needs work and it is
 * not improving. null when everything rated is strong or improving.
 */
export function pickFocus(skills: SkillView[]): SkillView | null {
  const rated = skills.filter((s) => s.judged && s.enoughData && s.band && s.band !== 'strong');
  const weak = rated.filter((s) => s.band === 'needs-work');
  const candidates = weak.length > 0 ? weak : rated.filter((s) => s.trend !== 'better');
  if (candidates.length === 0) return null;
  return candidates
    .map((s, i) => ({ s, i }))
    .sort((a, b) => TREND_RANK[a.s.trend ?? 'steady'] - TREND_RANK[b.s.trend ?? 'steady'] || a.i - b.i)[0].s;
}

// ─── Correlation ─────────────────────────────────────────────────────────────

/**
 * One sentence comparing sessions by how they opened, or null when either
 * group is too small or the difference too slight to mention. Worded as an
 * association, never a cause.
 */
export function correlationInsight(c: CraftCorrelation): string | null {
  const { minSessionsPerGroup, minRatio } = THRESHOLDS.correlation;
  if (c.shortSessions < minSessionsPerGroup || c.detailedSessions < minSessionsPerGroup) return null;
  if (c.shortAvgPrompts === null || c.detailedAvgPrompts === null) return null;
  if (c.shortAvgPrompts <= 0 || c.detailedAvgPrompts <= 0) return null;
  const ratio = c.shortAvgPrompts / c.detailedAvgPrompts;
  if (ratio >= minRatio) {
    return `Sessions that opened with a short prompt (${c.shortMaxWords} words or fewer) took ${ratio.toFixed(1)}× as many prompts as ones that opened with ${c.detailedMinWords}+ words.`;
  }
  if (1 / ratio >= minRatio) {
    return `Sessions that opened with a detailed prompt (${c.detailedMinWords}+ words) ran ${(1 / ratio).toFixed(1)}× as many prompts as ones that opened short, likely because they were bigger tasks.`;
  }
  return null;
}

// ─── Top insights (Overview) ─────────────────────────────────────────────────

export interface CraftInsight {
  skill: SkillId;
  kind: 'needs-work' | 'slipped' | 'improved';
  title: string;
  detail: string;
}

/**
 * Up to `max` headline insights: skills that need work first, then skills
 * that slipped against the previous period, then ones that improved. One per
 * skill; informational skills never appear.
 */
export function topInsights(skills: SkillView[], max = 3): CraftInsight[] {
  const judged = skills.filter((s) => s.judged && s.enoughData);
  const out: CraftInsight[] = [];
  const seen = new Set<SkillId>();
  const push = (s: SkillView, kind: CraftInsight['kind'], title: string, detail: string) => {
    if (out.length >= max || seen.has(s.id)) return;
    seen.add(s.id);
    out.push({ skill: s.id, kind, title, detail });
  };
  for (const s of judged) if (s.band === 'needs-work') push(s, 'needs-work', `${s.name} needs work`, s.tip);
  for (const s of judged) if (s.trend === 'worse') push(s, 'slipped', `${s.name} slipped`, s.tip);
  for (const s of judged) if (s.trend === 'better') push(s, 'improved', `${s.name} improved`, 'Better than your previous period. Keep it up.');
  return out;
}

import { describe, it, expect } from 'vitest';
import { CraftCorrelation, CraftMetrics, CraftPayload } from '../../../../../../common/timeline-types';
import {
  NOT_ENOUGH_DATA_TIP,
  THRESHOLDS,
  TIPS,
  combineTrends,
  correlationInsight,
  evaluateCraft,
  pickFocus,
  signalTrend,
  sortSkills,
  topInsights,
  SkillView,
} from '../craftModel';

// A healthy, comfortably-sampled window. Tests override single fields.
function metrics(over: Partial<CraftMetrics> = {}): CraftMetrics {
  return {
    prompts: 100,
    medianWords: 30,
    shortPromptPct: 20,
    openedSessions: 20,
    detailedOpenerPct: 40,
    sessions: 20,
    oneShotPct: 30,
    avgPromptsPerSession: 6,
    medianThinkMs: 40_000,
    activitySessions: 20,
    autoCompactions: 0,
    autoCompactionsPerSession: 0,
    statuslineSessions: 10,
    highPressurePct: 5,
    avgCacheHitRatio: 0.9,
    sessionsWithSubagents: 6,
    delegationPct: 30,
    waitEpisodes: 10,
    waitMs: 60_000,
    engagedMs: 3 * 60 * 60 * 1000,
    waitPct: 2,
    avgWaitMs: 6_000,
    ...over,
  };
}

const noCorrelation: CraftCorrelation = {
  shortMaxWords: 15, detailedMinWords: 40, shortSessions: 0, detailedSessions: 0,
  shortAvgPrompts: null, detailedAvgPrompts: null,
};

function payload(current: CraftMetrics, previous: CraftMetrics | null = null): CraftPayload {
  return { range: '30d', current, previous, correlation: noCorrelation, promptAgents: ['claude-code'], queriedAt: 0 };
}

const skill = (skills: SkillView[], id: SkillView['id']) => skills.find((s) => s.id === id)!;

describe('signalTrend', () => {
  it('reads direction against the "better" side', () => {
    expect(signalTrend(30, 20, 'up', 'words')).toBe('better');
    expect(signalTrend(10, 20, 'up', 'words')).toBe('worse');
    expect(signalTrend(10, 20, 'down', 'pct')).toBe('better');
    expect(signalTrend(30, 20, 'down', 'pct')).toBe('worse');
  });

  it('is steady under a 10% relative change', () => {
    expect(signalTrend(21.9, 20, 'up', 'words')).toBe('steady');
    expect(signalTrend(22, 20, 'up', 'words')).toBe('better');
  });

  it('needs 2 percentage points before a pct moves', () => {
    expect(signalTrend(2.5, 2, 'down', 'pct')).toBe('steady');   // +25% relative, +0.5pt
    expect(signalTrend(4, 2, 'down', 'pct')).toBe('worse');
  });

  it('handles a zero baseline and missing values', () => {
    expect(signalTrend(0, 0, 'up', 'perSession')).toBe('steady');
    expect(signalTrend(0.2, 0, 'down', 'perSession')).toBe('worse');
    expect(signalTrend(null, 5, 'up', 'pct')).toBeNull();
    expect(signalTrend(5, null, 'up', 'pct')).toBeNull();
  });
});

describe('combineTrends', () => {
  it('takes the majority, ties are steady, nothing comparable is null', () => {
    expect(combineTrends(['better', 'better', 'worse'])).toBe('better');
    expect(combineTrends(['better', 'worse'])).toBe('steady');
    expect(combineTrends(['worse', null])).toBe('worse');
    expect(combineTrends([null, null])).toBeNull();
    expect(combineTrends([])).toBeNull();
  });
});

describe('evaluateCraft — bands', () => {
  it('rates a healthy window strong across the judged skills and never rates session shape', () => {
    const skills = evaluateCraft(payload(metrics()));
    expect(skills.map((s) => [s.id, s.band])).toEqual([
      ['clarity', 'strong'], ['context', 'strong'], ['delegation', 'strong'], ['flow', 'strong'], ['shape', null],
    ]);
    expect(skill(skills, 'shape').judged).toBe(false);
    expect(skill(skills, 'clarity').tip).toBe(TIPS.clarity.strong);
  });

  it('clarity boundaries', () => {
    const band = (o: Partial<CraftMetrics>) => skill(evaluateCraft(payload(metrics(o))), 'clarity').band;
    expect(band({ shortPromptPct: 50.1 })).toBe('needs-work');
    expect(band({ shortPromptPct: 50 })).toBe('ok');
    expect(band({ medianWords: 7.9 })).toBe('needs-work');
    expect(band({ medianWords: 8 })).toBe('ok');
    expect(band({ shortPromptPct: 25 })).toBe('ok');      // strong needs < 25
    expect(band({ medianWords: 19 })).toBe('ok');         // strong needs ≥ 20
  });

  it('context: auto-compactions alone can fail it; pressure only counts with enough status-line sessions', () => {
    const band = (o: Partial<CraftMetrics>) => skill(evaluateCraft(payload(metrics(o))), 'context').band;
    expect(band({ autoCompactionsPerSession: 0.31 })).toBe('needs-work');
    expect(band({ highPressurePct: 31 })).toBe('needs-work');
    expect(band({ highPressurePct: 31, statuslineSessions: 4 })).toBe('strong');  // pressure ignored
    expect(band({ highPressurePct: 10 })).toBe('ok');
    expect(band({ autoCompactionsPerSession: 0.05 })).toBe('ok');
    const view = skill(evaluateCraft(payload(metrics({ statuslineSessions: 0, highPressurePct: null }))), 'context');
    expect(view.note).toMatch(/compactions alone/);
  });

  it('delegation is only "needs work" when sessions are deep enough to need it', () => {
    const band = (o: Partial<CraftMetrics>) => skill(evaluateCraft(payload(metrics(o))), 'delegation').band;
    expect(band({ delegationPct: 20 })).toBe('strong');
    expect(band({ delegationPct: 19 })).toBe('ok');
    expect(band({ delegationPct: 2, avgPromptsPerSession: 6 })).toBe('needs-work');
    expect(band({ delegationPct: 2, avgPromptsPerSession: 3 })).toBe('ok');
  });

  it('flow boundaries, and a note when no waits were recorded', () => {
    const band = (o: Partial<CraftMetrics>) => skill(evaluateCraft(payload(metrics(o))), 'flow').band;
    expect(band({ waitPct: 4.9 })).toBe('strong');
    expect(band({ waitPct: 5 })).toBe('ok');
    expect(band({ waitPct: 20 })).toBe('ok');
    expect(band({ waitPct: 20.1 })).toBe('needs-work');
    const view = skill(evaluateCraft(payload(metrics({ waitEpisodes: 0, waitMs: 0, waitPct: 0 }))), 'flow');
    expect(view.note).toMatch(/No waits recorded/);
  });

  it('withholds a band below the minimum sample', () => {
    const skills = evaluateCraft(payload(metrics({
      prompts: THRESHOLDS.minPrompts - 1,
      activitySessions: THRESHOLDS.minSessions - 1,
      engagedMs: THRESHOLDS.minEngagedMs - 1,
      sessions: THRESHOLDS.minSessions - 1,
    })));
    for (const s of skills) {
      expect(s.enoughData).toBe(false);
      expect(s.band).toBeNull();
      expect(s.trend).toBeNull();
      expect(s.tip).toBe(NOT_ENOUGH_DATA_TIP);
    }
  });
});

describe('evaluateCraft — trends', () => {
  it('compares with the previous period when both meet the sample', () => {
    const prev = metrics({ medianWords: 12, detailedOpenerPct: 20 });
    const skills = evaluateCraft(payload(metrics(), prev));
    const clarity = skill(skills, 'clarity');
    expect(clarity.trend).toBe('better');
    expect(clarity.signals.map((s) => s.trend)).toEqual(['better', 'better']);
  });

  it('shows no trend when the previous period is too thin, or absent (1y)', () => {
    const thin = metrics({ prompts: 3, medianWords: 2, shortPromptPct: 90 });
    expect(skill(evaluateCraft(payload(metrics(), thin)), 'clarity').trend).toBeNull();
    expect(skill(evaluateCraft(payload(metrics(), null)), 'clarity').trend).toBeNull();
  });

  it('never trends session shape, and cache hit is shown but not counted', () => {
    const prev = metrics({ oneShotPct: 90, avgCacheHitRatio: 0.1 });
    const skills = evaluateCraft(payload(metrics(), prev));
    expect(skill(skills, 'shape').signals.every((s) => s.trend === null)).toBe(true);
    const context = skill(skills, 'context');
    expect(context.signals.find((s) => s.label === 'Prompt cache hit')!.trend).toBe('better');
    expect(context.trend).toBe('steady');   // the counted signals didn't move
  });

  it('arrows follow the number, colour follows good or bad', () => {
    // More auto-compactions than before: the number went UP, and that is worse.
    const prev = metrics({ autoCompactionsPerSession: 0.1 });
    const context = skill(evaluateCraft(payload(metrics({ autoCompactionsPerSession: 0.34 }), prev)), 'context');
    const auto = context.signals.find((s) => s.label === 'Auto-compactions / session')!;
    expect(auto.direction).toBe('up');
    expect(auto.trend).toBe('worse');
    // Fewer: down and better.
    const prev2 = metrics({ autoCompactionsPerSession: 0.5 });
    const auto2 = skill(evaluateCraft(payload(metrics({ autoCompactionsPerSession: 0.2 }), prev2)), 'context')
      .signals.find((s) => s.label === 'Auto-compactions / session')!;
    expect(auto2.direction).toBe('down');
    expect(auto2.trend).toBe('better');
    // Steady is flat; no previous period is null.
    expect(skill(evaluateCraft(payload(metrics(), metrics())), 'clarity').signals[0].direction).toBe('flat');
    expect(skill(evaluateCraft(payload(metrics())), 'clarity').signals[0].direction).toBeNull();
  });

  it('picks the session-shape tip from its dominant signal', () => {
    expect(skill(evaluateCraft(payload(metrics({ oneShotPct: 70 }))), 'shape').tip).toMatch(/single prompt/);
    expect(skill(evaluateCraft(payload(metrics({ avgPromptsPerSession: 20 }))), 'shape').tip).toMatch(/run long/);
    expect(skill(evaluateCraft(payload(metrics())), 'shape').tip).toMatch(/healthy/);
  });
});

describe('correlationInsight', () => {
  const corr = (o: Partial<CraftCorrelation>): CraftCorrelation => ({
    ...noCorrelation, shortSessions: 8, detailedSessions: 8, shortAvgPrompts: 6, detailedAvgPrompts: 3, ...o,
  });

  it('reports a short-opener gap as an association, never a cause', () => {
    const text = correlationInsight(corr({}))!;
    expect(text).toMatch(/2\.0× as many prompts/);
    expect(text).not.toMatch(/caus/i);
  });

  it('reports the reverse direction too', () => {
    expect(correlationInsight(corr({ shortAvgPrompts: 2, detailedAvgPrompts: 5 }))).toMatch(/detailed prompt.*2\.5×/);
  });

  it('stays quiet for small groups or a slight difference', () => {
    expect(correlationInsight(corr({ shortSessions: 4 }))).toBeNull();
    expect(correlationInsight(corr({ detailedSessions: 4 }))).toBeNull();
    expect(correlationInsight(corr({ shortAvgPrompts: 3.8, detailedAvgPrompts: 3 }))).toBeNull(); // 1.27×
    expect(correlationInsight(corr({ shortAvgPrompts: null }))).toBeNull();
  });
});

describe('topInsights', () => {
  it('orders needs-work, then slipped, then improved, one per skill, capped', () => {
    const prev = metrics({ waitPct: 15, delegationPct: 10 });
    const cur = metrics({ shortPromptPct: 70, waitPct: 2, delegationPct: 30 });
    // clarity needs work; flow improved (15 → 2); delegation improved (10 → 30).
    const insights = topInsights(evaluateCraft(payload(cur, metrics({ ...prev, shortPromptPct: 20 }))));
    expect(insights.map((i) => [i.skill, i.kind])).toEqual([
      ['clarity', 'needs-work'], ['delegation', 'improved'], ['flow', 'improved'],
    ]);
    expect(topInsights(evaluateCraft(payload(cur, prev)), 1)).toHaveLength(1);
  });

  it('puts a slipped skill ahead of improvements', () => {
    const prev = metrics({ delegationPct: 40, waitPct: 15 });
    const insights = topInsights(evaluateCraft(payload(metrics({ delegationPct: 21, waitPct: 2 }), prev)));
    expect(insights.map((i) => [i.skill, i.kind])).toEqual([['delegation', 'slipped'], ['flow', 'improved']]);
  });

  it('is empty when nothing is judged', () => {
    const thin = metrics({ prompts: 0, activitySessions: 0, engagedMs: 0, sessions: 0 });
    expect(topInsights(evaluateCraft(payload(thin)))).toEqual([]);
  });
});

describe('reasons', () => {
  it('names the number that decided the band', () => {
    const skills = evaluateCraft(payload(metrics({ shortPromptPct: 52, medianWords: 10, autoCompactionsPerSession: 0.34 })));
    expect(skill(skills, 'clarity').reason).toBe('52% of your prompts are 10 words or fewer. Above 50% counts as needs work.');
    expect(skill(skills, 'context').reason).toBe('0.34 auto-compactions per session. Above 0.3 counts as needs work.');
    expect(skill(skills, 'flow').reason).toMatch(/^Agents spent 2% of their active time waiting on you\.$/);
    expect(skill(skills, 'shape').reason).toBeNull();
  });

  it('has no reason without enough data', () => {
    expect(skill(evaluateCraft(payload(metrics({ prompts: 3 }))), 'clarity').reason).toBeNull();
  });
});

describe('pickFocus + sortSkills', () => {
  it('focuses the needs-work skill that is slipping most', () => {
    const prev = metrics({ shortPromptPct: 52, medianWords: 10, autoCompactionsPerSession: 0.1 });
    const cur = metrics({ shortPromptPct: 52, medianWords: 10, autoCompactionsPerSession: 0.34 });
    // Both need work; context slipped (more compactions), clarity held steady.
    expect(pickFocus(evaluateCraft(payload(cur, prev)))!.id).toBe('context');
    // Without a previous period, the first needs-work skill wins.
    expect(pickFocus(evaluateCraft(payload(cur)))!.id).toBe('clarity');
  });

  it('falls back to an OK skill that is not improving, and is null when all is strong', () => {
    expect(pickFocus(evaluateCraft(payload(metrics())))).toBeNull();
    const ok = metrics({ delegationPct: 10 });
    expect(pickFocus(evaluateCraft(payload(ok)))!.id).toBe('delegation');
    const improving = metrics({ delegationPct: 10 });
    expect(pickFocus(evaluateCraft(payload(improving, metrics({ delegationPct: 6 }))))).toBeNull();
  });

  it('orders tiles needs-work, OK, strong, not enough data, unrated', () => {
    const cur = metrics({ shortPromptPct: 52, delegationPct: 10, engagedMs: 0 });
    expect(sortSkills(evaluateCraft(payload(cur))).map((s) => s.id))
      .toEqual(['clarity', 'delegation', 'context', 'flow', 'shape']);
  });
});

import { describe, it, expect } from 'vitest';
import { ActivityFact } from '../activity-facts';
import { openTimelineDb, TimelineDb, EventRow } from '../db';
import { TimelineQueries } from '../queries';

// better-sqlite3 is built for Electron's ABI, so it may not load under plain
// Node — skip cleanly, same as the other query suites.
const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PREV = NOW - 10 * DAY; // inside the previous 7d window for every source

let seq = 0;
function fact(db: TimelineDb, over: Partial<ActivityFact> & Pick<ActivityFact, 'kind'>) {
  db.insertActivityFacts([{
    key: `c${seq++}`, ts: NOW - HOUR, toolId: 'claude-code', sessionId: 's1', ...over,
  } as ActivityFact]);
}

function ev(db: TimelineDb, row: Partial<EventRow> & Pick<EventRow, 'state' | 'timestamp' | 'sessionId'>) {
  db.insertEvent({ toolId: 'claude-code', ...row } as EventRow);
}

describe.skipIf(!dbAvailable)('TimelineQueries — getCraft', () => {
  it('aggregates every craft signal for the current window', () => {
    const db = openTimelineDb(':memory:')!;
    // Prompts: 4 with words (two ≤10), one image-only (ignored for words).
    for (const words of [5, 10, 30, 60]) fact(db, { kind: 'prompt', words });
    fact(db, { kind: 'prompt', words: 0 });
    // Activity sessions: s1, s2, s3, s4 (claude-code). s2 compacted (auto + manual), s3 used a subagent.
    fact(db, { kind: 'compaction', sessionId: 's2', trigger: 'auto' });
    fact(db, { kind: 'compaction', sessionId: 's2', trigger: 'manual' });
    fact(db, { kind: 'subagent', sessionId: 's3' });
    fact(db, { kind: 'edit', sessionId: 's4', linesAdded: 1, linesRemoved: 0 });

    // Events: session e1 has 3 turn starts (gaps 30s, 60s), e2 has 1.
    const base = NOW - 3 * HOUR;
    ev(db, { state: 'working', timestamp: base, sessionId: 'e1' });
    ev(db, { state: 'idle-active', timestamp: base + 5_000, sessionId: 'e1' });
    ev(db, { state: 'working', timestamp: base + 30_000, sessionId: 'e1' });
    ev(db, { state: 'waiting', timestamp: base + 40_000, sessionId: 'e1' });   // 20s wait
    ev(db, { state: 'idle-active', timestamp: base + 60_000, sessionId: 'e1' });
    ev(db, { state: 'working', timestamp: base + 90_000, sessionId: 'e1' });
    ev(db, { state: 'idle-active', timestamp: base + 100_000, sessionId: 'e1' });
    ev(db, { state: 'working', timestamp: base, sessionId: 'e2' });
    ev(db, { state: 'idle-active', timestamp: base + 10_000, sessionId: 'e2' });

    // Statusline: two sessions, one reached 80%+ (peak fill counts; cache hit uses the latest sample).
    db.insertStatuslineSample({ sessionId: 'x1', sampledAt: NOW - 2 * HOUR, contextUsedPct: 95, cacheHitRatio: 0.2 });
    db.insertStatuslineSample({ sessionId: 'x1', sampledAt: NOW - HOUR, contextUsedPct: 85, cacheHitRatio: 0.8 });
    db.insertStatuslineSample({ sessionId: 'x2', sampledAt: NOW - HOUR, contextUsedPct: 40, cacheHitRatio: 0.6 });

    const q = new TimelineQueries(db);
    const out = q.getCraft('7d');
    const c = out.current;

    expect(c.prompts).toBe(4);
    expect(c.medianWords).toBe(20);                 // 5,10,30,60
    expect(c.shortPromptPct).toBe(50);

    expect(c.sessions).toBe(2);
    expect(c.oneShotPct).toBe(50);
    expect(c.avgPromptsPerSession).toBe(2);
    expect(c.medianThinkMs).toBe(45_000);           // gaps 30s, 60s

    expect(c.activitySessions).toBe(4);
    expect(c.autoCompactions).toBe(1);
    expect(c.autoCompactionsPerSession).toBe(0.25);
    expect(c.statuslineSessions).toBe(2);
    expect(c.highPressurePct).toBe(50);
    expect(c.avgCacheHitRatio).toBeCloseTo(0.7);

    expect(c.sessionsWithSubagents).toBe(1);
    expect(c.delegationPct).toBe(25);

    expect(c.waitEpisodes).toBe(1);
    expect(c.waitMs).toBe(20_000);
    expect(c.engagedMs).toBeGreaterThan(c.waitMs);
    expect(c.waitPct).toBeCloseTo((20_000 / c.engagedMs) * 100);
    expect(c.avgWaitMs).toBe(20_000);

    expect(out.promptAgents).toEqual(['claude-code']);

    // Same definitions as the drill-down cards.
    expect(c.medianWords).toBe(q.getPromptSize('7d').medianWords);
    expect(c.medianThinkMs).toBe(q.getCadence('7d').overallMedianThinkMs);
    expect(c.waitMs).toBe(q.getWaiting('7d').totalWaitMs);
    expect(c.sessionsWithSubagents).toBe(q.getSubagentUse('7d').sessionsWithSubagents);
    expect(c.activitySessions).toBe(q.getCompactions('7d').sessions);
    expect(c.statuslineSessions).toBe(q.getContextPressure('7d').rows.length);
    db.close();
  });

  it('reads the previous window separately and keeps the two apart', () => {
    const db = openTimelineDb(':memory:')!;
    fact(db, { kind: 'prompt', words: 50 });
    for (const words of [3, 4]) fact(db, { kind: 'prompt', words, ts: PREV, sessionId: 'old' });
    fact(db, { kind: 'subagent', ts: PREV, sessionId: 'old' });
    fact(db, { kind: 'prompt', words: 999, ts: NOW - 40 * DAY, sessionId: 'ancient' }); // in neither
    ev(db, { state: 'working', timestamp: PREV, sessionId: 'p1' });
    ev(db, { state: 'working', timestamp: NOW - HOUR, sessionId: 'c1' });
    db.insertStatuslineSample({ sessionId: 'old-x', sampledAt: PREV, contextUsedPct: 90 });

    const out = new TimelineQueries(db).getCraft('7d');
    expect(out.current.prompts).toBe(1);
    expect(out.current.medianWords).toBe(50);
    expect(out.current.sessionsWithSubagents).toBe(0);
    expect(out.current.sessions).toBe(1);
    expect(out.current.statuslineSessions).toBe(0);

    expect(out.previous).not.toBeNull();
    expect(out.previous!.prompts).toBe(2);
    expect(out.previous!.medianWords).toBe(3.5);
    expect(out.previous!.sessionsWithSubagents).toBe(1);
    expect(out.previous!.sessions).toBe(1);
    expect(out.previous!.statuslineSessions).toBe(1);
    expect(out.previous!.highPressurePct).toBe(100);
    db.close();
  });

  it('has no previous period for 1y, and null ratios when nothing was recorded', () => {
    const db = openTimelineDb(':memory:')!;
    const out = new TimelineQueries(db).getCraft('1y');
    expect(out.previous).toBeNull();
    expect(out.current).toMatchObject({
      prompts: 0, shortPromptPct: null, sessions: 0, oneShotPct: null, avgPromptsPerSession: null,
      medianThinkMs: null, autoCompactionsPerSession: null, highPressurePct: null, avgCacheHitRatio: null,
      delegationPct: null, waitPct: null, avgWaitMs: null,
    });
    expect(out.promptAgents).toEqual([]);
    db.close();
  });

  it('correlation: groups sessions by opener length, skipping image openers and sessions begun before the window', () => {
    const db = openTimelineDb(':memory:')!;
    const t0 = NOW - 5 * HOUR;
    // short opener (≤15) → 3 prompts
    fact(db, { kind: 'prompt', sessionId: 'a', ts: t0, words: 6 });
    fact(db, { kind: 'prompt', sessionId: 'a', ts: t0 + 1000, words: 20 });
    fact(db, { kind: 'prompt', sessionId: 'a', ts: t0 + 2000, words: 4 });
    // detailed opener (≥40) → 1 prompt
    fact(db, { kind: 'prompt', sessionId: 'b', ts: t0, words: 80 });
    // middle opener (16–39) → neither group
    fact(db, { kind: 'prompt', sessionId: 'c', ts: t0, words: 25 });
    // image-only opener → skipped
    fact(db, { kind: 'prompt', sessionId: 'd', ts: t0, words: 0 });
    fact(db, { kind: 'prompt', sessionId: 'd', ts: t0 + 1000, words: 5 });
    // began before the 7d window → excluded even though later prompts are inside
    fact(db, { kind: 'prompt', sessionId: 'e', ts: NOW - 20 * DAY, words: 5 });
    fact(db, { kind: 'prompt', sessionId: 'e', ts: t0, words: 5 });

    const out = new TimelineQueries(db).getCraft('7d');
    // Same openers feed the per-window share: a, b, c opened with words (d image, e too early).
    expect(out.current.openedSessions).toBe(3);
    expect(out.current.detailedOpenerPct).toBeCloseTo(100 / 3);
    const c = out.correlation;
    expect(c).toEqual({
      shortMaxWords: 15,
      detailedMinWords: 40,
      shortSessions: 1,
      detailedSessions: 1,
      shortAvgPrompts: 3,
      detailedAvgPrompts: 1,
    });
    db.close();
  });

  it('context pressure counts the peak fill, so a session that compacted after running full still counts', () => {
    const db = openTimelineDb(':memory:')!;
    // y1 ran to 92%, auto-compacted, and ended at 20%: it reached 80%.
    db.insertStatuslineSample({ sessionId: 'y1', sampledAt: NOW - 3 * HOUR, contextUsedPct: 92 });
    db.insertStatuslineSample({ sessionId: 'y1', sampledAt: NOW - 2 * HOUR, contextUsedPct: 20 });
    // y2 never got past 40%.
    db.insertStatuslineSample({ sessionId: 'y2', sampledAt: NOW - 2 * HOUR, contextUsedPct: 40 });
    const c = new TimelineQueries(db).getCraft('7d').current;
    expect(c.statuslineSessions).toBe(2);
    expect(c.highPressurePct).toBe(50);
    db.close();
  });
});

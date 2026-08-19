import { describe, it, expect } from 'vitest';
import { openTimelineDb, TimelineDb, EventRow, SessionRow } from '../db';
import { TimelineQueries } from '../queries';

// better-sqlite3 is rebuilt against Electron's ABI (`npm run rebuild:native`),
// so it may not load under vitest's plain Node. Skip the suite cleanly (same
// pattern as the backlog store tests) instead of failing.
const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();
const BASE = NOW - 3 * 60 * 60 * 1000; // 3h ago — comfortably inside every range

function freshDb(): TimelineDb {
  return openTimelineDb(':memory:')!;
}

function ev(db: TimelineDb, row: Partial<EventRow> & Pick<EventRow, 'toolId' | 'state' | 'timestamp' | 'sessionId'>) {
  db.insertEvent({ ...row } as EventRow);
}

function sess(db: TimelineDb, row: Partial<SessionRow> & Pick<SessionRow, 'toolId' | 'startedAt' | 'endedAt' | 'sessionId'>) {
  db.insertSession({ turns: 1, peakState: 'working', hadError: 0, ...row } as SessionRow);
}

describe.skipIf(!dbAvailable)('TimelineQueries — native-session analytics', () => {
  it('getCadence: computes capped think-time, depth, and per-tool rows', () => {
    const db = freshDb();
    // s1: turn starts at BASE, +30s, +90s → gaps 30s, 60s (both under 5m cap).
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE,        sessionId: 's1' });
    ev(db, { toolId: 'claude-code', state: 'idle-active', timestamp: BASE + 5_000, sessionId: 's1' });
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE + 30_000, sessionId: 's1' });
    ev(db, { toolId: 'claude-code', state: 'idle-active', timestamp: BASE + 35_000, sessionId: 's1' });
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE + 90_000, sessionId: 's1' });
    // s2: turn starts at BASE, +10m → single gap of 10m, ABOVE the cap → excluded.
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE,          sessionId: 's2' });
    ev(db, { toolId: 'claude-code', state: 'idle-active', timestamp: BASE + 5_000,  sessionId: 's2' });
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE + 600_000, sessionId: 's2' });

    const out = new TimelineQueries(db).getCadence('7d');

    // Only s1's two gaps feed the think-time stat; s2's 10m gap is capped out.
    expect(out.thinkSampleCount).toBe(2);
    expect(out.overallMedianThinkMs).toBe(45_000); // median of [30s, 60s]
    expect(out.overallAvgPromptsPerSession).toBe(2.5); // (3 + 2) / 2
    expect(out.depth.find((d) => d.bucket === '2-3')?.count).toBe(2);

    const row = out.rows.find((r) => r.toolId === 'claude-code')!;
    expect(row.sessions).toBe(2);
    expect(row.medianThinkMs).toBe(45_000);
    db.close();
  });

  it('getWaiting: sums capped waiting spans and flags tools with no blocked state', () => {
    const db = freshDb();
    // claude-code: one waiting span of 30s inside an otherwise-active session.
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE,          sessionId: 's3' });
    ev(db, { toolId: 'claude-code', state: 'waiting',     timestamp: BASE + 10_000, sessionId: 's3' });
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE + 40_000, sessionId: 's3' });
    ev(db, { toolId: 'claude-code', state: 'idle-active', timestamp: BASE + 50_000, sessionId: 's3' });
    // cursor: active but never blocked → hasData=false.
    ev(db, { toolId: 'cursor', state: 'working',     timestamp: BASE,          sessionId: 's4' });
    ev(db, { toolId: 'cursor', state: 'idle-active', timestamp: BASE + 20_000, sessionId: 's4' });

    const out = new TimelineQueries(db).getWaiting('7d');

    const cc = out.rows.find((r) => r.toolId === 'claude-code')!;
    expect(cc.waitMs).toBe(30_000);
    expect(cc.episodes).toBe(1);
    expect(cc.avgWaitMs).toBe(30_000);
    // active = work(10s) + wait(30s) + work(10s) = 50s → 30/50 = 60%.
    expect(cc.pctOfActive).toBeCloseTo(60, 5);
    expect(cc.hasData).toBe(true);

    const cur = out.rows.find((r) => r.toolId === 'cursor')!;
    expect(cur.hasData).toBe(false);
    expect(cur.waitMs).toBe(0);

    expect(out.totalWaitMs).toBe(30_000);
    expect(out.totalEpisodes).toBe(1);
    db.close();
  });

  it('getCacheEfficiency: hit ratio + estimated savings, no-data flagged', () => {
    const db = freshDb();
    // claude-code / opus: 1k fresh input + 10k cache-read.
    ev(db, { toolId: 'claude-code', state: 'working', timestamp: BASE, sessionId: 's5', model: 'claude-opus-4-8', tokensIn: 1000, cacheRead: 9000 });
    ev(db, { toolId: 'claude-code', state: 'working', timestamp: BASE + 1000, sessionId: 's5', model: 'claude-opus-4-8', tokensIn: 0, cacheRead: 1000 });
    // cursor: no token/model data → hasData=false.
    ev(db, { toolId: 'cursor', state: 'working', timestamp: BASE, sessionId: 's6' });

    const out = new TimelineQueries(db).getCacheEfficiency('7d');

    const cc = out.rows.find((r) => r.toolId === 'claude-code')!;
    expect(cc.freshTokens).toBe(1000);
    expect(cc.cachedTokens).toBe(10000);
    expect(cc.hitRatio).toBeCloseTo(10000 / 11000, 6);
    expect(cc.priced).toBe(true);
    // saved = 10000 * (input 5 - cacheRead 0.5) / 1e6 = 0.045
    expect(cc.savedUsd).toBeCloseTo(0.045, 6);

    const cur = out.rows.find((r) => r.toolId === 'cursor')!;
    expect(cur.hasData).toBe(false);

    expect(out.overallHitRatio).toBeCloseTo(10000 / 11000, 6);
    expect(out.totalSavedUsd).toBeCloseTo(0.045, 6);
    db.close();
  });

  it('getLifecycle: detects a resume at the 1h boundary and ties active time to the rollup', () => {
    const db = freshDb();
    // s7: activity, then a 2h gap (a resume), then more activity.
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE,              sessionId: 's7' });
    ev(db, { toolId: 'claude-code', state: 'idle-active', timestamp: BASE + 60_000,     sessionId: 's7' });
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE + 7_200_000,  sessionId: 's7' }); // +2h → resume
    // s8: no gap ≥ 1h.
    ev(db, { toolId: 'claude-code', state: 'working',     timestamp: BASE,          sessionId: 's8' });
    ev(db, { toolId: 'claude-code', state: 'idle-active', timestamp: BASE + 120_000, sessionId: 's8' });
    // Active-time rollup rows (span-vs-active density reads these).
    sess(db, { toolId: 'claude-code', sessionId: 's7', startedAt: BASE, endedAt: BASE + 60_000 });
    sess(db, { toolId: 'claude-code', sessionId: 's8', startedAt: BASE, endedAt: BASE + 120_000 });

    const out = new TimelineQueries(db).getLifecycle('7d');

    expect(out.totalSessions).toBe(2);
    expect(out.resumedSessions).toBe(1);
    expect(out.resumeRatePct).toBe(50);
    expect(out.avgResumesPerSession).toBe(0.5);
    expect(out.medianResumeIntervalMs).toBe(7_140_000); // 2h - 60s
    expect(out.avgActiveMs).toBe(90_000);               // (60s + 120s) / 2
    db.close();
  });
});

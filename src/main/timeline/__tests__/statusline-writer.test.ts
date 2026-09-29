import { describe, it, expect } from 'vitest';
import { openTimelineDb, TimelineDb } from '../db';
import { TimelineQueries } from '../queries';
import { StatuslineWriter } from '../statusline-writer';
import { StatusLineFeedSnapshot } from '../../bridge/statusline';

const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();
const MIN = 60_000;

function freshDb(): TimelineDb {
  return openTimelineDb(':memory:')!;
}

function snap(over: Partial<StatusLineFeedSnapshot> & Pick<StatusLineFeedSnapshot, 'sessionId' | 'receivedAt'>): StatusLineFeedSnapshot {
  return {
    model: 'claude-opus-5',
    costUsd: 0.5,
    contextUsedPct: 40,
    cache: { warm: true, hitRatio: 0.9, misses: 1 },
    ...over,
  };
}

function countRows(db: TimelineDb): number {
  return (db.query<{ n: number }>('SELECT COUNT(*) AS n FROM statusline_samples')[0]?.n) ?? 0;
}

describe.skipIf(!dbAvailable)('StatuslineWriter', () => {
  it('throttles to one row per session per minute, per session', () => {
    const db = freshDb();
    const writer = new StatuslineWriter(db);

    writer.onSnapshot(snap({ sessionId: 's1', receivedAt: NOW }));
    writer.onSnapshot(snap({ sessionId: 's1', receivedAt: NOW + 300 }));       // throttled
    writer.onSnapshot(snap({ sessionId: 's2', receivedAt: NOW + 400 }));       // other session passes
    writer.onSnapshot(snap({ sessionId: 's1', receivedAt: NOW + MIN + 1 }));   // interval elapsed

    expect(countRows(db)).toBe(3);
    db.close();
  });

  it('skips snapshots with nothing chartable', () => {
    const db = freshDb();
    const writer = new StatuslineWriter(db);
    writer.onSnapshot({ sessionId: 's1', receivedAt: NOW }); // bare ping
    expect(countRows(db)).toBe(0);
    db.close();
  });
});

describe.skipIf(!dbAvailable)('TimelineQueries — statusline analytics', () => {
  it('getCacheHealth aggregates latest-per-session and buckets by day', () => {
    const db = freshDb();
    const writer = new StatuslineWriter(db);
    // s1: two samples, latest wins (hitRatio 0.8, cold, 3 misses).
    writer.onSnapshot(snap({ sessionId: 's1', receivedAt: NOW - 3 * MIN, cache: { warm: true, hitRatio: 0.6, misses: 1 } }));
    writer.onSnapshot(snap({ sessionId: 's1', receivedAt: NOW - MIN, cache: { warm: false, hitRatio: 0.8, misses: 3 } }));
    // s2: one warm sample at ratio 1.0.
    writer.onSnapshot(snap({ sessionId: 's2', receivedAt: NOW, cache: { warm: true, hitRatio: 1.0, misses: 0 } }));

    const out = new TimelineQueries(db).getCacheHealth('7d');
    expect(out.sessions).toBe(2);
    expect(out.avgHitRatio).toBeCloseTo(0.9);      // (0.8 + 1.0) / 2, latest per session
    expect(out.warmPct).toBeCloseTo(50);           // s1 cold, s2 warm
    expect(out.totalMisses).toBe(3);               // latest-per-session sum
    expect(out.rows[0].sessionId).toBe('s2');      // most recent first
    expect(out.byDay).toHaveLength(7);
    // All 3 samples land today; day average spans every sample, not just latest.
    const today = out.byDay[out.byDay.length - 1];
    expect(today.samples).toBe(3);
    expect(today.avgHitRatio).toBeCloseTo((0.6 + 0.8 + 1.0) / 3);
    db.close();
  });

  it('getContextPressure reports latest-per-session pressure and flags ≥80%', () => {
    const db = freshDb();
    const writer = new StatuslineWriter(db);
    writer.onSnapshot(snap({ sessionId: 's1', receivedAt: NOW - 3 * MIN, contextUsedPct: 30 }));
    writer.onSnapshot(snap({ sessionId: 's1', receivedAt: NOW - MIN, contextUsedPct: 85 })); // latest wins
    writer.onSnapshot(snap({ sessionId: 's2', receivedAt: NOW, contextUsedPct: 20 }));

    const out = new TimelineQueries(db).getContextPressure('7d');
    expect(out.rows).toHaveLength(2);
    expect(out.avgUsedPct).toBeCloseTo((85 + 20) / 2);
    expect(out.maxUsedPct).toBe(85);
    expect(out.highPressureSessions).toBe(1);
    const today = out.byDay[out.byDay.length - 1];
    expect(today.maxUsedPct).toBe(85);
    db.close();
  });

  it('returns clean empty payloads with no samples', () => {
    const db = freshDb();
    const q = new TimelineQueries(db);
    const cache = q.getCacheHealth('7d');
    expect(cache.sessions).toBe(0);
    expect(cache.avgHitRatio).toBeNull();
    const ctx = q.getContextPressure('7d');
    expect(ctx.rows).toEqual([]);
    expect(ctx.maxUsedPct).toBeNull();
    db.close();
  });
});

import { describe, it, expect } from 'vitest';
import { openTimelineDb, TimelineDb, SessionRow } from '../db';
import { TimelineQueries } from '../queries';

const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function freshDb(): TimelineDb {
  return openTimelineDb(':memory:')!;
}

function sess(db: TimelineDb, row: Partial<SessionRow> & Pick<SessionRow, 'startedAt'>) {
  db.insertSession({
    toolId: 'claude-code', turns: 1, peakState: 'working', hadError: 0,
    endedAt: row.startedAt + 60_000, ...row,
  } as SessionRow);
}

describe.skipIf(!dbAvailable)('TimelineQueries.getLifetimeTokens', () => {
  it('returns zeros and a null first-session date on an empty database', () => {
    const db = freshDb();
    const out = new TimelineQueries(db).getLifetimeTokens();
    expect(out).toMatchObject({
      tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0,
      totalTokens: 0, costUsd: 0, sessions: 0, firstSessionAt: null,
    });
    db.close();
  });

  it('sums every session regardless of age, including ones older than any range', () => {
    const db = freshDb();
    // 3 years old — far beyond the 1y range and the 365-day events retention.
    sess(db, { startedAt: NOW - 1100 * DAY, totalTokensIn: 100, totalTokensOut: 10, totalCacheRead: 1000, totalCacheWrite: 50 });
    sess(db, { startedAt: NOW - 2 * DAY,    totalTokensIn: 200, totalTokensOut: 20, totalCacheRead: 2000, totalCacheWrite: 60 });
    // A session with no token data still counts as a session.
    sess(db, { startedAt: NOW - 1 * DAY });

    const out = new TimelineQueries(db).getLifetimeTokens();
    expect(out.tokensIn).toBe(300);
    expect(out.tokensOut).toBe(30);
    expect(out.cacheRead).toBe(3000);
    expect(out.cacheWrite).toBe(110);
    expect(out.totalTokens).toBe(3440);
    expect(out.sessions).toBe(3);
    expect(out.firstSessionAt).toBe(NOW - 1100 * DAY);
    db.close();
  });

  it('prices grouped totals the same as the per-session summary does', () => {
    const db = freshDb();
    const tokens = { totalTokensIn: 1_000_000, totalTokensOut: 200_000, totalCacheRead: 5_000_000, totalCacheWrite: 300_000 };
    sess(db, { startedAt: NOW - 3 * DAY, modelsUsed: 'claude-sonnet-4-5', ...tokens });
    sess(db, { startedAt: NOW - 2 * DAY, modelsUsed: 'claude-sonnet-4-5', ...tokens });
    sess(db, { startedAt: NOW - 1 * DAY, modelsUsed: 'claude-opus-4-5',   ...tokens });

    const q = new TimelineQueries(db);
    const lifetime = q.getLifetimeTokens();
    expect(lifetime.costUsd).toBeGreaterThan(0);
    // All three sessions fall inside 7d, so the row-by-row summary is the oracle.
    expect(lifetime.costUsd).toBeCloseTo(q.getSummary('7d').current.costUsd, 6);
    db.close();
  });
});

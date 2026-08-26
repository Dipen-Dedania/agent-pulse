import { describe, it, expect } from 'vitest';
import { openTimelineDb, TimelineDb, LimitEventRow } from '../db';
import { TimelineQueries } from '../queries';
import { maybeBackfillLimitEvents } from '../limit-backfill';

const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function freshDb(): TimelineDb {
  return openTimelineDb(':memory:')!;
}

function hit(db: TimelineDb, row: Partial<LimitEventRow> & Pick<LimitEventRow, 'uuid' | 'ts'>) {
  db.insertLimitEvent({ toolId: 'claude-code', kind: 'session', ...row } as LimitEventRow);
}

describe.skipIf(!dbAvailable)('TimelineQueries.getLimitHits', () => {
  it('counts hits in the window, splits by kind, and reports the last hit', () => {
    const db = freshDb();
    hit(db, { uuid: 'a', ts: NOW - 2 * DAY, kind: 'session' });
    hit(db, { uuid: 'b', ts: NOW - 1 * DAY, kind: 'session' });
    hit(db, { uuid: 'c', ts: NOW - 1 * DAY, kind: 'weekly' });
    // 40 days ago — outside a 7d window but still the count's history.
    hit(db, { uuid: 'old', ts: NOW - 40 * DAY, kind: 'session' });

    const out = new TimelineQueries(db).getLimitHits('7d');
    expect(out.total).toBe(3);
    expect(out.byKind).toEqual([
      { kind: 'session', count: 2 },
      { kind: 'weekly', count: 1 },
    ]);
    // byDay spans exactly the 7-day inclusive window, gap-free.
    expect(out.byDay).toHaveLength(7);
    expect(out.byDay.reduce((s, b) => s + b.count, 0)).toBe(3);
    // lastHitAt is the most recent across ALL history (the 1-day-ago rows).
    expect(out.lastHitAt).toBe(NOW - 1 * DAY);
    db.close();
  });

  it('is empty (but reports lastHitAt) when the window has no hits', () => {
    const db = freshDb();
    hit(db, { uuid: 'old', ts: NOW - 40 * DAY });
    const out = new TimelineQueries(db).getLimitHits('7d');
    expect(out.total).toBe(0);
    expect(out.byKind).toEqual([]);
    expect(out.lastHitAt).toBe(NOW - 40 * DAY);
    db.close();
  });

  it('insertLimitEvent dedups on uuid (OR IGNORE) so backfill + live reads never double-count', () => {
    const db = freshDb();
    hit(db, { uuid: 'dup', ts: NOW - DAY });
    hit(db, { uuid: 'dup', ts: NOW - DAY }); // same message seen twice
    expect(new TimelineQueries(db).getLimitHits('7d').total).toBe(1);
    db.close();
  });

  it('backfill marker makes maybeBackfillLimitEvents run at most once', () => {
    const db = freshDb();
    expect(db.getMeta('limit_backfill_done')).toBeNull();
    maybeBackfillLimitEvents(db); // scans transcripts (none in test env) → sets marker
    const marker = db.getMeta('limit_backfill_done');
    expect(marker).not.toBeNull();
    // Second call is a no-op guarded by the marker (marker unchanged).
    maybeBackfillLimitEvents(db);
    expect(db.getMeta('limit_backfill_done')).toBe(marker);
    db.close();
  });
});

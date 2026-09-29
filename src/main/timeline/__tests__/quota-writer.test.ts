import { describe, it, expect } from 'vitest';
import { openTimelineDb, TimelineDb } from '../db';
import { QuotaWriter } from '../quota-writer';
import { UsageStatus, CodexUsageStatus } from '../../../common/types';

const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();
const MIN = 60_000;

function freshDb(): TimelineDb {
  return openTimelineDb(':memory:')!;
}

function claudeOk(lastUpdated: number, utilization = 25): UsageStatus {
  return {
    state: 'ok',
    lastUpdated,
    snapshot: {
      fiveHour: { utilization, resetsAt: NOW + 3_600_000 },
      sevenDay: { utilization: 10, resetsAt: NOW + 86_400_000 },
    },
  };
}

function codexOk(lastUpdated: number): CodexUsageStatus {
  return {
    state: 'ok',
    lastUpdated,
    snapshot: { primary: { utilization: 40, resetsAt: NOW + 3_600_000 } },
  };
}

function countRows(db: TimelineDb): number {
  return (db.query<{ n: number }>('SELECT COUNT(*) AS n FROM quota_samples')[0]?.n) ?? 0;
}

describe.skipIf(!dbAvailable)('QuotaWriter', () => {
  it('throttles inserts to one burst per tool per minute', () => {
    const db = freshDb();
    const writer = new QuotaWriter(db);

    writer.onClaudeUsage(claudeOk(NOW));            // 2 rows (5h + 7d)
    writer.onClaudeUsage(claudeOk(NOW + 300, 26));  // throttled despite changed data
    writer.onClaudeUsage(claudeOk(NOW + 15_000));   // still inside the floor
    expect(countRows(db)).toBe(2);

    writer.onClaudeUsage(claudeOk(NOW + MIN + 1));  // interval elapsed
    expect(countRows(db)).toBe(4);
    db.close();
  });

  it('does not write non-ok statuses', () => {
    const db = freshDb();
    const writer = new QuotaWriter(db);
    writer.onClaudeUsage({ state: 'unauthenticated' });
    writer.onClaudeUsage({ state: 'ok' }); // ok but no snapshot
    expect(countRows(db)).toBe(0);
    db.close();
  });

  it('gates per tool, not globally', () => {
    const db = freshDb();
    const writer = new QuotaWriter(db);
    writer.onClaudeUsage(claudeOk(NOW));
    writer.onCodexUsage(codexOk(NOW + 300)); // different tool — independent gate
    expect(countRows(db)).toBe(3);           // 2 claude + 1 codex primary
    db.close();
  });
});

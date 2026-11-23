import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { DiscoveredSource } from '../../../common/claude-commands';
import { openTimelineDb, TimelineDb } from '../db';
import { TimelineQueries } from '../queries';

// better-sqlite3 is built for Electron's ABI, so it may not load under plain
// Node — skip cleanly, same as the other query suites.
const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let seq = 0;
function use(db: TimelineDb, name: string, over: { ts?: number; sessionId?: string; entry?: string; times?: number } = {}) {
  const rows = [];
  for (let i = 0; i < (over.times ?? 1); i++) {
    rows.push({ key: `k${seq++}`, ts: over.ts ?? NOW - HOUR, sessionId: over.sessionId ?? 's1', name, entry: over.entry ?? 'typed' });
  }
  db.insertCommandUses(rows, false);
}

const discovered = new Map<string, DiscoveredSource>([['hard', 'custom'], ['brag', 'plugin']]);

describe.skipIf(!dbAvailable)('TimelineQueries — Claude Code slash commands', () => {
  it('counts typed commands, folds aliases and groups by category', () => {
    const db = openTimelineDb(':memory:')!;
    use(db, 'new', { times: 5 });
    use(db, 'clear', { times: 2, sessionId: 's2' });
    use(db, 'model', { times: 3 });
    use(db, 'hard');
    use(db, 'brag');
    use(db, 'anthropic-skills:repo-ready');
    use(db, 'install-release');
    use(db, 'nwq', { times: 2 });
    use(db, 'model', { ts: NOW - 40 * DAY });                       // outside 7d

    const out = new TimelineQueries(db).getClaudeCommands('7d', { discovered });
    expect(out.total).toBe(16);
    expect(out.distinct).toBe(7);
    expect(out.sessionsWithCommands).toBe(2);
    expect(out.byCategory).toEqual({ builtin: 10, custom: 1, plugin: 2, unknown: 3 });
    expect(out.top[0]).toEqual({
      canonical: 'clear', category: 'builtin', count: 7, inline: 0,
      aliases: [{ name: 'new', count: 5 }, { name: 'clear', count: 2 }],
    });
    expect(out.top[1]).toMatchObject({ canonical: 'model', count: 3 });
    expect(out.top.find((r) => r.canonical === 'hard')).toMatchObject({ category: 'custom', count: 1 });
    expect(out.top.find((r) => r.canonical === 'brag')).toMatchObject({ category: 'plugin', count: 1 });
    expect(out.unknown).toEqual([
      { name: 'nwq', count: 2, suggestion: 'new' },
      { name: 'install-release', count: 1, suggestion: null },
    ]);
    expect(out.available).toBe(true);
    db.close();
  });

  it('keeps inline mentions out of the totals and out of the unknown list', () => {
    const db = openTimelineDb(':memory:')!;
    use(db, 'hard');
    use(db, 'hard', { entry: 'inline', times: 15 });
    use(db, 'brag', { entry: 'inline', times: 2 });                 // mentioned, never typed
    use(db, 'gone', { entry: 'inline', times: 4 });                 // skill since uninstalled

    const out = new TimelineQueries(db).getClaudeCommands('7d', { discovered });
    expect(out.total).toBe(1);
    expect(out.distinct).toBe(1);
    expect(out.top).toEqual([
      { canonical: 'hard', category: 'custom', count: 1, inline: 15, aliases: [{ name: 'hard', count: 1 }] },
      { canonical: 'brag', category: 'plugin', count: 0, inline: 2, aliases: [] },
    ]);
    expect(out.unknown).toEqual([]);
    db.close();
  });

  it('reclassifies stored names when the discovered set changes', () => {
    const db = openTimelineDb(':memory:')!;
    use(db, 'hard');
    const q = new TimelineQueries(db);
    expect(q.getClaudeCommands('7d').top[0].category).toBe('unknown');
    expect(q.getClaudeCommands('7d', { discovered }).top[0].category).toBe('custom');
    db.close();
  });

  it('compares against the previous period only when history covers it', () => {
    const db = openTimelineDb(':memory:')!;
    use(db, 'model', { times: 4 });
    use(db, 'model', { ts: NOW - 9 * DAY, times: 3 });              // previous 7d window
    const q = new TimelineQueries(db);
    // History starts 9 days ago, inside the previous window: no fair comparison.
    expect(q.getClaudeCommands('7d').previousTotal).toBeNull();

    use(db, 'exit', { ts: NOW - 20 * DAY });
    use(db, 'hard', { ts: NOW - 10 * DAY, entry: 'inline' });       // inline: not part of the total
    const out = q.getClaudeCommands('7d');
    expect(out.previousTotal).toBe(3);
    expect(out.firstRecordedAt).toBe(NOW - 20 * DAY);
    expect(q.getClaudeCommands('1y').previousTotal).toBeNull();
    db.close();
  });

  it('lists discovery commands never used in all kept history, whatever the range', () => {
    const db = openTimelineDb(':memory:')!;
    use(db, 'model');
    use(db, 'undo', { ts: NOW - 200 * DAY });                       // alias of rewind, outside 7d
    const q = new TimelineQueries(db);
    expect(q.getClaudeCommands('7d').neverUsed).toEqual(['context']);
    use(db, 'context', { ts: NOW - 100 * DAY });
    expect(q.getClaudeCommands('7d').neverUsed).toEqual([]);
    db.close();
  });

  it('empty table: zeros, no tips to give, and the availability passed in', () => {
    const db = openTimelineDb(':memory:')!;
    const out = new TimelineQueries(db).getClaudeCommands('30d', { available: false });
    expect(out).toMatchObject({
      available: false, firstRecordedAt: null, total: 0, distinct: 0, sessionsWithCommands: 0,
      previousTotal: null, top: [], unknown: [], neverUsed: [],
    });
    db.close();
  });

  it('insertCommandUses dedups on key and can replace everything', () => {
    const db = openTimelineDb(':memory:')!;
    const row = { key: 'cc:h:1:s1:model', ts: NOW, sessionId: 's1', name: 'model', entry: 'typed' };
    expect(db.insertCommandUses([row, row], false)).toBe(1);
    expect(db.insertCommandUses([row], false)).toBe(0);
    expect(db.insertCommandUses([{ ...row, key: 'cc:h:2:s1:new', name: 'new' }], true)).toBe(1);
    expect(db.query<{ name: string }>('SELECT name FROM command_uses')).toEqual([{ name: 'new' }]);
    expect(db.insertCommandUses([], true)).toBe(0);
    expect(db.query('SELECT name FROM command_uses')).toEqual([]);
    db.close();
  });

  it('prunes command uses on the events cutoff', () => {
    const db = openTimelineDb(':memory:')!;
    use(db, 'old', { ts: NOW - 400 * DAY });
    use(db, 'model');
    db.prune(NOW - 365 * DAY, 0, 0, 0);
    expect(db.query<{ name: string }>('SELECT name FROM command_uses')).toEqual([{ name: 'model' }]);
    db.close();
  });

  it('command sessions never reach the activity session counts', () => {
    const db = openTimelineDb(':memory:')!;
    db.insertActivityFacts([{ key: 'p1', ts: NOW - HOUR, toolId: 'claude-code', sessionId: 's1', kind: 'prompt', words: 5 }]);
    use(db, 'model', { sessionId: 'only-commands', times: 3 });
    const out = new TimelineQueries(db).getSubagentUse('7d');
    expect(out.sessions).toBe(1);
    db.close();
  });

  it('a v8 database opens as v9 with the new table and its data intact', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-migrate-v9-')), 'timeline.db');
    try {
      const v8 = openTimelineDb(file)!;
      v8.raw.exec('DROP TABLE command_uses; UPDATE schema_version SET version = 8;');
      v8.insertEvent({ toolId: 'claude-code', state: 'working', timestamp: 5, sessionId: 's1' });
      v8.insertActivityFacts([{ key: 'p1', ts: 5, toolId: 'claude-code', sessionId: 's1', kind: 'prompt', words: 3 }]);
      v8.saveActivityOffset({ path: 'C:\\x.jsonl', offset: 7, updatedAt: 5 });
      v8.close();

      const db = openTimelineDb(file)!;
      expect(db.query<{ version: number }>('SELECT version FROM schema_version')[0].version).toBe(9);
      expect(db.query<{ n: number }>('SELECT COUNT(*) AS n FROM events')[0].n).toBe(1);
      expect(db.query<{ n: number }>('SELECT COUNT(*) AS n FROM activity_facts')[0].n).toBe(1);
      expect(db.loadActivityOffsets().map((r) => r.path)).toEqual(['C:\\x.jsonl']);
      expect(db.insertCommandUses([{ key: 'k', ts: 1, sessionId: 's1', name: 'model', entry: 'typed' }], false)).toBe(1);
      db.close();
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});

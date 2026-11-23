import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityFact } from '../activity-facts';
import { ActivitySink, ActivitySync, ActivitySyncOptions, listClaudeSubagentFiles } from '../activity-sync';
import { openTimelineDb } from '../db';

const TS = '2026-11-19T10:00:00.000Z';

// In-memory sink that dedups on key, like the real table.
function memorySink() {
  const facts = new Map<string, ActivityFact>();
  const offsets = new Map<string, { path: string; offset: number; context?: string | null; updatedAt?: number | null }>();
  const state = { failInserts: false };
  const sink: ActivitySink = {
    insertActivityFacts: (rows) => {
      if (state.failInserts) return null;
      let n = 0;
      for (const r of rows) if (!facts.has(r.key)) { facts.set(r.key, r); n++; }
      return n;
    },
    loadActivityOffsets: () => Array.from(offsets.values()),
    saveActivityOffset: (row) => { offsets.set(row.path, row); },
  };
  return { sink, facts, offsets, state };
}

// A sync whose deferred work and timers are driven by the test.
function harness(opts: ActivitySyncOptions = {}) {
  const mem = memorySink();
  const queue: Array<() => void> = [];
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const clock = { now: 1_000_000 };
  const sync = new ActivitySync(mem.sink, {
    defer: (fn) => { queue.push(fn); },
    setTimer: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true; }; },
    now: () => clock.now,
    ...opts,
  });
  const tick = () => { const fn = queue.shift(); if (fn) fn(); return fn !== undefined; };
  const drain = () => { let n = 0; while (tick()) n++; return n; };
  return { ...mem, sync, queue, timers, clock, tick, drain };
}

const prompt = (uuid: string, text: string) =>
  JSON.stringify({ type: 'user', uuid, timestamp: TS, sessionId: 's1', promptSource: 'typed', message: { content: text } }) + '\n';
const codexMeta = (payload: Record<string, unknown>) => JSON.stringify({ timestamp: TS, type: 'session_meta', payload }) + '\n';
const codexMsg = (id: string) => JSON.stringify({
  timestamp: TS, type: 'event_msg',
  payload: { type: 'item_completed', completed_at_ms: 1, item: { type: 'UserMessage', id, content: [{ type: 'text', text: 'hello there' }] } },
}) + '\n';

describe('ActivitySync — reading', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-activity-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('reads a file once, then only its new tail', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'first prompt') + prompt('b', 'second one here'));
    const { sync, facts } = harness();

    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(2);
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(0);
    fs.appendFileSync(file, prompt('c', 'third'));
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(1);
    expect(Array.from(facts.values()).map((f) => f.words)).toEqual([2, 3, 1]);
  });

  it('leaves a half-written last line for the next read', () => {
    const file = path.join(dir, 's1.jsonl');
    const second = prompt('b', 'second prompt');
    fs.writeFileSync(file, prompt('a', 'first') + second.slice(0, 40));
    const { sync, facts } = harness();

    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(1);
    fs.appendFileSync(file, second.slice(40));
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(1);
    expect(facts.size).toBe(2);
  });

  it('keeps the offset exact across multi-byte characters', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'héllo wörld ✓'));
    const { sync, facts } = harness();
    sync.syncFile(file, 'claude-code', 's1');
    fs.appendFileSync(file, prompt('b', 'next'));
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(1);
    expect(facts.get('cc:p:b')?.words).toBe(1);
  });

  it('resumes from persisted offsets after a restart, with the Codex thread context', () => {
    const file = path.join(dir, 'rollout-x-th1.jsonl');
    fs.writeFileSync(file, codexMeta({ id: 'th1', session_id: 'th1', thread_source: 'user' }) + codexMsg('m1'));
    const mem = memorySink();
    expect(new ActivitySync(mem.sink).syncFile(file, 'openai-codex', 'th1')).toBe(1);

    // New process: the tail has no session_meta, so the context must come from the store.
    fs.appendFileSync(file, codexMsg('m2'));
    expect(new ActivitySync(mem.sink).syncFile(file, 'openai-codex', 'th1')).toBe(1);
    expect(Array.from(mem.facts.keys())).toEqual(['cx:p:th1:m1', 'cx:p:th1:m2']);
  });

  it('re-reads a replaced (shorter) file without double counting', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'one') + prompt('b', 'two words'));
    const { sync, facts } = harness();
    sync.syncFile(file, 'claude-code', 's1');
    fs.writeFileSync(file, prompt('a', 'one'));
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(0);
    expect(facts.size).toBe(2);
  });

  it('does not advance past lines whose facts failed to store', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'first prompt'));
    const { sync, facts, offsets, state } = harness();

    state.failInserts = true; // database locked / disk full
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(0);
    expect(offsets.size).toBe(0);

    state.failInserts = false;
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(1);
    expect(facts.has('cc:p:a')).toBe(true);
  });

  it('reads one chunk per step and reports when more remains', () => {
    const file = path.join(dir, 's1.jsonl');
    const lines = Array.from({ length: 6 }, (_, i) => prompt('p' + i, 'some words here'));
    fs.writeFileSync(file, lines.join(''));
    const { sync, facts } = harness({ maxReadBytes: lines[0].length * 2 + 10 }); // ~2 lines per chunk

    expect(sync.syncStep(file, 'claude-code', 's1')).toEqual({ inserted: 2, more: true });
    expect(facts.size).toBe(2);
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(4); // the rest, to the end
    expect(sync.syncStep(file, 'claude-code', 's1')).toEqual({ inserted: 0, more: false });
  });

  it('skips a line longer than a chunk instead of stalling on it', () => {
    const file = path.join(dir, 's1.jsonl');
    const huge = JSON.stringify({ type: 'attachment', blob: 'x'.repeat(5000) }) + '\n';
    fs.writeFileSync(file, prompt('a', 'before it') + huge + prompt('b', 'after the big one'));
    const { sync, facts } = harness({ maxReadBytes: 1000 });

    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(2);
    expect(Array.from(facts.keys())).toEqual(['cc:p:a', 'cc:p:b']);
    expect(sync.syncStep(file, 'claude-code', 's1').more).toBe(false);
  });

  it('never throws on a missing file', () => {
    const { sync } = harness();
    expect(sync.syncFile(path.join(dir, 'nope.jsonl'), 'claude-code', 's1')).toBe(0);
  });

  it('stamps each saved offset so stale rows can be pruned', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'one'));
    const { sync, offsets, clock } = harness();
    clock.now = 4242;
    sync.syncFile(file, 'claude-code', 's1');
    expect(Array.from(offsets.values())[0].updatedAt).toBe(4242);
  });
});

describe('ActivitySync — live events', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-activity-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('does no file work in the caller’s tick, and one job per tick after', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'first prompt'));
    const h = harness();

    h.sync.onAgentEvent('claude-code', 's1', file);
    expect(h.facts.size).toBe(0);
    expect(h.offsets.size).toBe(0);
    h.tick();                      // the event job: locates files, reads nothing
    expect(h.facts.size).toBe(0);
    h.tick();                      // the file job
    expect(h.facts.size).toBe(1);
  });

  it('spreads a long first read over several ticks', () => {
    const file = path.join(dir, 's1.jsonl');
    const lines = Array.from({ length: 6 }, (_, i) => prompt('p' + i, 'some words here'));
    fs.writeFileSync(file, lines.join(''));
    const h = harness({ maxReadBytes: lines[0].length * 2 + 10 });

    h.sync.onAgentEvent('claude-code', 's1', file);
    h.tick();                      // event job
    h.tick();
    expect(h.facts.size).toBe(2);  // one chunk only
    h.drain();
    expect(h.facts.size).toBe(6);
  });

  it('ignores a relative transcript path and agents it does not read', () => {
    const h = harness();
    h.sync.onAgentEvent('claude-code', 's1', 's1.jsonl');
    h.sync.onAgentEvent('cursor', 's2', path.join(dir, 'x.jsonl'));
    h.drain();
    expect(h.offsets.size).toBe(0);
    expect(h.facts.size).toBe(0);
  });

  it('picks up a Claude Code session’s subagent transcripts', () => {
    const file = path.join(dir, 'sess-a.jsonl');
    const subDir = path.join(dir, 'sess-a', 'subagents');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(file, prompt('a', 'main prompt'));
    fs.writeFileSync(path.join(subDir, 'agent-1.jsonl'), JSON.stringify({
      type: 'user', uuid: 'sub-edit', timestamp: TS, sessionId: 'sess-a', isSidechain: true, agentId: 'a1',
      toolUseResult: { structuredPatch: [{ lines: ['+one', '+two', '-gone'] }] },
    }) + '\n');
    fs.writeFileSync(path.join(subDir, 'agent-1.meta.json'), '{}');

    expect(listClaudeSubagentFiles(file).map((f) => path.basename(f))).toEqual(['agent-1.jsonl']);

    const h = harness();
    h.sync.onAgentEvent('claude-code', 'sess-a', file);
    h.drain();
    expect(Array.from(h.facts.values()).map((f) => [f.key, f.kind, f.sessionId, f.linesAdded])).toEqual([
      ['cc:p:a', 'prompt', 's1', undefined],
      ['cc:e:sub-edit', 'edit', 'sess-a', 2],
    ]);
  });

  describe('Codex', () => {
    function codexTree() {
      const day = path.join(dir, '2026', '11', '19');
      fs.mkdirSync(day, { recursive: true });
      const parent = path.join(day, 'rollout-2026-11-19T10-00-00-th1.jsonl');
      const guardian = path.join(day, 'rollout-2026-11-19T10-01-00-g1.jsonl');
      fs.writeFileSync(parent, codexMeta({ id: 'th1', session_id: 'th1', thread_source: 'user' }));
      const review = (turn: string) =>
        JSON.stringify({ timestamp: TS, type: 'event_msg', payload: { type: 'task_started', turn_id: turn, started_at: 1 } }) + '\n';
      fs.writeFileSync(guardian,
        codexMeta({ id: 'g1', session_id: 'th1', thread_source: 'guardian_review', parent_thread_id: 'th1' }) + review('turn-1'));
      return { parent, guardian, review };
    }

    it('also reads sibling thread files nobody hooks', () => {
      const { parent } = codexTree();
      const h = harness({ codexSessionsDir: dir, resolveCodexRollout: () => parent });
      h.sync.onAgentEvent('openai-codex', 'th1');
      h.drain();
      expect(Array.from(h.facts.values()).map((f) => [f.key, f.kind])).toEqual([['cx:r:turn-1', 'auto_review']]);
    });

    it('sweeps again after the last event, catching what a session wrote at its end', () => {
      const { parent, guardian, review } = codexTree();
      const h = harness({ codexSessionsDir: dir, resolveCodexRollout: () => parent });
      h.sync.onAgentEvent('openai-codex', 'th1');
      h.drain();
      expect(h.facts.size).toBe(1);

      // A second event inside the sweep throttle, then the session's last review.
      h.clock.now += 5_000;
      h.sync.onAgentEvent('openai-codex', 'th1');
      h.drain();
      fs.appendFileSync(guardian, review('turn-2'));

      // Only the newest timer is live (each event re-arms it).
      const live = h.timers.filter((t) => !t.cancelled);
      expect(live).toHaveLength(1);
      expect(live[0].ms).toBe(90_000);
      live[0].fn();
      h.drain();
      expect(Array.from(h.facts.keys())).toEqual(['cx:r:turn-1', 'cx:r:turn-2']);
    });

    it('looks a missing rollout up again only after a pause', () => {
      let lookups = 0;
      const h = harness({ codexSessionsDir: dir, resolveCodexRollout: () => { lookups++; return null; } });
      for (let i = 0; i < 5; i++) { h.sync.onAgentEvent('openai-codex', 'th1'); h.drain(); }
      expect(lookups).toBe(1);
      h.clock.now += 31_000;
      h.sync.onAgentEvent('openai-codex', 'th1');
      h.drain();
      expect(lookups).toBe(2);
    });
  });

  it('dispose() drops queued work and timers, and later calls do nothing', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'first prompt'));
    const h = harness({ codexSessionsDir: dir, resolveCodexRollout: () => null });

    h.sync.onAgentEvent('claude-code', 's1', file);
    h.sync.onAgentEvent('openai-codex', 'th1');
    h.sync.dispose();
    h.drain();                                  // the already-scheduled tick fires against a closed store
    for (const t of h.timers) if (!t.cancelled) t.fn();
    h.drain();
    h.sync.onAgentEvent('claude-code', 's1', file);
    h.drain();

    expect(h.timers.every((t) => t.cancelled)).toBe(true);
    expect(h.facts.size).toBe(0);
    expect(h.offsets.size).toBe(0);
    expect(h.sync.syncFile(file, 'claude-code', 's1')).toBe(0);
  });
});

// The real table: dedup, round-trip, retention and the v7 → v8 reset.
const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

describe.skipIf(!dbAvailable)('activity tables', () => {
  const fact = (key: string, ts: number): ActivityFact =>
    ({ key, ts, toolId: 'claude-code', sessionId: 's1', kind: 'prompt', words: 5 });

  it('dedups on key and reports only new rows', () => {
    const db = openTimelineDb(':memory:')!;
    expect(db.insertActivityFacts([fact('a', 1000), fact('b', 2000)])).toBe(2);
    expect(db.insertActivityFacts([fact('a', 1000), fact('c', 3000)])).toBe(1);
    expect(db.insertActivityFacts([])).toBe(0);
    expect(db.query<{ n: number }>('SELECT COUNT(*) AS n FROM activity_facts')[0].n).toBe(3);
    expect(db.query('SELECT key, tool_id, session_id, kind, words, lines_added FROM activity_facts WHERE key = ?', ['a']))
      .toEqual([{ key: 'a', tool_id: 'claude-code', session_id: 's1', kind: 'prompt', words: 5, lines_added: null }]);
    db.close();
  });

  it('stores a compaction’s trigger and context size', () => {
    const db = openTimelineDb(':memory:')!;
    db.insertActivityFacts([{ key: 'c', ts: 1, toolId: 'claude-code', sessionId: 's1', kind: 'compaction', trigger: 'manual', tokensBefore: 142033, tokensAfter: 22010 }]);
    expect(db.query('SELECT trigger_kind, tokens_before, tokens_after FROM activity_facts'))
      .toEqual([{ trigger_kind: 'manual', tokens_before: 142033, tokens_after: 22010 }]);
    db.close();
  });

  it('reports a failed write as null, not as zero new rows', () => {
    const db = openTimelineDb(':memory:')!;
    db.close();
    expect(db.insertActivityFacts([fact('a', 1000)])).toBeNull();
  });

  it('round-trips offsets, and prunes facts and stale offsets with events', () => {
    const db = openTimelineDb(':memory:')!;
    db.saveActivityOffset({ path: 'C:\\x.jsonl', offset: 10, context: '{"threadId":"t"}', updatedAt: 9000 });
    db.saveActivityOffset({ path: 'C:\\x.jsonl', offset: 25, context: null, updatedAt: 9500 });
    db.saveActivityOffset({ path: 'C:\\old.jsonl', offset: 7, updatedAt: 1000 });
    expect(db.loadActivityOffsets()).toEqual([
      { path: 'C:\\x.jsonl', offset: 25, context: null, updatedAt: 9500 },
      { path: 'C:\\old.jsonl', offset: 7, context: null, updatedAt: 1000 },
    ]);

    db.insertActivityFacts([fact('old', 1000), fact('new', 9000)]);
    db.prune(5000, 0, 0, 0);
    expect(db.query<{ key: string }>('SELECT key FROM activity_facts').map((r) => r.key)).toEqual(['new']);
    expect(db.loadActivityOffsets().map((r) => r.path)).toEqual(['C:\\x.jsonl']);
    db.close();
  });

  it('a v7 database opens at the current version with the activity tables rebuilt and empty', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ap-migrate-')), 'timeline.db');
    try {
      // Build the v7 shape: current schema, then swap in the old activity tables with data.
      const v8 = openTimelineDb(file)!;
      v8.raw.exec(`
        DROP TABLE activity_facts; DROP TABLE activity_offsets;
        CREATE TABLE activity_facts (key TEXT PRIMARY KEY, ts INTEGER NOT NULL, tool_id TEXT NOT NULL, session_id TEXT,
          kind TEXT NOT NULL, tool_name TEXT, words INTEGER, lines_added INTEGER, lines_removed INTEGER);
        CREATE TABLE activity_offsets (path TEXT PRIMARY KEY, offset INTEGER NOT NULL, context TEXT);
        INSERT INTO activity_facts (key, ts, tool_id, kind, words) VALUES ('stale', 1, 'claude-code', 'prompt', 1243);
        INSERT INTO activity_offsets (path, offset) VALUES ('C:\\x.jsonl', 99);
        UPDATE schema_version SET version = 7;
      `);
      v8.insertEvent({ toolId: 'claude-code', state: 'working', timestamp: 5, sessionId: 's1' });
      v8.close();

      const db = openTimelineDb(file)!;
      expect(db.query<{ version: number }>('SELECT version FROM schema_version')[0].version).toBe(9);
      expect(db.query('SELECT * FROM activity_facts')).toEqual([]);
      expect(db.loadActivityOffsets()).toEqual([]);
      // New columns exist, and unrelated data survived.
      expect(db.insertActivityFacts([{ key: 'c', ts: 1, toolId: 'claude-code', kind: 'compaction', trigger: 'auto' }])).toBe(1);
      db.saveActivityOffset({ path: 'C:\\y.jsonl', offset: 1, updatedAt: 5 });
      expect(db.query<{ n: number }>('SELECT COUNT(*) AS n FROM events')[0].n).toBe(1);
      db.close();

      // Opening again must not wipe what was just written.
      const again = openTimelineDb(file)!;
      expect(again.query<{ n: number }>('SELECT COUNT(*) AS n FROM activity_facts')[0].n).toBe(1);
      again.close();
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});

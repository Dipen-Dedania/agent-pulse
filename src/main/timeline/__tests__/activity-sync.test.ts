import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityFact } from '../activity-facts';
import { ActivitySink, ActivitySync } from '../activity-sync';
import { openTimelineDb } from '../db';

const TS = '2026-11-19T10:00:00.000Z';

// In-memory sink that dedups on key, like the real table.
function memorySink() {
  const facts = new Map<string, ActivityFact>();
  const offsets = new Map<string, { path: string; offset: number; context?: string | null }>();
  const sink: ActivitySink = {
    insertActivityFacts: (rows) => {
      let n = 0;
      for (const r of rows) if (!facts.has(r.key)) { facts.set(r.key, r); n++; }
      return n;
    },
    loadActivityOffsets: () => Array.from(offsets.values()),
    saveActivityOffset: (row) => { offsets.set(row.path, row); },
  };
  return { sink, facts, offsets };
}

const prompt = (uuid: string, text: string) =>
  JSON.stringify({ type: 'user', uuid, timestamp: TS, sessionId: 's1', promptSource: 'typed', message: { content: text } }) + '\n';

describe('ActivitySync', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-activity-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('reads a file once, then only its new tail', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'first prompt') + prompt('b', 'second one here'));
    const { sink, facts } = memorySink();
    const sync = new ActivitySync(sink);

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
    const { sink, facts } = memorySink();
    const sync = new ActivitySync(sink);

    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(1);
    fs.appendFileSync(file, second.slice(40));
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(1);
    expect(facts.size).toBe(2);
  });

  it('keeps the offset exact across multi-byte characters', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'héllo wörld ✓'));
    const { sink, facts } = memorySink();
    const sync = new ActivitySync(sink);
    sync.syncFile(file, 'claude-code', 's1');
    fs.appendFileSync(file, prompt('b', 'next'));
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(1);
    expect(facts.get('cc:p:b')?.words).toBe(1);
  });

  it('resumes from persisted offsets after a restart, with the Codex thread context', () => {
    const file = path.join(dir, 'rollout-x-th1.jsonl');
    const meta = JSON.stringify({ timestamp: TS, type: 'session_meta', payload: { id: 'th1', session_id: 'th1', thread_source: 'user' } }) + '\n';
    const msg = (id: string) => JSON.stringify({
      timestamp: TS, type: 'event_msg',
      payload: { type: 'item_completed', completed_at_ms: 1, item: { type: 'UserMessage', id, content: [{ type: 'text', text: 'hello there' }] } },
    }) + '\n';
    fs.writeFileSync(file, meta + msg('m1'));
    const { sink, facts } = memorySink();
    expect(new ActivitySync(sink).syncFile(file, 'openai-codex', 'th1')).toBe(1);

    // New process: the tail has no session_meta, so the context must come from the store.
    fs.appendFileSync(file, msg('m2'));
    expect(new ActivitySync(sink).syncFile(file, 'openai-codex', 'th1')).toBe(1);
    expect(Array.from(facts.keys())).toEqual(['cx:p:th1:m1', 'cx:p:th1:m2']);
  });

  it('re-reads a replaced (shorter) file without double counting', () => {
    const file = path.join(dir, 's1.jsonl');
    fs.writeFileSync(file, prompt('a', 'one') + prompt('b', 'two words'));
    const { sink, facts } = memorySink();
    const sync = new ActivitySync(sink);
    sync.syncFile(file, 'claude-code', 's1');
    fs.writeFileSync(file, prompt('a', 'one'));
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(0);
    expect(facts.size).toBe(2);
  });

  it('on a Codex event, also picks up sibling thread files nobody hooks', () => {
    const day = path.join(dir, '2026', '11', '19');
    fs.mkdirSync(day, { recursive: true });
    const parent = path.join(day, 'rollout-2026-11-19T10-00-00-th1.jsonl');
    const guardian = path.join(day, 'rollout-2026-11-19T10-01-00-g1.jsonl');
    fs.writeFileSync(parent, JSON.stringify({ timestamp: TS, type: 'session_meta', payload: { id: 'th1', session_id: 'th1', thread_source: 'user' } }) + '\n');
    fs.writeFileSync(guardian,
      JSON.stringify({ timestamp: TS, type: 'session_meta', payload: { id: 'g1', session_id: 'th1', thread_source: 'guardian_review', parent_thread_id: 'th1' } }) + '\n' +
      JSON.stringify({ timestamp: TS, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-1', started_at: 1 } }) + '\n');

    const { sink, facts } = memorySink();
    const queue: Array<() => void> = [];
    const sync = new ActivitySync(sink, {
      codexSessionsDir: dir,
      resolveCodexRollout: () => parent,
      defer: (fn) => { queue.push(fn); },
    });
    sync.onAgentEvent('openai-codex', 'th1');
    while (queue.length > 0) queue.shift()!();
    expect(Array.from(facts.values()).map((f) => [f.key, f.kind])).toEqual([['cx:r:turn-1', 'auto_review']]);
  });

  it('reads a stretch longer than one chunk to the end in a single sync', () => {
    const file = path.join(dir, 's1.jsonl');
    const lines = Array.from({ length: 12 }, (_, i) => prompt('p' + i, 'some words here'));
    fs.writeFileSync(file, lines.join(''));
    const { sink, facts } = memorySink();
    // Each chunk holds roughly two lines.
    const sync = new ActivitySync(sink, { maxReadBytes: lines[0].length * 2 + 10 });
    expect(sync.syncFile(file, 'claude-code', 's1')).toBe(12);
    expect(facts.size).toBe(12);
  });

  it('never throws on a missing file', () => {
    const { sink } = memorySink();
    expect(new ActivitySync(sink).syncFile(path.join(dir, 'nope.jsonl'), 'claude-code', 's1')).toBe(0);
  });
});

// The real table: dedup, round-trip and retention.
const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

describe.skipIf(!dbAvailable)('activity_facts table', () => {
  const fact = (key: string, ts: number): ActivityFact =>
    ({ key, ts, toolId: 'claude-code', sessionId: 's1', kind: 'prompt', words: 5 });

  it('dedups on key and reports only new rows', () => {
    const db = openTimelineDb(':memory:')!;
    expect(db.insertActivityFacts([fact('a', 1000), fact('b', 2000)])).toBe(2);
    expect(db.insertActivityFacts([fact('a', 1000), fact('c', 3000)])).toBe(1);
    expect(db.query<{ n: number }>('SELECT COUNT(*) AS n FROM activity_facts')[0].n).toBe(3);
    expect(db.query('SELECT key, tool_id, session_id, kind, words, lines_added FROM activity_facts WHERE key = ?', ['a']))
      .toEqual([{ key: 'a', tool_id: 'claude-code', session_id: 's1', kind: 'prompt', words: 5, lines_added: null }]);
    db.close();
  });

  it('round-trips offsets and prunes with events', () => {
    const db = openTimelineDb(':memory:')!;
    db.saveActivityOffset({ path: 'C:\\x.jsonl', offset: 10, context: '{"threadId":"t"}' });
    db.saveActivityOffset({ path: 'C:\\x.jsonl', offset: 25, context: null });
    expect(db.loadActivityOffsets()).toEqual([{ path: 'C:\\x.jsonl', offset: 25, context: null }]);

    db.insertActivityFacts([fact('old', 1000), fact('new', 9000)]);
    db.prune(5000, 0, 0, 0);
    expect(db.query<{ key: string }>('SELECT key FROM activity_facts').map((r) => r.key)).toEqual(['new']);
    db.close();
  });
});

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIVITY_BACKFILL_MARKER, ActivityBackfillOptions, startActivityBackfill } from '../activity-backfill';

const DAY = 24 * 60 * 60 * 1000;

describe('startActivityBackfill', () => {
  let dir: string;
  let claudeDir: string;
  let codexDir: string;
  const claude = (...p: string[]) => path.join(claudeDir, 'E--proj', ...p);
  const codex = (name: string) => path.join(codexDir, '2026', '11', '19', name);
  const age = (file: string, days: number) => { const t = new Date(Date.now() - days * DAY); fs.utimesSync(file, t, t); };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-backfill-'));
    claudeDir = path.join(dir, 'projects');
    codexDir = path.join(dir, 'sessions');
    fs.mkdirSync(claude('sess-a', 'subagents'), { recursive: true });
    fs.mkdirSync(path.dirname(codex('x')), { recursive: true });
    fs.writeFileSync(claude('sess-a.jsonl'), '{}\n');
    fs.writeFileSync(claude('sess-b.jsonl'), '{}\n');
    fs.writeFileSync(claude('sess-a', 'subagents', 'agent-1.jsonl'), '{}\n');
    fs.writeFileSync(claude('sess-a', 'subagents', 'agent-1.meta.json'), '{}');
    fs.writeFileSync(codex('rollout-2026-11-19T10-00-00-th1.jsonl'), '{}\n');
    fs.writeFileSync(codex('notes.jsonl'), '{}\n'); // not a rollout
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function harness(extra: ActivityBackfillOptions = {}, moreFor: Record<string, number> = {}) {
    const store = new Map<string, string>();
    const meta = { getMeta: (k: string) => store.get(k) ?? null, setMeta: (k: string, v: string) => { store.set(k, v); } };
    const synced: Array<[string, string, string]> = [];
    const remaining = { ...moreFor };
    const sync = {
      syncStep: (p: string, toolId: string, sessionId: string) => {
        const name = path.basename(p);
        synced.push([name, toolId, sessionId]);
        const more = (remaining[name] ?? 0) > 0;
        if (more) remaining[name]--;
        return { inserted: 2, more };
      },
    };
    const queue: Array<() => void> = [];
    const schedule = (fn: () => void) => {
      queue.push(fn);
      return () => { const i = queue.indexOf(fn); if (i >= 0) queue.splice(i, 1); };
    };
    const done: Array<{ files: number; inserted: number; full: boolean }> = [];
    const opts: ActivityBackfillOptions = {
      claudeProjectsDir: claudeDir, codexSessionsDir: codexDir, schedule, onDone: (r) => done.push(r), ...extra,
    };
    const drain = () => { while (queue.length > 0) queue.shift()!(); };
    return { store, meta, synced, sync, queue, opts, drain, done };
  }

  it('first run: reads every session file, one step per tick, then sets the marker', () => {
    const h = harness();
    startActivityBackfill(h.meta, h.sync, h.opts);
    expect(h.synced).toEqual([]);                 // nothing runs inline
    h.queue.shift()!();
    expect(h.synced).toHaveLength(1);             // one step per tick
    expect(h.store.has(ACTIVITY_BACKFILL_MARKER)).toBe(false);
    h.drain();

    expect([...h.synced].sort()).toEqual([
      ['agent-1.jsonl', 'claude-code', 'sess-a'], // a subagent's file, under its parent session
      ['rollout-2026-11-19T10-00-00-th1.jsonl', 'openai-codex', ''],
      ['sess-a.jsonl', 'claude-code', 'sess-a'],
      ['sess-b.jsonl', 'claude-code', 'sess-b'],
    ]);
    expect(h.store.has(ACTIVITY_BACKFILL_MARKER)).toBe(true);
    expect(h.done).toEqual([{ files: 4, inserted: 8, full: true }]);
  });

  it('keeps stepping a long file until it is finished', () => {
    const h = harness({}, { 'sess-b.jsonl': 2 });
    startActivityBackfill(h.meta, h.sync, h.opts);
    h.drain();
    expect(h.synced.filter((s) => s[0] === 'sess-b.jsonl')).toHaveLength(3);
    expect(h.synced).toHaveLength(6);
  });

  it('later runs: only a catch-up over recent files, and the marker stays', () => {
    const h = harness();
    h.store.set(ACTIVITY_BACKFILL_MARKER, 'earlier');
    age(claude('sess-b.jsonl'), 30);              // older than the catch-up window
    startActivityBackfill(h.meta, h.sync, h.opts);
    h.drain();
    expect(h.synced.map((s) => s[0])).not.toContain('sess-b.jsonl');
    expect(h.synced).toHaveLength(3);
    expect(h.store.get(ACTIVITY_BACKFILL_MARKER)).toBe('earlier');
    expect(h.done[0].full).toBe(false);
  });

  it('first run still skips files older than the retention window', () => {
    const h = harness();
    age(claude('sess-b.jsonl'), 400);
    startActivityBackfill(h.meta, h.sync, h.opts);
    h.drain();
    expect(h.synced.map((s) => s[0])).not.toContain('sess-b.jsonl');
  });

  it('under the file cap, keeps the newest files', () => {
    const h = harness({ maxFiles: 2 });
    age(claude('sess-a.jsonl'), 5);
    age(claude('sess-a', 'subagents', 'agent-1.jsonl'), 3);
    age(claude('sess-b.jsonl'), 1);
    age(codex('rollout-2026-11-19T10-00-00-th1.jsonl'), 2);
    startActivityBackfill(h.meta, h.sync, h.opts);
    h.drain();
    expect(h.synced.map((s) => s[0])).toEqual(['sess-b.jsonl', 'rollout-2026-11-19T10-00-00-th1.jsonl']);
  });

  it('stops when cancelled and leaves no marker, so the next launch retries', () => {
    const h = harness();
    const cancel = startActivityBackfill(h.meta, h.sync, h.opts);
    h.queue.shift()!();
    cancel();
    h.drain();
    expect(h.synced).toHaveLength(1);
    expect(h.store.has(ACTIVITY_BACKFILL_MARKER)).toBe(false);
    expect(h.done).toEqual([]);
  });

  it('sets the marker when there is nothing to read', () => {
    const h = harness({ claudeProjectsDir: path.join(dir, 'none'), codexSessionsDir: path.join(dir, 'none2') });
    startActivityBackfill(h.meta, h.sync, h.opts);
    h.drain();
    expect(h.synced).toEqual([]);
    expect(h.store.has(ACTIVITY_BACKFILL_MARKER)).toBe(true);
    expect(h.done).toEqual([{ files: 0, inserted: 0, full: true }]);
  });
});

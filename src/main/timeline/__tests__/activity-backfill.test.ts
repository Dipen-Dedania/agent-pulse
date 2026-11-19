import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACTIVITY_BACKFILL_MARKER, maybeBackfillActivity } from '../activity-backfill';

describe('maybeBackfillActivity', () => {
  let dir: string;
  let claudeDir: string;
  let codexDir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-backfill-'));
    claudeDir = path.join(dir, 'projects');
    codexDir = path.join(dir, 'sessions');
    fs.mkdirSync(path.join(claudeDir, 'E--proj', 'sess-a', 'subagents'), { recursive: true });
    fs.mkdirSync(path.join(codexDir, '2026', '11', '19'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'E--proj', 'sess-a.jsonl'), '{}\n');
    fs.writeFileSync(path.join(claudeDir, 'E--proj', 'sess-b.jsonl'), '{}\n');
    // A subagent's own transcript and a non-rollout file must be left alone.
    fs.writeFileSync(path.join(claudeDir, 'E--proj', 'sess-a', 'subagents', 'agent-1.jsonl'), '{}\n');
    fs.writeFileSync(path.join(codexDir, '2026', '11', '19', 'rollout-2026-11-19T10-00-00-th1.jsonl'), '{}\n');
    fs.writeFileSync(path.join(codexDir, '2026', '11', '19', 'notes.jsonl'), '{}\n');
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function harness() {
    const store = new Map<string, string>();
    const meta = { getMeta: (k: string) => store.get(k) ?? null, setMeta: (k: string, v: string) => { store.set(k, v); } };
    const synced: Array<[string, string, string]> = [];
    const sync = {
      syncFile: (p: string, toolId: string, sessionId: string) => { synced.push([path.basename(p), toolId, sessionId]); return 2; },
    };
    const queue: Array<() => void> = [];
    const schedule = (fn: () => void) => {
      queue.push(fn);
      return () => { const i = queue.indexOf(fn); if (i >= 0) queue.splice(i, 1); };
    };
    const opts = { claudeProjectsDir: claudeDir, codexSessionsDir: codexDir, schedule };
    const drain = () => { while (queue.length > 0) queue.shift()!(); };
    return { store, meta, synced, sync, queue, opts, drain };
  }

  it('syncs every session file once, one per tick, then sets the marker', () => {
    const h = harness();
    maybeBackfillActivity(h.meta, h.sync, h.opts);
    expect(h.synced).toEqual([]);                 // nothing runs inline
    h.queue.shift()!();
    expect(h.synced).toHaveLength(1);             // one file per tick
    expect(h.store.has(ACTIVITY_BACKFILL_MARKER)).toBe(false);
    h.drain();

    expect(h.synced.sort()).toEqual([
      ['rollout-2026-11-19T10-00-00-th1.jsonl', 'openai-codex', ''],
      ['sess-a.jsonl', 'claude-code', 'sess-a'],
      ['sess-b.jsonl', 'claude-code', 'sess-b'],
    ]);
    expect(h.store.has(ACTIVITY_BACKFILL_MARKER)).toBe(true);
  });

  it('does nothing once the marker is set', () => {
    const h = harness();
    h.store.set(ACTIVITY_BACKFILL_MARKER, '1');
    maybeBackfillActivity(h.meta, h.sync, h.opts);
    expect(h.queue).toHaveLength(0);
    expect(h.synced).toEqual([]);
  });

  it('stops when cancelled and leaves no marker, so the next launch retries', () => {
    const h = harness();
    const cancel = maybeBackfillActivity(h.meta, h.sync, h.opts);
    h.queue.shift()!();
    cancel();
    h.drain();
    expect(h.synced).toHaveLength(1);
    expect(h.store.has(ACTIVITY_BACKFILL_MARKER)).toBe(false);
  });

  it('skips files older than the retention window', () => {
    const h = harness();
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(claudeDir, 'E--proj', 'sess-b.jsonl'), old, old);
    maybeBackfillActivity(h.meta, h.sync, h.opts);
    h.drain();
    expect(h.synced.map((s) => s[0])).not.toContain('sess-b.jsonl');
    expect(h.synced).toHaveLength(2);
  });

  it('sets the marker when there is nothing to read', () => {
    const h = harness();
    maybeBackfillActivity(h.meta, h.sync, {
      ...h.opts,
      claudeProjectsDir: path.join(dir, 'none'),
      codexSessionsDir: path.join(dir, 'none2'),
    });
    h.drain();
    expect(h.synced).toEqual([]);
    expect(h.store.has(ACTIVITY_BACKFILL_MARKER)).toBe(true);
  });
});

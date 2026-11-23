import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandUse } from '../command-history';
import { CommandHistorySync, CommandSink, CommandSyncOptions, discoverClaudeCommands } from '../command-sync';

const T0 = 1_763_116_642_737;

// In-memory sink that dedups on key, like the real table.
function memorySink() {
  const uses = new Map<string, CommandUse>();
  const offsets = new Map<string, { path: string; offset: number; context?: string | null; updatedAt?: number | null }>();
  const state = { failInserts: false, replaces: 0 };
  const sink: CommandSink = {
    insertCommandUses: (rows, replaceAll) => {
      if (state.failInserts) return null;
      if (replaceAll) { uses.clear(); state.replaces++; }
      let n = 0;
      for (const r of rows) if (!uses.has(r.key)) { uses.set(r.key, r); n++; }
      return n;
    },
    loadActivityOffsets: () => Array.from(offsets.values()),
    saveActivityOffset: (row) => { offsets.set(row.path, row); },
  };
  return { sink, uses, offsets, state };
}

let seq = 0;
const entry = (display: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ display, pastedContents: {}, timestamp: T0 + 10_000 * seq++, project: 'E:\\repo', sessionId: 's1', ...over }) + '\n';

describe('CommandHistorySync', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-commands-'));
    file = path.join(dir, 'history.jsonl');
    seq = 0;
  });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  function harness(opts: CommandSyncOptions = {}, mem = memorySink()) {
    const queue: Array<() => void> = [];
    const clock = { now: T0 + 1_000_000 };
    const sync = new CommandHistorySync(mem.sink, {
      historyPath: file, configDir: dir, now: () => clock.now, defer: (fn) => { queue.push(fn); }, ...opts,
    });
    const names = () => Array.from(mem.uses.values()).map((u) => u.name);
    return { ...mem, sync, queue, clock, names };
  }

  it('reads the file once, then only its new tail', () => {
    fs.writeFileSync(file, entry('/model') + entry('hello') + entry('/new'));
    const h = harness();
    expect(h.sync.sync()).toEqual({ available: true, inserted: 2, rebuilt: false });
    expect(h.sync.sync()).toEqual({ available: true, inserted: 0, rebuilt: false });
    fs.appendFileSync(file, entry('/compact'));
    expect(h.sync.sync().inserted).toBe(1);
    expect(h.names()).toEqual(['model', 'new', 'compact']);
    expect(h.state.replaces).toBe(0);
  });

  it('reports a missing file and keeps what is stored', () => {
    fs.writeFileSync(file, entry('/model'));
    const h = harness();
    h.sync.sync();
    fs.rmSync(file);
    expect(h.sync.sync()).toEqual({ available: false, inserted: 0, rebuilt: false });
    expect(h.names()).toEqual(['model']);
  });

  it('leaves a line that is still being written for the next read', () => {
    const full = entry('/new');
    fs.writeFileSync(file, entry('/model') + full.slice(0, 20));
    const h = harness();
    expect(h.sync.sync().inserted).toBe(1);
    fs.appendFileSync(file, full.slice(20));
    expect(h.sync.sync().inserted).toBe(1);
    expect(h.names()).toEqual(['model', 'new']);
  });

  it('reads a large file in chunks without splitting lines', () => {
    let text = '';
    for (let i = 0; i < 40; i++) text += entry(i % 2 ? '/model' : '/new é');
    fs.writeFileSync(file, text);
    const h = harness({ maxReadBytes: 300 });
    expect(h.sync.sync().inserted).toBe(40);
    expect(h.offsets.get(file)?.offset).toBe(Buffer.byteLength(text));
  });

  it('persists its offset, so a new instance reads only the tail', () => {
    fs.writeFileSync(file, entry('/model'));
    const mem = memorySink();
    harness({}, mem).sync.sync();
    fs.appendFileSync(file, entry('/new'));
    const second = harness({}, mem);
    expect(second.sync.sync()).toEqual({ available: true, inserted: 1, rebuilt: false });
    expect(second.names()).toEqual(['model', 'new']);
  });

  it('carries the dedupe window across reads', () => {
    fs.writeFileSync(file, entry('/new', { timestamp: T0 }));
    const h = harness();
    h.sync.sync();
    fs.appendFileSync(file, entry('/new', { timestamp: T0 + 300 }));
    expect(h.sync.sync().inserted).toBe(0);
  });

  it('rebuilds from scratch when the file shrinks', () => {
    const keep = entry('/model');
    fs.writeFileSync(file, keep + entry('/goal') + entry('/new'));
    const h = harness();
    h.sync.sync();
    expect(h.names()).toEqual(['model', 'goal', 'new']);
    fs.writeFileSync(file, keep);                                  // claude purge removed two lines
    expect(h.sync.sync()).toEqual({ available: true, inserted: 1, rebuilt: true });
    expect(h.names()).toEqual(['model']);
    expect(h.sync.sync().rebuilt).toBe(false);
  });

  it('clears the table when the file is emptied', () => {
    fs.writeFileSync(file, entry('/model'));
    const h = harness();
    h.sync.sync();
    fs.writeFileSync(file, '');
    expect(h.sync.sync()).toEqual({ available: true, inserted: 0, rebuilt: true });
    expect(h.names()).toEqual([]);
    fs.appendFileSync(file, entry('/new'));
    expect(h.sync.sync()).toEqual({ available: true, inserted: 1, rebuilt: false });
  });

  it('rebuilds when the first line changed even though the file grew back', () => {
    fs.writeFileSync(file, entry('/goal') + entry('/model'));
    const h = harness();
    h.sync.sync();
    // The first line was purged and enough new lines arrived to pass the old offset.
    fs.writeFileSync(file, entry('/model') + entry('/new') + entry('/compact') + entry('/exit'));
    expect(h.sync.sync()).toMatchObject({ rebuilt: true });
    expect(h.names().sort()).toEqual(['compact', 'exit', 'model', 'new']);
  });

  it('does not advance when the write fails', () => {
    fs.writeFileSync(file, entry('/model'));
    const h = harness();
    h.state.failInserts = true;
    expect(h.sync.sync().inserted).toBe(0);
    expect(h.offsets.size).toBe(0);
    h.state.failInserts = false;
    expect(h.sync.sync().inserted).toBe(1);
  });

  it('drops lines older than the retention window', () => {
    fs.writeFileSync(file, entry('/old', { timestamp: T0 - 5000 }) + entry('/model', { timestamp: T0 }));
    const h = harness({ retentionMs: 1_000_000 });   // now = T0 + 1_000_000
    h.sync.sync();
    expect(h.names()).toEqual(['model']);
  });

  it('counts inline mentions of discovered commands only', () => {
    fs.mkdirSync(path.join(dir, 'skills', 'hard'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', 'hard', 'SKILL.md'), '# hard');
    fs.writeFileSync(file, entry('please /hard fix the /login route'));
    const h = harness();
    h.sync.sync();
    expect(Array.from(h.uses.values()).map((u) => [u.name, u.entry])).toEqual([['hard', 'inline']]);
  });

  it('reads on a hook event at most once every 30 seconds, and only for Claude Code', () => {
    fs.writeFileSync(file, entry('/model'));
    const h = harness();
    h.sync.onAgentEvent('openai-codex');
    expect(h.queue).toHaveLength(0);
    h.sync.onAgentEvent('claude-code');
    h.sync.onAgentEvent('claude-code');
    expect(h.queue).toHaveLength(1);
    h.queue.shift()!();
    expect(h.names()).toEqual(['model']);
    h.clock.now += 10_000;
    h.sync.onAgentEvent('claude-code');
    expect(h.queue).toHaveLength(0);
    h.clock.now += 30_000;
    h.sync.onAgentEvent('claude-code');
    expect(h.queue).toHaveLength(1);
  });

  it('does nothing once disposed', () => {
    fs.writeFileSync(file, entry('/model'));
    const h = harness();
    h.sync.dispose();
    h.sync.onAgentEvent('claude-code');
    expect(h.queue).toHaveLength(0);
    expect(h.sync.sync()).toEqual({ available: false, inserted: 0, rebuilt: false });
  });
});

describe('discoverClaudeCommands', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-discover-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const touch = (...parts: string[]) => {
    const target = path.join(dir, ...parts);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x');
  };

  it('finds user commands, user skills, project ones and installed plugin ones', () => {
    touch('config', 'commands', 'Ship.md');
    touch('config', 'commands', 'git', 'sync.md');
    touch('config', 'commands', 'notes.txt');                       // not a command
    touch('config', 'skills', 'hard', 'SKILL.md');
    touch('config', 'skills', 'empty', 'README.md');                // not a skill
    touch('repo', '.claude', 'commands', 'deploy.md');
    touch('repo', '.claude', 'skills', 'review-ui', 'SKILL.md');
    touch('config', 'plugins', 'cache', 'market', 'brag', '0.1.0', 'skills', 'brag', 'SKILL.md');
    touch('config', 'plugins', 'cache', 'market', 'tools', '1.0.0', 'commands', 'lint.md');
    touch('config', 'plugins', 'cache', 'market', 'tools', '1.0.0', 'commands', 'ship.md');   // user's own wins
    touch('config', 'plugins', 'marketplaces', 'market', 'skills', 'not-installed', 'SKILL.md');

    const found = discoverClaudeCommands(path.join(dir, 'config'), [path.join(dir, 'repo'), 'relative/ignored']);
    expect(Object.fromEntries(found)).toEqual({
      ship: 'custom', sync: 'custom', hard: 'custom', deploy: 'custom', 'review-ui': 'custom',
      brag: 'plugin', lint: 'plugin',
    });
  });

  it('returns nothing for a config folder that does not exist', () => {
    expect(discoverClaudeCommands(path.join(dir, 'missing')).size).toBe(0);
  });
});

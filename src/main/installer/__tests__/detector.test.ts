import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Detection must never spawn in tests: mock the PATH lookup module the way
// codex-opener.test.ts mocks `lookupOnPath`. Each test decides what `which`
// returns; the filesystem probes run against an empty temp home.
const which = vi.hoisted(() => ({
  hits: {} as Record<string, string | undefined>,
  calls: [] as string[],
}));
vi.mock('../which', () => ({
  whichAsync: async (name: string) => {
    which.calls.push(name);
    return which.hits[name];
  },
  lookupOnPathAsync: async (name: string) => {
    which.calls.push(name);
    const hit = which.hits[name];
    return hit ? [hit] : [];
  },
}));

import { ToolDetector } from '../detector';

describe('ToolDetector', () => {
  let home: string;
  const savedEnv = {
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    GROK_HOME: process.env.GROK_HOME,
    OPENCODE_CONFIG: process.env.OPENCODE_CONFIG,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-detector-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    // Point every per-platform config root into the empty temp home so the
    // machine running the tests never leaks its own installs into them.
    process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
    process.env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
    process.env.GROK_HOME = path.join(home, '.grok');
    process.env.OPENCODE_CONFIG = path.join(home, '.config', 'opencode');
    process.env.XDG_CONFIG_HOME = path.join(home, '.config');
    which.hits = {};
    which.calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('reports a tool as installed from its config dir without consulting PATH', async () => {
    fs.mkdirSync(path.join(home, '.claude'));
    const result = await new ToolDetector().detectAll();
    expect(result['claude-code']).toEqual({ installed: true, location: path.join(home, '.claude') });
    expect(which.calls).not.toContain('claude');
  });

  it('falls back to the PATH lookup and reports the binary location', async () => {
    which.hits.codex = '/usr/local/bin/codex';
    const result = await new ToolDetector().detectAll();
    expect(result['openai-codex']).toEqual({ installed: true, location: '/usr/local/bin/codex' });
    expect(result['kiro']).toEqual({ installed: false });
  });

  it('covers every tool id in one result', async () => {
    const result = await new ToolDetector().detectAll();
    expect(Object.keys(result).sort()).toEqual(
      ['antigravity-cli', 'claude-code', 'cursor', 'grok', 'kiro', 'muse-code', 'openai-codex', 'opencode', 'vscode-copilot'],
    );
  });

  it('shares one in-flight run between concurrent callers and caches the result', async () => {
    const detector = new ToolDetector();
    const [a, b] = await Promise.all([detector.detectAll(), detector.detectAll()]);
    expect(a).toBe(b);
    const lookupsAfterFirstRun = which.calls.length;
    expect(lookupsAfterFirstRun).toBeGreaterThan(0);

    const c = await detector.detectAll();
    expect(c).toBe(a);
    expect(which.calls.length).toBe(lookupsAfterFirstRun);
    expect(detector.lastResult()).toBe(a);
  });

  it('invalidate() forces the next detectAll() to probe again and pick up changes', async () => {
    const detector = new ToolDetector();
    const first = await detector.detectAll();
    expect(first['grok'].installed).toBe(false);

    which.hits.grok = '/opt/bin/grok';
    expect((await detector.detectAll())['grok'].installed).toBe(false); // still cached

    detector.invalidate();
    const second = await detector.detectAll();
    expect(second).not.toBe(first);
    expect(second['grok']).toEqual({ installed: true, location: '/opt/bin/grok' });
  });

  it('detectStatusLineRuntime prefers node, then python, and returns null when nothing is found', async () => {
    const detector = new ToolDetector();
    expect(await detector.detectStatusLineRuntime()).toBeNull();

    which.hits.python3 = '/usr/bin/python3';
    expect(await detector.detectStatusLineRuntime()).toEqual({ runtime: 'python', binPath: '/usr/bin/python3' });

    which.hits.node = '/usr/bin/node';
    expect(await detector.detectStatusLineRuntime()).toEqual({ runtime: 'node', binPath: '/usr/bin/node' });
  });
});

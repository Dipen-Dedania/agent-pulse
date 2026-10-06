import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Keep PATH lookups out of the picture: every test here exercises the absolute
// candidate probing, so `where codex` must miss deterministically.
const pathHits = vi.hoisted(() => ({ value: [] as string[] }));
vi.mock('../opener', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../opener')>();
  return { ...actual, lookupOnPath: () => pathHits.value };
});

import { buildCodexOpenerArgs, resetCodexBinCache, resolveCodexBin } from '../codex-opener';

const isWin = process.platform === 'win32';
const bin = isWin ? 'codex.exe' : 'codex';

describe('buildCodexOpenerArgs', () => {
  it('is the fixed, sandboxed, ephemeral exec invocation', () => {
    expect(buildCodexOpenerArgs()).toEqual(['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', 'ok']);
  });
});

describe('resolveCodexBin', () => {
  let home: string;
  const savedEnv = { LOCALAPPDATA: process.env.LOCALAPPDATA, APPDATA: process.env.APPDATA };

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-codex-bin-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    // Point the Windows launcher / npm candidates at empty dirs under the fake home.
    process.env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
    process.env.APPDATA = path.join(home, 'AppData', 'Roaming');
    pathHits.value = [];
    resetCodexBinCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env.LOCALAPPDATA = savedEnv.LOCALAPPDATA;
    process.env.APPDATA = savedEnv.APPDATA;
    resetCodexBinCache();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const release = (name: string) => {
    const dir = path.join(home, '.codex', 'packages', 'standalone', 'releases', name, 'bin');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, bin);
    fs.writeFileSync(file, '');
    return file;
  };
  const current = (name: string) => {
    const root = path.join(home, '.codex', 'packages', 'standalone');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'current'), `${name}\n`);
  };

  it('prefers a PATH hit, with .exe over .cmd on Windows', () => {
    pathHits.value = isWin
      ? ['C:\\npm\\codex.cmd', 'C:\\Programs\\OpenAI\\Codex\\bin\\codex.exe']
      : ['/opt/homebrew/bin/codex'];
    expect(resolveCodexBin()).toBe(isWin ? 'C:\\Programs\\OpenAI\\Codex\\bin\\codex.exe' : '/opt/homebrew/bin/codex');
  });

  it('follows the standalone `current` marker to the active release', () => {
    release('0.139.0-x86_64');
    const active = release('0.160.0-x86_64');
    current('0.160.0-x86_64');
    expect(resolveCodexBin()).toBe(active);
  });

  it('falls back to the newest release dir when `current` is missing or stale', () => {
    release('0.139.0-x86_64');
    const newest = release('0.160.0-x86_64');
    expect(resolveCodexBin()).toBe(newest);

    resetCodexBinCache();
    current('9.9.9-gone'); // marker points at a release that was cleaned up
    expect(resolveCodexBin()).toBe(newest);
  });

  it.skipIf(!isWin)('checks the installer launcher before the standalone releases on Windows', () => {
    const launcher = path.join(process.env.LOCALAPPDATA!, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe');
    fs.mkdirSync(path.dirname(launcher), { recursive: true });
    fs.writeFileSync(launcher, '');
    release('0.160.0-x86_64');
    expect(resolveCodexBin()).toBe(launcher);
  });

  it('returns null (and does not cache) when nothing is installed', () => {
    expect(resolveCodexBin()).toBeNull();
    const later = release('0.160.0-x86_64');
    expect(resolveCodexBin()).toBe(later); // a later install is picked up
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ConfigWriter } from '../config-writer';
import { CodexStatusLineConfig } from '../../../common/types';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pulse-codex-sl-'));
  vi.spyOn(os, 'homedir').mockReturnValue(tmpDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const cfg: CodexStatusLineConfig = { items: ['model-with-reasoning', 'git-branch', 'five-hour-limit'] };
const tomlPath = () => path.join(tmpDir, '.codex', 'config.toml');
const read = () => fs.readFileSync(tomlPath(), 'utf8');
const seed = (content: string) => {
  fs.mkdirSync(path.dirname(tomlPath()), { recursive: true });
  fs.writeFileSync(tomlPath(), content);
};

// Realistic file: no [tui] today, several quoted sub-tables.
const REAL = [
  'model = "gpt-6-astra"',
  '',
  '[features]',
  'hooks = true',
  '',
  "[projects.'E:\\DDrive\\Github\\agent-pulse']",
  'trust_level = "trusted"',
  '',
].join('\n');

describe('ConfigWriter — codex status line', () => {
  it('reports none / creates the file on first install / then reports ours', () => {
    const w = new ConfigWriter();
    expect(w.codexStatusLineState(cfg)).toBe('none');
    const res = w.installCodexStatusLine(cfg);
    expect(res).toMatchObject({ success: true, state: 'ours', path: tomlPath() });
    expect(read()).toBe('[tui]\nstatus_line = ["model-with-reasoning", "git-branch", "five-hour-limit"]  # agent-pulse\n');
    expect(w.codexStatusLineState(cfg)).toBe('ours');
    expect(w.readCodexStatusLine().items).toEqual(cfg.items);
  });

  it('appends [tui] to a populated file and removal restores it byte for byte', () => {
    seed(REAL);
    const w = new ConfigWriter();
    w.installCodexStatusLine(cfg);
    expect(read().startsWith(REAL.trimEnd() + '\n\n[tui]\n')).toBe(true);
    expect(read()).toContain('# agent-pulse');
    w.removeCodexStatusLine();
    expect(read()).toBe(REAL);
    expect(w.codexStatusLineState(cfg)).toBe('none');
  });

  it('treats an unmarked line with identical items as ours', () => {
    seed('[tui]\nstatus_line = ["model-with-reasoning", "git-branch", "five-hour-limit"]\n');
    expect(new ConfigWriter().codexStatusLineState(cfg)).toBe('ours');
  });

  it('refuses to clobber a foreign line without replace, then backs it up and replaces', () => {
    seed('[tui]\nstatus_line = ["model", "activity"]\ntheme = "dark"\n');
    const w = new ConfigWriter();
    expect(w.codexStatusLineState(cfg)).toBe('foreign');
    expect(w.readCodexStatusLine().items).toEqual(['model', 'activity']);

    const refused = w.installCodexStatusLine(cfg);
    expect(refused).toMatchObject({ success: false, reason: 'needs-confirm', state: 'foreign' });
    expect(read()).toContain('["model", "activity"]');

    const replaced = w.installCodexStatusLine(cfg, { replace: true });
    expect(replaced.success).toBe(true);
    expect(replaced.backup).toBe(path.join(tmpDir, '.codex', 'config.backup-1.toml'));
    expect(fs.readFileSync(replaced.backup!, 'utf8')).toContain('["model", "activity"]');
    expect(read()).toBe('[tui]\nstatus_line = ["model-with-reasoning", "git-branch", "five-hour-limit"]  # agent-pulse\ntheme = "dark"\n');
  });

  it('treats `status_line = null` as foreign (unparseable items)', () => {
    seed('[tui]\nstatus_line = null\n');
    const w = new ConfigWriter();
    expect(w.codexStatusLineState(cfg)).toBe('foreign');
    expect(w.readCodexStatusLine().items).toBeNull();
  });

  it('refuses an inline-table / dotted-key layout instead of writing invalid TOML', () => {
    seed('tui = { status_line = ["model"] }\n');
    const w = new ConfigWriter();
    const res = w.installCodexStatusLine(cfg, { replace: true });
    expect(res).toMatchObject({ success: false, reason: 'inline-table' });
    expect(read()).toBe('tui = { status_line = ["model"] }\n');
  });

  it('refuses an empty item list', () => {
    const res = new ConfigWriter().installCodexStatusLine({ items: [] });
    expect(res).toMatchObject({ success: false, reason: 'empty' });
    expect(fs.existsSync(tomlPath())).toBe(false);
  });

  it('is a no-op write when nothing changed (mtime-safe re-apply)', () => {
    seed(REAL);
    const w = new ConfigWriter();
    w.installCodexStatusLine(cfg);
    const before = fs.statSync(tomlPath()).mtimeMs;
    const content = read();
    w.installCodexStatusLine(cfg, { replace: true });
    expect(read()).toBe(content);
    expect(fs.statSync(tomlPath()).mtimeMs).toBe(before);
  });
});

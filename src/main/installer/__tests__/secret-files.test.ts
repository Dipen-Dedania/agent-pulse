import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  writeSecretFilesForTool,
  removeSecretFilesForTool,
  writeAiIgnore,
  removeAiIgnore,
  globToClaudeDeny,
} from '../secret-files';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-secret-'));
  // Point homedir at the temp dir so Claude/Codex writers don't touch the real
  // home. The gitignore writers take an explicit projectPath instead.
  vi.spyOn(os, 'homedir').mockReturnValue(tmp);
});

afterEach(() => {
  vi.restoreAllMocks();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

const read = (p: string) => fs.readFileSync(p, 'utf8');

// ── gitignore-style managed block (cursor / copilot / antigravity) ──────────────

describe('managed-block ignore files', () => {
  it('writes a managed block and is idempotent (write twice = one block)', () => {
    const r1 = writeSecretFilesForTool('cursor', ['.env', '*.pem'], { projectPath: tmp });
    expect(r1.success).toBe(true);
    const once = read(r1.path!);
    const r2 = writeSecretFilesForTool('cursor', ['.env', '*.pem'], { projectPath: tmp });
    const twice = read(r2.path!);
    expect(twice).toBe(once);
    expect(twice.match(/agent-pulse secret-protection \(managed\)/g)?.length).toBe(2); // start + end marker
  });

  it('preserves user lines outside the block', () => {
    const file = path.join(tmp, '.cursorignore');
    fs.writeFileSync(file, 'node_modules\ndist\n');
    writeSecretFilesForTool('cursor', ['.env'], { projectPath: tmp });
    const out = read(file);
    expect(out).toContain('node_modules');
    expect(out).toContain('dist');
    expect(out).toContain('.env');
  });

  it('removal strips our block but keeps user lines', () => {
    const file = path.join(tmp, '.cursorignore');
    fs.writeFileSync(file, 'node_modules\n');
    writeSecretFilesForTool('cursor', ['.env'], { projectPath: tmp });
    removeSecretFilesForTool('cursor', { projectPath: tmp });
    const out = read(file);
    expect(out).toContain('node_modules');
    expect(out).not.toContain('.env');
    expect(out).not.toContain('agent-pulse');
  });

  it('updating the glob list replaces the block contents', () => {
    writeSecretFilesForTool('cursor', ['.env'], { projectPath: tmp });
    const r = writeSecretFilesForTool('cursor', ['*.key'], { projectPath: tmp });
    const out = read(r.path!);
    expect(out).toContain('*.key');
    expect(out).not.toContain('.env');
  });
});

// ── Claude settings.json structured deny ────────────────────────────────────────

describe('Claude deny merge', () => {
  const settingsPath = () => path.join(tmp, '.claude', 'settings.json');

  it('translates globs to Read(...) deny entries', () => {
    expect(globToClaudeDeny('.env')).toBe('Read(./.env)');
    expect(globToClaudeDeny('**/*.pem')).toBe('Read(**/*.pem)');
    expect(globToClaudeDeny('~/.ssh/**')).toBe('Read(~/.ssh/**)');
    expect(globToClaudeDeny('secrets/**')).toBe('Read(secrets/**)');
  });

  it('merges deny without clobbering user entries; idempotent', () => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({
      permissions: { deny: ['Read(./custom-user-secret)'] },
      hooks: { PreToolUse: [] },
    }, null, 2));

    writeSecretFilesForTool('claude-code', ['.env', '*.pem']);
    const once = JSON.parse(read(settingsPath()));
    expect(once.permissions.deny).toContain('Read(./custom-user-secret)');
    expect(once.permissions.deny).toContain('Read(./.env)');
    expect(once.permissions.deny).toContain('Read(./*.pem)');
    expect(once.hooks).toBeDefined(); // untouched

    writeSecretFilesForTool('claude-code', ['.env', '*.pem']);
    const twice = JSON.parse(read(settingsPath()));
    expect(twice.permissions.deny).toEqual(once.permissions.deny); // no duplicates
  });

  it('retracts entries dropped from the list, keeps user entries', () => {
    writeSecretFilesForTool('claude-code', ['.env', '*.pem']);
    writeSecretFilesForTool('claude-code', ['.env']); // dropped *.pem
    const s = JSON.parse(read(settingsPath()));
    expect(s.permissions.deny).toContain('Read(./.env)');
    expect(s.permissions.deny).not.toContain('Read(./*.pem)');
  });

  it('removal strips only our managed deny entries', () => {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify({
      permissions: { deny: ['Read(./user-thing)'] },
    }, null, 2));
    writeSecretFilesForTool('claude-code', ['.env']);
    removeSecretFilesForTool('claude-code');
    const s = JSON.parse(read(settingsPath()));
    expect(s.permissions.deny).toEqual(['Read(./user-thing)']);
    expect(s.agentPulseManagedDeny).toBeUndefined();
  });
});

// ── Codex config.toml managed region ────────────────────────────────────────────

describe('Codex config.toml managed region', () => {
  const tomlPath = () => path.join(tmp, '.codex', 'config.toml');

  it('inserts a managed region, preserves user TOML, idempotent', () => {
    fs.mkdirSync(path.dirname(tomlPath()), { recursive: true });
    fs.writeFileSync(tomlPath(), '[features]\nhooks = true\n');
    writeSecretFilesForTool('openai-codex', ['.env', '*.pem']);
    const once = read(tomlPath());
    expect(once).toContain('[features]');
    expect(once).toContain('hooks = true');
    expect(once).toContain('# .env');
    writeSecretFilesForTool('openai-codex', ['.env', '*.pem']);
    expect(read(tomlPath())).toBe(once);
  });

  it('removal strips the managed region', () => {
    fs.mkdirSync(path.dirname(tomlPath()), { recursive: true });
    fs.writeFileSync(tomlPath(), '[features]\nhooks = true\n');
    writeSecretFilesForTool('openai-codex', ['.env']);
    removeSecretFilesForTool('openai-codex');
    const out = read(tomlPath());
    expect(out).toContain('hooks = true');
    expect(out).not.toContain('agent-pulse');
  });
});

// ── .aiignore (Phase 4 standard) ────────────────────────────────────────────────

describe('.aiignore emission', () => {
  it('writes + preserves user lines + removes cleanly (project scope)', () => {
    const file = path.join(tmp, '.aiignore');
    fs.writeFileSync(file, 'build/\n');
    writeAiIgnore(['.env', '*.pem'], { projectPath: tmp });
    let out = read(file);
    expect(out).toContain('build/');
    expect(out).toContain('.env');
    expect(out).toContain('*.pem');
    removeAiIgnore({ projectPath: tmp });
    out = read(file);
    expect(out).toContain('build/');
    expect(out).not.toContain('agent-pulse');
  });

  it('global scope writes ~/.aiignore', () => {
    const r = writeAiIgnore(['.env']);
    expect(r.path).toBe(path.join(tmp, '.aiignore'));
    expect(read(r.path!)).toContain('.env');
  });
});

// ── Kiro unsupported ────────────────────────────────────────────────────────────

describe('Kiro', () => {
  it('is skipped as unsupported', () => {
    expect(writeSecretFilesForTool('kiro', ['.env']).skipped).toBe('unsupported');
  });
});

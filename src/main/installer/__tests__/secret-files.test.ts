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
  globToOpencodeDeny,
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

// ── OpenCode permission.read deny merge ─────────────────────────────────────────

describe('OpenCode permission.read deny merge', () => {
  const dir = () => path.join(tmp, '.config', 'opencode');
  const configPath = () => path.join(dir(), 'opencode.json');
  const markerPath = () => path.join(dir(), 'agent-pulse-managed-read-deny.json');
  const parsed = () => JSON.parse(read(configPath()));

  // XDG_CONFIG_HOME would redirect opencodeConfigDir if set in the test env.
  let savedXdg: string | undefined;
  beforeEach(() => {
    savedXdg = process.env['XDG_CONFIG_HOME'];
    delete process.env['XDG_CONFIG_HOME'];
  });
  afterEach(() => {
    if (savedXdg !== undefined) process.env['XDG_CONFIG_HOME'] = savedXdg;
  });

  it('translates canonical globs to OpenCode wildcard keys', () => {
    expect(globToOpencodeDeny('.env')).toEqual(['.env', '*/.env']);
    expect(globToOpencodeDeny('.env.*')).toEqual(['.env.*', '*/.env.*']);
    expect(globToOpencodeDeny('*.pem')).toEqual(['*.pem']);
    expect(globToOpencodeDeny('**/*.pem')).toEqual(['*.pem']);
    expect(globToOpencodeDeny('id_rsa')).toEqual(['id_rsa', '*/id_rsa']);
    expect(globToOpencodeDeny('**/.aws/credentials')).toEqual(['.aws/credentials', '*/.aws/credentials']);
    expect(globToOpencodeDeny('**/.ssh/**')).toEqual(['.ssh/*', '*/.ssh/*']);
    expect(globToOpencodeDeny('secrets/**')).toEqual(['secrets/*', '*/secrets/*']);
    expect(globToOpencodeDeny('a/**/b')).toEqual(['a/b', '*/a/b', 'a/*/b', '*/a/*/b']);
  });

  it('skips home-anchored and absolute globs (worktree-relative dialect)', () => {
    expect(globToOpencodeDeny('~/.ssh/**')).toEqual([]);
    expect(globToOpencodeDeny('/etc/shadow')).toEqual([]);
    expect(globToOpencodeDeny('C:/keys/*.pem')).toEqual([]);
    const r = writeSecretFilesForTool('opencode', ['.env', '~/.ssh/**']);
    expect(r.success).toBe(true);
    expect(r.skippedGlobs).toEqual(['~/.ssh/**']);
  });

  it('writes deny keys plus a sidecar marker, and is idempotent', () => {
    const r1 = writeSecretFilesForTool('opencode', ['.env', '*.pem']);
    expect(r1.success).toBe(true);
    expect(r1.format).toBe('opencode-json');
    const once = read(configPath());
    expect(parsed().permission.read).toEqual({ '.env': 'deny', '*/.env': 'deny', '*.pem': 'deny' });
    expect(JSON.parse(read(markerPath()))).toEqual(['.env', '*/.env', '*.pem']);

    const r2 = writeSecretFilesForTool('opencode', ['.env', '*.pem']);
    expect(r2.success).toBe(true);
    expect(read(configPath())).toBe(once);
  });

  it('preserves user config and appends our denies after user keys (last-match-wins)', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      theme: 'dark',
      permission: { read: { 'docs/*': 'allow' }, bash: 'ask' },
    }, null, 2));

    writeSecretFilesForTool('opencode', ['.env']);
    const cfg = parsed();
    expect(cfg.$schema).toBe('https://opencode.ai/config.json');
    expect(cfg.theme).toBe('dark');
    expect(cfg.permission.bash).toBe('ask');
    expect(Object.keys(cfg.permission.read)).toEqual(['docs/*', '.env', '*/.env']);
    expect(cfg.permission.read['docs/*']).toBe('allow');
  });

  it('normalizes a bare-string read action into the merged map', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ permission: { read: 'allow' } }));
    writeSecretFilesForTool('opencode', ['.env']);
    expect(Object.keys(parsed().permission.read)).toEqual(['*', '.env', '*/.env']);
    expect(parsed().permission.read['*']).toBe('allow');
  });

  it('drops a conflicting user key so our deny wins', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ permission: { read: { '.env': 'allow' } } }));
    writeSecretFilesForTool('opencode', ['.env']);
    const keys = Object.keys(parsed().permission.read);
    expect(keys.filter((k) => k === '.env')).toEqual(['.env']);
    expect(parsed().permission.read['.env']).toBe('deny');
  });

  it('retracts keys for globs removed from the list, keeping user keys', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ permission: { read: { 'docs/*': 'allow' } } }));
    writeSecretFilesForTool('opencode', ['.env', '*.pem']);
    writeSecretFilesForTool('opencode', ['*.pem']);
    expect(parsed().permission.read).toEqual({ 'docs/*': 'allow', '*.pem': 'deny' });
    expect(JSON.parse(read(markerPath()))).toEqual(['*.pem']);
  });

  it('removal deletes our keys, prunes emptied objects, and deletes the sidecar', () => {
    writeSecretFilesForTool('opencode', ['.env']);
    removeSecretFilesForTool('opencode');
    expect(parsed().permission).toBeUndefined();
    expect(fs.existsSync(markerPath())).toBe(false);
  });

  it('removal keeps user keys intact', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify({ permission: { read: { 'docs/*': 'allow' } } }));
    writeSecretFilesForTool('opencode', ['.env']);
    removeSecretFilesForTool('opencode');
    expect(parsed().permission.read).toEqual({ 'docs/*': 'allow' });
  });

  it('refuses to touch an unparseable opencode.json', () => {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(configPath(), '// jsonc comment\n{ "theme": "dark" }');
    const before = read(configPath());
    const r = writeSecretFilesForTool('opencode', ['.env']);
    expect(r.success).toBe(false);
    expect(read(configPath())).toBe(before);
  });
});

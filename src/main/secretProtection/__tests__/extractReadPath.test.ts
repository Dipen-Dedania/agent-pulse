import { describe, it, expect } from 'vitest';
import { extractReadPath } from '../extractReadPath';
import { evaluateSecretAccess } from '../engine';
import { SecretProtectionConfig } from '../../../common/secretProtection';

const cfg: SecretProtectionConfig = {
  enabled: true,
  disabledRuleIds: [],
  customRules: [],
  scope: 'global',
  writeIgnoreFiles: true,
  hookBlocking: true,
};

// Predicate the bridge uses: a candidate is protected if the engine would
// flag it. Keeps the shell scan conservative.
const isProtected = (candidate: string) =>
  evaluateSecretAccess(candidate, { toolId: 'claude-code', config: cfg }).matched.length > 0;

// ── Structured reads ────────────────────────────────────────────────────────────

describe('extractReadPath — structured tools', () => {
  it('claude-code Read tool → file_path, not viaShell', () => {
    const r = extractReadPath('claude-code', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Read',
      tool_input: { file_path: '/proj/.env' },
    });
    expect(r).toEqual({ path: '/proj/.env', viaShell: false });
  });

  it('cursor read_file → target_file', () => {
    const r = extractReadPath('cursor', {
      tool_name: 'read_file',
      tool_input: { target_file: '/proj/secrets/db.txt' },
    });
    expect(r?.path).toBe('/proj/secrets/db.txt');
    expect(r?.viaShell).toBe(false);
  });

  it('antigravity nested args path', () => {
    const r = extractReadPath('antigravity-cli', {
      toolCall: { name: 'view', args: { path: '/proj/id_rsa' } },
    });
    expect(r?.path).toBe('/proj/id_rsa');
  });

  it('non-read structured tool → null', () => {
    const r = extractReadPath('claude-code', {
      tool_name: 'Write',
      tool_input: { file_path: '/proj/.env' },
    });
    expect(r).toBeNull();
  });
});

// ── Shell reads (best-effort) ───────────────────────────────────────────────────

describe('extractReadPath — shell reads', () => {
  it('cat .env trips when predicate confirms protection', () => {
    const r = extractReadPath('claude-code', {
      tool_name: 'Bash',
      tool_input: { command: 'cat .env' },
    }, { isProtected });
    expect(r).toEqual({ path: '.env', viaShell: true });
  });

  it('type secrets\\db.txt (windows) trips', () => {
    const r = extractReadPath('claude-code', {
      tool_name: 'Bash',
      tool_input: { command: 'type secrets\\db.txt' },
    }, { isProtected });
    expect(r?.viaShell).toBe(true);
    expect(r?.path).toBe('secrets\\db.txt');
  });

  it('chained command: build && cat .env trips', () => {
    const r = extractReadPath('claude-code', {
      tool_name: 'Bash',
      tool_input: { command: 'npm run build && cat .env' },
    }, { isProtected });
    expect(r?.path).toBe('.env');
  });

  it('cat README.md does NOT trip (not protected)', () => {
    const r = extractReadPath('claude-code', {
      tool_name: 'Bash',
      tool_input: { command: 'cat README.md' },
    }, { isProtected });
    expect(r).toBeNull();
  });

  it('ls -la (no read verb) → null', () => {
    const r = extractReadPath('claude-code', {
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
    }, { isProtected });
    expect(r).toBeNull();
  });

  it('quoted path is unwrapped', () => {
    const r = extractReadPath('claude-code', {
      tool_name: 'Bash',
      tool_input: { command: "cat '.env'" },
    }, { isProtected });
    expect(r?.path).toBe('.env');
  });
});

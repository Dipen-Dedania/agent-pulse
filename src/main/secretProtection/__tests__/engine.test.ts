import { describe, it, expect } from 'vitest';
import { evaluateSecretAccess, isGlobSafe, compileGlob, effectiveSecretRules } from '../engine';
import { SecretProtectionConfig, SecretRule } from '../../../common/secretProtection';

const cfg = (overrides: Partial<SecretProtectionConfig> = {}): SecretProtectionConfig => ({
  enabled: true,
  disabledRuleIds: [],
  customRules: [],
  scope: 'global',
  writeIgnoreFiles: true,
  hookBlocking: true,
  ...overrides,
});

// ── Core preset matches → block on blockable tools ──────────────────────────────

describe('Secret reads — core preset', () => {
  const cases: { path: string; rule: string }[] = [
    { path: '/home/u/project/.env', rule: 'env' },
    { path: 'C:\\proj\\.env', rule: 'env' },
    { path: '/home/u/project/.env.local', rule: 'env-variants' },
    { path: '/home/u/project/certs/server.pem', rule: 'pem' },
    { path: '/home/u/project/tls/private.key', rule: 'key' },
    { path: '/home/u/.ssh/id_rsa', rule: 'id-rsa' },
    { path: '/home/u/.ssh/known_hosts', rule: 'ssh-dir' },
    { path: '/home/u/.aws/credentials', rule: 'aws-credentials' },
    { path: '/home/u/.config/gcloud/access_tokens.db', rule: 'gcloud-dir' },
    { path: '/proj/secrets/db-password.txt', rule: 'secrets-dir' },
    { path: '/proj/service-account-prod.json', rule: 'service-account' },
    { path: '/proj/vault.kdbx', rule: 'kdbx' },
    { path: '/home/u/.npmrc', rule: 'npmrc' },
  ];
  for (const { path, rule } of cases) {
    it(`${path} → block (matches ${rule}) on claude-code`, () => {
      const r = evaluateSecretAccess(path, { toolId: 'claude-code', config: cfg() });
      expect(r.decision).toBe('block');
      expect(r.matched.some((m) => m.ruleId === rule)).toBe(true);
    });
  }
});

// ── Non-blockable tools downgrade to warn ───────────────────────────────────────

describe('Blockability downgrade', () => {
  it('cursor (non-blockable) downgrades block → warn but still matches', () => {
    const r = evaluateSecretAccess('/proj/.env', { toolId: 'cursor', config: cfg() });
    expect(r.decision).toBe('warn');
    expect(r.blockable).toBe(false);
    expect(r.matched.some((m) => m.ruleId === 'env')).toBe(true);
  });

  it('claude-code is blockable', () => {
    const r = evaluateSecretAccess('/proj/.env', { toolId: 'claude-code', config: cfg() });
    expect(r.blockable).toBe(true);
    expect(r.decision).toBe('block');
  });

  it('antigravity-cli is blockable', () => {
    const r = evaluateSecretAccess('/proj/.env', { toolId: 'antigravity-cli', config: cfg() });
    expect(r.decision).toBe('block');
  });
});

// ── No false positives on ordinary files ────────────────────────────────────────

describe('Safe reads → allow', () => {
  const safe = [
    '/proj/src/index.ts',
    '/proj/README.md',
    '/proj/package.json',
    '/proj/notapem.txt',     // *.pem must not match a substring
    '/proj/environment.md',  // .env must not match a substring
    '/proj/keychain.ts',     // *.key must not match a substring
    '/proj/src/env/config.ts',
  ];
  for (const path of safe) {
    it(`${path} → allow`, () => {
      const r = evaluateSecretAccess(path, { toolId: 'claude-code', config: cfg() });
      expect(r.decision).toBe('allow');
      expect(r.matched).toEqual([]);
    });
  }
});

// ── Config behaviour ────────────────────────────────────────────────────────────

describe('Configuration', () => {
  it('master toggle off → always allow', () => {
    const r = evaluateSecretAccess('/proj/.env', { toolId: 'claude-code', config: cfg({ enabled: false }) });
    expect(r.decision).toBe('allow');
  });

  it('disabled rule is skipped', () => {
    const r = evaluateSecretAccess('/proj/.env', {
      toolId: 'claude-code',
      config: cfg({ disabledRuleIds: ['env'] }),
    });
    expect(r.decision).toBe('allow');
  });

  it('custom user glob matches', () => {
    const rule: SecretRule = { id: 'company-token', glob: '**/company.token', source: 'user' };
    const r = evaluateSecretAccess('/proj/config/company.token', {
      toolId: 'claude-code',
      config: cfg({ customRules: [rule] }),
    });
    expect(r.decision).toBe('block');
    expect(r.matched.some((m) => m.ruleId === 'company-token')).toBe(true);
  });

  it('empty path → allow', () => {
    expect(evaluateSecretAccess('', { toolId: 'claude-code', config: cfg() }).decision).toBe('allow');
    expect(evaluateSecretAccess('   ', { toolId: 'claude-code', config: cfg() }).decision).toBe('allow');
  });

  it('effectiveSecretRules drops disabled core rules and includes custom', () => {
    const rule: SecretRule = { id: 'x', glob: 'x', source: 'user' };
    const rules = effectiveSecretRules(cfg({ disabledRuleIds: ['env'], customRules: [rule] }));
    expect(rules.some((r) => r.id === 'env')).toBe(false);
    expect(rules.some((r) => r.id === 'x')).toBe(true);
  });
});

// ── Glob compiler edge cases ────────────────────────────────────────────────────

describe('compileGlob', () => {
  it('basename glob matches at any depth', () => {
    expect(compileGlob('.env').test('/a/b/c/.env')).toBe(true);
    expect(compileGlob('.env').test('.env')).toBe(true);
  });
  it('* does not cross directory boundaries', () => {
    expect(compileGlob('*.pem').test('/a/b/x.pem')).toBe(true);
    expect(compileGlob('*.pem').test('/a/b.pem/x')).toBe(false);
  });
  it('** spans directories', () => {
    expect(compileGlob('**/.ssh/**').test('/home/u/.ssh/keys/id_rsa')).toBe(true);
  });
  it('secrets/** matches contents anywhere', () => {
    expect(compileGlob('secrets/**').test('/proj/sub/secrets/a/b.txt')).toBe(true);
    expect(compileGlob('secrets/**').test('/proj/secrets-backup/x')).toBe(false);
  });
});

// ── isGlobSafe tripwire ─────────────────────────────────────────────────────────

describe('isGlobSafe', () => {
  it('accepts normal globs', () => {
    expect(isGlobSafe('*.pem').ok).toBe(true);
    expect(isGlobSafe('**/.ssh/**').ok).toBe(true);
  });
  it('rejects empty', () => {
    expect(isGlobSafe('   ').ok).toBe(false);
  });
  it('rejects catch-all globs', () => {
    expect(isGlobSafe('*').ok).toBe(false);
    expect(isGlobSafe('**').ok).toBe(false);
    expect(isGlobSafe('**/*').ok).toBe(false);
  });
  it('rejects overlong', () => {
    expect(isGlobSafe('a'.repeat(300)).ok).toBe(false);
  });
});

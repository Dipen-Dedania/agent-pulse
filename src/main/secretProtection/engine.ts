// Pure Secret Protection evaluation engine.
//
// Inputs: a file path (from a read-class tool call) + context (toolId, config).
// Output: a SecretAccessEvaluation describing what matched and what to do.
//
// Like guardrails/engine.ts, this imports nothing from electron or fs — it's
// safe to unit-test and reuse. Rules are .gitignore-style globs, compiled to
// RegExp by a small in-house matcher (no extra dependency) and cached.

import os from 'os';
import {
  SecretAccessDecision,
  SecretAccessEvaluation,
  SecretMatch,
  SecretProtectionConfig,
  SecretRule,
} from '../../common/secretProtection';
import { BLOCKABLE_TOOLS } from '../../common/guardrails';
import { ToolId } from '../../common/types';
import { CORE_SECRET_RULES } from './rules.core';

export interface EvaluateSecretContext {
  toolId: ToolId;
  config?: SecretProtectionConfig; // when omitted, uses defaults (enabled + core rules)
}

const DEFAULT_CONFIG: SecretProtectionConfig = {
  enabled: true,
  disabledRuleIds: [],
  customRules: [],
  scope: 'global',
  writeIgnoreFiles: true,
  hookBlocking: true,
};

// ── Glob → RegExp compiler ─────────────────────────────────────────────────────
// Handles the .gitignore-style dialect we use: `**` spans path segments, `*`
// matches within a segment, `?` matches one non-slash char, `~/` expands to the
// home directory. Anchoring:
//   - basename-only glob (no '/')  → matches the file at any depth
//   - rooted glob ('/', 'C:/', ~/) → anchored at the start of the path
//   - relative glob with a '/'     → matches anywhere as a path suffix
const matcherCache = new Map<string, RegExp>();

function homeDir(): string {
  try {
    return os.homedir().replace(/\\/g, '/');
  } catch {
    return '';
  }
}

export function compileGlob(glob: string): RegExp {
  const cached = matcherCache.get(glob);
  if (cached) return cached;

  let g = glob.trim().replace(/\\/g, '/');
  if (g === '~') g = homeDir();
  else if (g.startsWith('~/')) g = `${homeDir()}/${g.slice(2)}`;

  const rooted = /^([a-zA-Z]:\/|\/)/.test(g);
  const hasSlash = g.includes('/');

  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        // `**` — spans directory segments.
        if (g[i + 2] === '/') {
          re += '(?:.*/)?'; // `**/` → optional leading dirs
          i += 2;           // consume the second '*' and the '/'
        } else {
          re += '.*';       // bare/trailing `**`
          i += 1;           // consume the second '*'
        }
      } else {
        re += '[^/]*';      // single `*` — within one segment
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (/[.+^${}()|[\]\\]/.test(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }

  // Basename and relative-with-slash globs both match anywhere; rooted globs
  // anchor at the start. The `(?:^|/)` prefix gives a path-segment boundary so
  // `*.pem` can't match e.g. `notapem`.
  const body = rooted ? `^${re}$` : `(?:^|/)${re}$`;
  const compiled = new RegExp(body, 'i'); // file systems are effectively case-insensitive on win/mac
  matcherCache.set(glob, compiled);
  return compiled;
}

// Normalize a raw file path for matching: backslashes → '/', expand a leading
// `~`. Does not resolve relative paths against a cwd (we have none here) — the
// `(?:^|/)` anchoring in compileGlob handles relative inputs.
export function normalizeReadPath(filePath: string): string {
  let p = filePath.trim().replace(/\\/g, '/');
  if (p === '~') return homeDir();
  if (p.startsWith('~/')) p = `${homeDir()}/${p.slice(2)}`;
  return p;
}

// Cheap tripwire for user-supplied globs, à la guardrails' isPatternSafe. Not a
// sandbox — rejects empties, overlong patterns, and catch-all globs that would
// flag every read (which would be useless and alarming).
export function isGlobSafe(glob: string): { ok: boolean; reason?: string } {
  const g = (glob ?? '').trim();
  if (!g) return { ok: false, reason: 'glob is empty' };
  if (g.length > 200) return { ok: false, reason: 'glob too long (>200 chars)' };
  const tooBroad = new Set(['*', '**', '/', '~', '**/*', '*/**', '**/**', '*.*']);
  if (tooBroad.has(g)) return { ok: false, reason: 'glob matches everything' };
  try {
    compileGlob(g);
  } catch (e) {
    return { ok: false, reason: `invalid glob: ${(e as Error).message}` };
  }
  return { ok: true };
}

// The active rule set for a config: core rules minus disabled, plus custom
// rules. Exported so the Layer-1 fan-out writer (secret-files.ts) and the main
// process can share the exact same effective list the engine evaluates.
export function effectiveSecretRules(config?: SecretProtectionConfig): SecretRule[] {
  const cfg = config ?? DEFAULT_CONFIG;
  const disabled = new Set(cfg.disabledRuleIds);
  return [
    ...CORE_SECRET_RULES.filter((r) => !disabled.has(r.id)),
    ...cfg.customRules.filter((r) => !disabled.has(r.id)),
  ];
}

// Main entry point. Returns an evaluation describing the effective decision
// after applying blockability for the target tool: any glob match → `block`,
// downgraded to `warn` when the tool can't honour a deny (mirrors
// guardrails/engine.ts:101).
export function evaluateSecretAccess(filePath: string, ctx: EvaluateSecretContext): SecretAccessEvaluation {
  const blockable = BLOCKABLE_TOOLS[ctx.toolId] ?? false;
  const config = ctx.config ?? DEFAULT_CONFIG;

  if (!config.enabled || !filePath || !filePath.trim()) {
    return { decision: 'allow', matched: [], blockable };
  }

  const path = normalizeReadPath(filePath);
  const rules = effectiveSecretRules(config);
  const matched: SecretMatch[] = [];

  for (const rule of rules) {
    let re: RegExp;
    try {
      re = compileGlob(rule.glob);
    } catch {
      continue; // bad glob — skip silently; UI validation prevents this for user rules
    }
    if (re.test(path)) {
      matched.push({ ruleId: rule.id, glob: rule.glob, message: rule.message });
    }
  }

  let decision: SecretAccessDecision = 'allow';
  if (matched.length > 0) decision = blockable ? 'block' : 'warn';

  return { decision, matched, blockable };
}

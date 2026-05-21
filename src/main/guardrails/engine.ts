// Pure guardrail evaluation engine.
//
// Inputs: a raw shell command string + context (OS family, toolId).
// Output: a GuardrailEvaluation describing what matched and what to do.
//
// This module imports nothing from electron or fs — it's safe to unit-test
// and easy to reuse elsewhere (e.g. an MCP server in the future).

import {
  BLOCKABLE_TOOLS,
  GuardrailConfig,
  GuardrailDecision,
  GuardrailEvaluation,
  GuardrailMatch,
  GuardrailOs,
  GuardrailRule,
} from '../../common/guardrails';
import { ToolId } from '../../common/types';
import { CORE_RULES } from './rules.core';

export interface EvaluateContext {
  os: GuardrailOs;            // 'win' | 'mac' | 'linux'
  toolId: ToolId;
  config?: GuardrailConfig;   // when omitted, uses defaults (enabled + core rules only)
}

// Compile a rule's pattern. Built-in rules may already carry a RegExp; user
// rules are persisted as strings and compiled here. Throws if invalid — the
// caller is expected to catch and treat the rule as unusable.
function compile(rule: GuardrailRule): RegExp {
  if (rule.pattern instanceof RegExp) return rule.pattern;
  const flags = rule.flags ?? 'i';
  return new RegExp(rule.pattern, flags);
}

function osMatches(rule: GuardrailRule, os: GuardrailOs): boolean {
  return rule.os.includes('all') || rule.os.includes(os);
}

// Cheap ReDoS guard for user-supplied patterns. We reject obviously dangerous
// shapes (nested unbounded quantifiers) and overlong patterns. Not exhaustive
// — it's a tripwire, not a sandbox.
export function isPatternSafe(pattern: string): { ok: boolean; reason?: string } {
  if (pattern.length > 500) return { ok: false, reason: 'pattern too long (>500 chars)' };
  // (a+)+ / (a*)* / (a+)* / (.+)+ — classic catastrophic-backtracking shapes.
  if (/\([^)]*[+*][^)]*\)[+*]/.test(pattern)) {
    return { ok: false, reason: 'nested unbounded quantifiers' };
  }
  try {
    new RegExp(pattern);
  } catch (e) {
    return { ok: false, reason: `invalid regex: ${(e as Error).message}` };
  }
  return { ok: true };
}

// Main entry point. Returns an evaluation describing the effective decision
// after merging Tier 1/Tier 2 hits with blockability for the target tool.
//
// To add a new rule: edit src/main/guardrails/rules.core.ts (or persist a
// user rule via the Settings UI). The engine itself is rule-agnostic.
export function evaluateCommand(command: string, ctx: EvaluateContext): GuardrailEvaluation {
  const blockable = BLOCKABLE_TOOLS[ctx.toolId] ?? false;
  const config = ctx.config ?? { enabled: true, disabledRuleIds: [], customRules: [] };

  if (!config.enabled || !command || command.trim() === '') {
    return { decision: 'allow', matched: [], blockable };
  }

  const disabled = new Set(config.disabledRuleIds);
  const allRules: GuardrailRule[] = [
    ...CORE_RULES.filter(r => !disabled.has(r.id)),
    ...config.customRules.filter(r => !disabled.has(r.id)),
  ];

  const matched: GuardrailMatch[] = [];
  let sawBlock = false;
  let sawWarn = false;

  for (const rule of allRules) {
    if (!osMatches(rule, ctx.os)) continue;
    let re: RegExp;
    try {
      re = compile(rule);
    } catch {
      continue; // bad rule — skip silently; UI validation prevents this for user rules
    }
    if (!re.test(command)) continue;

    matched.push({
      ruleId: rule.id,
      tier: rule.tier,
      message: rule.message,
      suggestedFix: rule.suggestedFix,
    });
    if (rule.tier === 'mustBlock') sawBlock = true;
    else sawWarn = true;
  }

  let decision: GuardrailDecision = 'allow';
  if (sawBlock) decision = blockable ? 'block' : 'warn';
  else if (sawWarn) decision = 'warn';

  return { decision, matched, blockable };
}

// Convenience: derive the current OS family. Lives here so renderer and main
// can share it (renderer doesn't have process.platform, but main does).
export function detectOs(): GuardrailOs {
  if (typeof process === 'undefined') return 'all';
  switch (process.platform) {
    case 'win32': return 'win';
    case 'darwin': return 'mac';
    case 'linux': return 'linux';
    default: return 'all';
  }
}

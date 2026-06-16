import { ToolId } from './types';

// ── Secret Protection ─────────────────────────────────────────────────────────
// A *separate* guardrail family from the command guardrails in `guardrails.ts`.
// Command guardrails gate what an agent is allowed to *run*; Secret Protection
// gates what an agent is allowed to *read*. A rule here is a .gitignore-style
// glob (not a regex); the engine compiles globs → matchers.
//
// The evaluation engine (src/main/secretProtection/engine.ts) is a pure function
// and unit-testable, mirroring guardrails/engine.ts.

export type SecretAccessDecision = 'allow' | 'warn' | 'block';

export interface SecretRule {
  id: string;
  // .gitignore-style glob: '.env', '**/*.pem', '~/.ssh/**'. Persisted as a
  // string; the engine compiles it to a matcher once.
  glob: string;
  source: 'core' | 'user';
  message?: string;
}

// What the engine returns. `decision` collapses the effective outcome after
// applying blockability per tool: a match against a non-blockable tool
// downgrades from `block` to `warn` (visibility without enforcement).
export interface SecretAccessEvaluation {
  decision: SecretAccessDecision;
  matched: SecretMatch[];
  blockable: boolean;
}

export interface SecretMatch {
  ruleId: string;
  glob: string;
  message?: string;
}

// Broadcast to the renderer (Settings log + Bubble alert) every time the engine
// evaluates a non-allow file read. Mirrors GuardrailEvent.
export interface SecretAccessEvent {
  ts: number;
  toolId: ToolId;
  filePath: string;
  decision: SecretAccessDecision;
  matched: SecretMatch[];
  blockable: boolean;
  // True when the path was inferred from a shell command (cat/type/…) rather
  // than a structured Read tool call — best-effort, may have false positives.
  viaShell?: boolean;
}

// Persisted in UserConfig. `disabledRuleIds` silences individual core rules
// without deleting them; `customRules` carries user-defined globs.
// `enabled: false` is the master switch — engine returns `allow` for every
// read when off.
export interface SecretProtectionConfig {
  enabled: boolean;            // master switch
  disabledRuleIds: string[];   // silence core rules without deleting
  customRules: SecretRule[];
  scope: 'global' | 'project'; // default 'global' (see analysis §3)
  writeIgnoreFiles: boolean;   // Layer 1 toggle (default true)
  hookBlocking: boolean;       // Layer 2 toggle (default true)
}

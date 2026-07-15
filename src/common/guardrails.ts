import { ToolId } from './types';

// ── Guardrails ───────────────────────────────────────────────────────────────
// Two-tier safety rules that inspect a shell command before execution and
// classify it as `allow`, `warn`, or `block`. The engine is a pure function;
// see src/main/guardrails/engine.ts.

export type GuardrailTier = 'mustBlock' | 'warn';
export type GuardrailDecision = 'allow' | 'warn' | 'block';

// 'all' is a convenience that means every supported OS family.
export type GuardrailOs = 'win' | 'mac' | 'linux' | 'all';

export interface GuardrailRule {
  id: string;
  // Source-of-truth pattern. Persisted/serialized as a string; the engine
  // compiles it once when loading. Custom user rules are always strings;
  // built-in rules can supply a precompiled RegExp for convenience.
  pattern: string | RegExp;
  flags?: string;          // applied when `pattern` is a string
  os: GuardrailOs[];
  tier: GuardrailTier;
  message: string;
  suggestedFix?: string;
  // Built-in vs user-provided. Used by the UI to permit deletion of user
  // rules but not core rules (core rules can only be disabled).
  source: 'core' | 'user';
}

// What the engine returns. `decision` collapses the effective outcome after
// applying blockability per tool: a Tier-1 rule against a non-blockable tool
// downgrades to `warn`.
export interface GuardrailEvaluation {
  decision: GuardrailDecision;
  matched: GuardrailMatch[];
  blockable: boolean; // whether the originating tool supports blocking
}

export interface GuardrailMatch {
  ruleId: string;
  tier: GuardrailTier;
  message: string;
  suggestedFix?: string;
}

// Broadcast to the renderer (Settings log + Bubble warning visual) every
// time the engine evaluates a non-allow command.
export interface GuardrailEvent {
  ts: number;
  toolId: ToolId;
  command: string;
  decision: GuardrailDecision;
  matched: GuardrailMatch[];
  blockable: boolean;
}

// Persisted in UserConfig. `disabledRuleIds` lets a user silence individual
// core rules without losing them; `customRules` carries fully user-defined
// rules. `enabled: false` is a master switch — engine returns `allow` for
// every command when this is off.
export interface GuardrailConfig {
  enabled: boolean;
  disabledRuleIds: string[];
  customRules: GuardrailRule[];
}

// Which tools we can actually block. Non-blockable tools still get warnings
// (downgraded from Tier 1) so the user has visibility, but execution proceeds.
// Codex, Claude Code and Antigravity expose a synchronous PreToolUse hook that
// reads a deny verdict and cancels the command (Codex: stdout
// hookSpecificOutput.permissionDecision="deny" or exit 2; Antigravity: stdout
// {"decision":"deny"}; Claude Code: native http hook response). Cursor (MCP
// ping only), Copilot and Kiro have no confirmed synchronous deny path, so they
// stay warn-only.
export const BLOCKABLE_TOOLS: Record<ToolId, boolean> = {
  'claude-code': true,
  'antigravity-cli': true,
  'openai-codex': true,
  // Grok uses the same native HTTP hook mechanism as Claude Code and reads a
  // Claude-compatible deny response (hookSpecificOutput.permissionDecision).
  'grok': true,
  'cursor': false,
  'vscode-copilot': false,
  'kiro': false,
};

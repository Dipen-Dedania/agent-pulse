import { describe, it, expect } from 'vitest';
import { buildBlockResponse } from '../server';
import { GuardrailEvaluation } from '../../../common/guardrails';

const evalFor = (): GuardrailEvaluation => ({
  decision: 'block',
  blockable: true,
  matched: [
    {
      ruleId: 'rm-rf-root',
      tier: 'mustBlock',
      message: 'Refusing to delete the filesystem root.',
      suggestedFix: 'Scope the path.',
    },
  ],
});

describe('buildBlockResponse — per-tool deny shape', () => {
  it('always carries the block markers the hook scripts grep for', () => {
    for (const toolId of ['claude-code', 'openai-codex', 'antigravity-cli'] as const) {
      const body = buildBlockResponse(toolId, evalFor());
      expect(body.status).toBe('blocked');
      expect(body.continue).toBe(false);
      // The shell scripts detect a block via the literal "status":"blocked".
      expect(JSON.stringify(body)).toContain('"status":"blocked"');
    }
  });

  it('Antigravity gets top-level decision:"deny" (its allow/deny protocol)', () => {
    const body = buildBlockResponse('antigravity-cli', evalFor());
    expect(body.decision).toBe('deny');
  });

  it('Codex gets legacy decision:"block" + permissionDecision:"deny"', () => {
    const body = buildBlockResponse('openai-codex', evalFor());
    // Codex rejects "deny" in the legacy field — it must be "block".
    expect(body.decision).toBe('block');
    expect(body.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(body.hookSpecificOutput.hookEventName).toBe('PreToolUse');
  });

  it('Claude Code keeps hookSpecificOutput.permissionDecision:"deny"', () => {
    const body = buildBlockResponse('claude-code', evalFor());
    expect(body.decision).toBe('block');
    expect(body.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('includes the matched rule id and message in the reason', () => {
    const body = buildBlockResponse('openai-codex', evalFor());
    expect(body.matchedRules).toContain('rm-rf-root');
    expect(body.reason).toContain('rm-rf-root');
    expect(body.hookSpecificOutput.permissionDecisionReason).toContain('Refusing to delete');
  });
});

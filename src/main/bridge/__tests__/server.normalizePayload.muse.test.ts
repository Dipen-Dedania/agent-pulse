import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { normalizePayload, buildBlockResponse } from '../server';
import { extractCommand } from '../../guardrails/extractCommand';
import { GuardrailEvaluation } from '../../../common/guardrails';

// ── Muse Code (Meta) ─────────────────────────────────────────────────────────
// Every payload here is a verbatim capture from Muse Code 1.4.1 (see
// fixtures/muse/NOTES.md), scrubbed of paths and with the conversation arrays
// elided. Muse's stdin is Claude Code's hook schema, so the bridge can only
// recognise it by the `_ap_tool` marker the shim injects.

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'muse');
const fixture = (name: string): any =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
// What the shim actually POSTs: the captured payload plus the injected fields.
const muse = (name: string, extra: object = {}) => ({
  _ap_tool: 'muse-code',
  agent_pid: 4242,
  agent_pid_chain: [4242, 4200],
  ...fixture(name),
  ...extra,
});

describe('Muse Code events (captured fixtures)', () => {
  it.each([
    ['SessionStart', 'idle-active'],
    ['UserPromptSubmit', 'working'],
    ['PreToolUse', 'working'],
    ['PermissionRequest', 'waiting'],
    // working, not idle: the model is called again after every tool result.
    ['PostToolUse', 'working'],
    ['PostToolUseFailure', 'error'],
    ['Stop', 'idle-active'],
    ['SessionEnd', 'idle-active'],
  ])('%s → %s', (name, state) => {
    const r = normalizePayload(muse(name));
    expect(r?.toolId).toBe('muse-code');
    expect(r?.state).toBe(state);
  });

  it('Notification with notification_type permission_prompt → waiting; other types → null', () => {
    const r = normalizePayload(muse('Notification'));
    expect(fixture('Notification').notification_type).toBe('permission_prompt');
    expect(r?.state).toBe('waiting');
    expect(normalizePayload(muse('Notification', { notification_type: 'info' }))).toBeNull();
  });

  it('per-LLM-call and reminder-subagent events are ignored', () => {
    for (const name of ['PreLLMCall', 'PostLLMCall.idle', 'PostLLMCall.toolcalls', 'SubagentStart', 'SubagentStop']) {
      expect(normalizePayload(muse(name)), name).toBeNull();
    }
  });

  it('SessionStart from auto-compaction is not a session boundary', () => {
    expect(normalizePayload(muse('SessionStart', { source: 'compact' }))).toBeNull();
  });

  it('carries sessionId, cwd, pid chain and the tool name', () => {
    const r = normalizePayload(muse('PreToolUse'));
    expect(r?.payload.sessionId).toBe(fixture('PreToolUse').session_id);
    expect(r?.payload.cwd).toBe(fixture('PreToolUse').cwd);
    expect(r?.payload.agentPid).toBe(4242);
    expect(r?.payload.agentPidChain).toEqual([4242, 4200]);
    expect(r?.payload.taskSummary).toBe('Tool: powershell');
  });

  it('keeps a real model id but drops the echo provider\'s "unknown"', () => {
    expect(normalizePayload(muse('PreToolUse'))?.payload.model).toBe('fake-model');
    expect(normalizePayload(muse('Stop', { model: 'unknown' }))?.payload.model).toBeUndefined();
  });

  it('PostToolUseFailure surfaces a bounded error excerpt', () => {
    const r = normalizePayload(muse('PostToolUseFailure'));
    expect(r?.state).toBe('error');
    expect(r?.payload.errorMessage).toContain('process exited with status 3');
    expect((r?.payload.errorMessage ?? '').length).toBeLessThanOrEqual(500);
  });

  it('without the shim marker a Muse payload is NOT classified as Muse (it is Claude-shaped)', () => {
    const r = normalizePayload(fixture('PreToolUse'));
    expect(r?.toolId).not.toBe('muse-code');
  });

  it('with the marker it is NOT misidentified as Claude Code or Copilot', () => {
    // permission_mode + session_id would otherwise select the Claude Code
    // branch; the Muse branch has to win because it runs first.
    const r = normalizePayload(muse('UserPromptSubmit'));
    expect(r?.toolId).toBe('muse-code');
    expect(r?.toolId).not.toBe('claude-code');
    expect(r?.toolId).not.toBe('vscode-copilot');
  });

  it('unknown event → null', () => {
    expect(normalizePayload(muse('Stop', { hook_event_name: 'WhoKnows' }))).toBeNull();
  });
});

describe('Muse Code guardrail plumbing', () => {
  it('extractCommand reads the shell command from the captured PreToolUse shape', () => {
    expect(extractCommand('muse-code', fixture('PreToolUse'))).toBe('echo agent-pulse-spike');
    expect(extractCommand('muse-code', fixture('PermissionRequest'))).toBe('git push --force origin main');
  });

  it('extractCommand ignores non-shell tools', () => {
    const readTool = { ...fixture('PreToolUse'), tool_name: 'read_file', tool_input: { path: 'a.txt' } };
    expect(extractCommand('muse-code', readTool)).toBeNull();
  });

  it('buildBlockResponse sends Muse only Claude-documented fields', () => {
    const evaluation: GuardrailEvaluation = {
      decision: 'block',
      blockable: true,
      matched: [{ ruleId: 'rm-rf-root', tier: 'mustBlock', message: 'Refusing to delete the filesystem root.', suggestedFix: 'Scope the path.' }],
    };
    const body = buildBlockResponse('muse-code', evaluation);
    // Muse fails the hook (and fails OPEN) on any of these — verified 1.4.1.
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('continue');
    expect(body).not.toHaveProperty('matchedRules');
    expect(Object.keys(body).sort()).toEqual(['decision', 'hookSpecificOutput', 'reason']);
    expect(body.decision).toBe('block');
    expect(body.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(body.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    // The shim greps for this literal to decide whether to relay the body.
    expect(JSON.stringify(body)).toContain('"permissionDecision":"deny"');
  });
});

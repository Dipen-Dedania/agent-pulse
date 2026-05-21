import { describe, it, expect } from 'vitest';
import { normalizePayload } from '../server';

// ── Helpers ──────────────────────────────────────────────────────────────────

const cc = (hook_event_name: string, extra: object = {}) => ({
  hook_event_name,
  session_id: 'sess-cc',
  transcript_path: 'C:\\Users\\test\\.claude\\projects\\my-project\\sess-cc.jsonl',
  cwd: '/workspace',
  permission_mode: 'acceptEdits',
  ...extra,
});

const codex = (hook_event_name: string) => ({
  _ap_tool: 'openai-codex',
  hook_event_name,
  session_id: 'sess-codex',
  // turn_id is only present on turn-scoped events (PreToolUse/PostToolUse/
  // UserPromptSubmit/Stop). Detection relies on _ap_tool, not turn_id.
  ...(hook_event_name === 'SessionStart' ? {} : { turn_id: 'turn-1' }),
  cwd: '/tmp',
});

const cursor = (hook_event_name: string) => ({
  hook_event_name,
  cursor_version: '0.40.0',
  conversation_id: 'conv-1',
});

const copilot = (hook_event_name: string) => ({
  hook_event_name,
  session_id: 'sess-copilot',
  transcript_path: 'C:\\Users\\test\\AppData\\Roaming\\Code\\User\\workspaceStorage\\abc\\GitHub.copilot-chat\\transcripts\\sess-copilot.jsonl',
  cwd: '/workspace',
});

const kiroByVersion = (hook_event_name: string) => ({
  hook_event_name,
  session_id: 'sess-kiro',
  kiro_version: '1.0.0',
  cwd: '/project',
});

// ── Claude Code ───────────────────────────────────────────────────────────────

describe('Claude Code events', () => {
  it('PreToolUse → working', () => {
    const r = normalizePayload(cc('PreToolUse', { tool_name: 'Read' }));
    expect(r?.toolId).toBe('claude-code');
    expect(r?.state).toBe('working');
    expect(r?.payload.taskSummary).toBe('Tool: Read');
  });

  it('SubagentStart → working', () => {
    expect(normalizePayload(cc('SubagentStart'))?.state).toBe('working');
  });

  it('UserPromptSubmit → working', () => {
    expect(normalizePayload(cc('UserPromptSubmit'))?.state).toBe('working');
  });

  it('Stop → idle-active', () => {
    expect(normalizePayload(cc('Stop'))?.state).toBe('idle-active');
  });

  it('PermissionRequest → waiting', () => {
    expect(normalizePayload(cc('PermissionRequest'))?.state).toBe('waiting');
  });

  it('Elicitation → waiting', () => {
    expect(normalizePayload(cc('Elicitation'))?.state).toBe('waiting');
  });

  it('PostToolUse → idle-active', () => {
    expect(normalizePayload(cc('PostToolUse'))?.state).toBe('idle-active');
  });

  it('SessionEnd → idle-active', () => {
    expect(normalizePayload(cc('SessionEnd'))?.state).toBe('idle-active');
  });

  it('StopFailure → error', () => {
    expect(normalizePayload(cc('StopFailure'))?.state).toBe('error');
  });

  it('PostToolUseFailure → error', () => {
    expect(normalizePayload(cc('PostToolUseFailure'))?.state).toBe('error');
  });

  it('unknown CC event → null', () => {
    expect(normalizePayload(cc('UnknownEvent'))).toBeNull();
  });

  it('CC with transcript_path is NOT misidentified as Copilot', () => {
    // Real Claude Code CLI payload — must not be routed to vscode-copilot
    const payload = {
      session_id: 'e52e2034-fdb0-4891-ac07-73d9c585a125',
      transcript_path: 'C:\\Users\\ZTI Tech Lead\\.claude\\projects\\E--DDrive-Github-agent-pulse\\e52e2034-fdb0-4891-ac07-73d9c585a125.jsonl',
      cwd: 'E:\\DDrive\\Github\\agent-pulse',
      permission_mode: 'acceptEdits',
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Hi! How can I help you with Agent Pulse today?',
    };
    const r = normalizePayload(payload);
    expect(r?.toolId).toBe('claude-code');
    expect(r?.state).toBe('idle-active');
  });
});

// ── Cursor ────────────────────────────────────────────────────────────────────

describe('Cursor events', () => {
  it('sessionStart → working', () => {
    expect(normalizePayload(cursor('sessionStart'))?.toolId).toBe('cursor');
    expect(normalizePayload(cursor('sessionStart'))?.state).toBe('working');
  });

  it('preToolUse → working', () => {
    expect(normalizePayload(cursor('preToolUse'))?.state).toBe('working');
  });

  it('postToolUse → idle-active', () => {
    expect(normalizePayload(cursor('postToolUse'))?.state).toBe('idle-active');
  });

  it('stop → idle-active', () => {
    expect(normalizePayload(cursor('stop'))?.state).toBe('idle-active');
  });

  it('sessionEnd → idle-active', () => {
    expect(normalizePayload(cursor('sessionEnd'))?.state).toBe('idle-active');
  });

  it('postToolUseFailure → error', () => {
    expect(normalizePayload(cursor('postToolUseFailure'))?.state).toBe('error');
  });

  it('unknown Cursor event → null', () => {
    expect(normalizePayload(cursor('unknownEvent'))).toBeNull();
  });

  it('Cursor with transcript_path is still detected as Cursor (not Copilot)', () => {
    // Cursor sends transcript_path in its base payload — must not be misrouted to Copilot.
    const payload = {
      hook_event_name: 'preToolUse',
      cursor_version: '0.50.0',
      conversation_id: 'conv-2',
      transcript_path: 'C:\\Users\\test\\cursor-transcripts\\conv-2.jsonl',
      workspace_roots: ['C:\\project'],
      user_email: null,
    };
    const r = normalizePayload(payload);
    expect(r?.toolId).toBe('cursor');
    expect(r?.state).toBe('working');
  });

  it('Cursor with null transcript_path is still detected as Cursor', () => {
    const payload = {
      hook_event_name: 'postToolUse',
      cursor_version: '0.50.0',
      conversation_id: 'conv-3',
      transcript_path: null,
    };
    const r = normalizePayload(payload);
    expect(r?.toolId).toBe('cursor');
    expect(r?.state).toBe('idle-active');
  });
});

// ── VS Code Copilot ───────────────────────────────────────────────────────────

describe('VS Code Copilot events', () => {
  it('SessionStart → working', () => {
    expect(normalizePayload(copilot('SessionStart'))?.toolId).toBe('vscode-copilot');
    expect(normalizePayload(copilot('SessionStart'))?.state).toBe('working');
  });

  it('UserPromptSubmit → working', () => {
    expect(normalizePayload(copilot('UserPromptSubmit'))?.state).toBe('working');
  });

  it('PreToolUse → working', () => {
    expect(normalizePayload(copilot('PreToolUse'))?.state).toBe('working');
  });

  it('PreCompact → working', () => {
    expect(normalizePayload(copilot('PreCompact'))?.state).toBe('working');
  });

  it('SubagentStart → working', () => {
    expect(normalizePayload(copilot('SubagentStart'))?.state).toBe('working');
  });

  it('PostToolUse → idle-active', () => {
    expect(normalizePayload(copilot('PostToolUse'))?.state).toBe('idle-active');
  });

  it('Stop → idle-active', () => {
    expect(normalizePayload(copilot('Stop'))?.state).toBe('idle-active');
  });

  it('SubagentStop → idle-active', () => {
    expect(normalizePayload(copilot('SubagentStop'))?.state).toBe('idle-active');
  });

  it('unknown Copilot event → null', () => {
    expect(normalizePayload(copilot('UnknownEvent'))).toBeNull();
  });
});

// ── OpenAI Codex ──────────────────────────────────────────────────────────────

describe('OpenAI Codex events', () => {
  it('SessionStart → working', () => {
    expect(normalizePayload(codex('SessionStart'))?.toolId).toBe('openai-codex');
    expect(normalizePayload(codex('SessionStart'))?.state).toBe('working');
  });

  it('UserPromptSubmit → working', () => {
    expect(normalizePayload(codex('UserPromptSubmit'))?.state).toBe('working');
  });

  it('PreToolUse → working', () => {
    expect(normalizePayload(codex('PreToolUse'))?.state).toBe('working');
  });

  it('PostToolUse → idle-active', () => {
    expect(normalizePayload(codex('PostToolUse'))?.state).toBe('idle-active');
  });

  it('Stop → idle-active', () => {
    expect(normalizePayload(codex('Stop'))?.state).toBe('idle-active');
  });

  it('PermissionRequest → waiting', () => {
    expect(normalizePayload(codex('PermissionRequest'))?.state).toBe('waiting');
  });

  it('unknown Codex event → null', () => {
    expect(normalizePayload(codex('UnknownEvent'))).toBeNull();
  });
});

// ── Kiro ──────────────────────────────────────────────────────────────────────

describe('Kiro events', () => {
  it('agentSpawn → working (detected by event name)', () => {
    // agentSpawn is unique to Kiro — detected without kiro_version
    const r = normalizePayload({ hook_event_name: 'agentSpawn', session_id: 'sess-kiro', cwd: '/project' });
    expect(r?.toolId).toBe('kiro');
    expect(r?.state).toBe('working');
  });

  it('userPromptSubmit → working (kiro_version discriminator)', () => {
    expect(normalizePayload(kiroByVersion('userPromptSubmit'))?.toolId).toBe('kiro');
    expect(normalizePayload(kiroByVersion('userPromptSubmit'))?.state).toBe('working');
  });

  it('preToolUse → working', () => {
    expect(normalizePayload(kiroByVersion('preToolUse'))?.state).toBe('working');
  });

  it('postToolUse → idle-active', () => {
    expect(normalizePayload(kiroByVersion('postToolUse'))?.state).toBe('idle-active');
  });

  it('unknown Kiro event → null', () => {
    expect(normalizePayload(kiroByVersion('unknownEvent'))).toBeNull();
  });
});

// ── Antigravity CLI ──────────────────────────────────────────────────────────

// Antigravity stdin uses camelCase; our hook script injects _ap_tool +
// hook_event_name before forwarding to the bridge.
const antigravity = (hook_event_name: string, extra: object = {}) => ({
  hook_event_name,
  _ap_tool: 'antigravity-cli',
  conversationId: 'conv-agy',
  ...extra,
});

describe('Antigravity CLI events', () => {
  it('PreInvocation → working', () => {
    const r = normalizePayload(antigravity('PreInvocation'));
    expect(r?.toolId).toBe('antigravity-cli');
    expect(r?.state).toBe('working');
  });

  it('PreToolUse → working', () => {
    expect(normalizePayload(antigravity('PreToolUse', { toolCall: { name: 'run_command', args: {} } }))?.state).toBe('working');
  });

  it('PostToolUse → working (loop continues)', () => {
    expect(normalizePayload(antigravity('PostToolUse'))?.state).toBe('working');
  });

  it('PostInvocation → idle-active (turn complete)', () => {
    expect(normalizePayload(antigravity('PostInvocation'))?.state).toBe('idle-active');
  });

  it('Stop → idle-active', () => {
    expect(normalizePayload(antigravity('Stop'))?.state).toBe('idle-active');
  });

  it('unknown Antigravity event → null', () => {
    expect(normalizePayload(antigravity('UnknownEvent'))).toBeNull();
  });

  it('extracts conversationId into payload.sessionId', () => {
    const r = normalizePayload(antigravity('PreToolUse'));
    expect(r?.payload.sessionId).toBe('conv-agy');
  });

  it('extracts toolCall.name into payload.taskSummary', () => {
    const r = normalizePayload(antigravity('PreToolUse', { toolCall: { name: 'run_command', args: {} } }));
    expect(r?.payload.taskSummary).toBe('Tool: run_command');
  });

  it('Antigravity with PascalCase events is NOT misidentified as Claude Code', () => {
    // Antigravity uses PascalCase events overlapping with CC (PreToolUse/PostToolUse/Stop),
    // but the _ap_tool marker disambiguates.
    const payload = {
      hook_event_name: 'PreToolUse',
      _ap_tool: 'antigravity-cli',
      conversationId: 'agy-conv-1',
    };
    const r = normalizePayload(payload);
    expect(r?.toolId).toBe('antigravity-cli');
    expect(r?.toolId).not.toBe('claude-code');
  });
});

// ── Format 1: Explicit toolId + state ────────────────────────────────────────

describe('Explicit format (Format 1)', () => {
  it('accepts explicit claude-code working', () => {
    const r = normalizePayload({ toolId: 'claude-code', state: 'working', payload: { taskSummary: 'test' } });
    expect(r?.toolId).toBe('claude-code');
    expect(r?.state).toBe('working');
    expect(r?.payload.taskSummary).toBe('test');
  });

  it('accepts explicit kiro idle', () => {
    const r = normalizePayload({ toolId: 'kiro', state: 'idle' });
    expect(r?.toolId).toBe('kiro');
    expect(r?.state).toBe('idle');
  });

  it('rejects unknown toolId', () => {
    expect(normalizePayload({ toolId: 'unknown-tool', state: 'working' })).toBeNull();
  });

  it('rejects unknown state', () => {
    expect(normalizePayload({ toolId: 'claude-code', state: 'flying' })).toBeNull();
  });
});

// ── Garbage input ─────────────────────────────────────────────────────────────

describe('Unrecognized payloads', () => {
  it('empty object → null', () => {
    expect(normalizePayload({})).toBeNull();
  });

  it('random fields → null', () => {
    expect(normalizePayload({ foo: 'bar', baz: 42 })).toBeNull();
  });
});

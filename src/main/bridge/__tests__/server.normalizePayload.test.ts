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
  hook_event_name,
  session_id: 'sess-codex',
  turn_id: 'turn-1',
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

  it('Stop → waiting', () => {
    expect(normalizePayload(cc('Stop'))?.state).toBe('waiting');
  });

  it('PostToolUse → idle', () => {
    expect(normalizePayload(cc('PostToolUse'))?.state).toBe('idle');
  });

  it('SessionEnd → idle', () => {
    expect(normalizePayload(cc('SessionEnd'))?.state).toBe('idle');
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
    expect(r?.state).toBe('waiting');
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

  it('postToolUse → idle', () => {
    expect(normalizePayload(cursor('postToolUse'))?.state).toBe('idle');
  });

  it('stop → waiting', () => {
    expect(normalizePayload(cursor('stop'))?.state).toBe('waiting');
  });

  it('sessionEnd → idle', () => {
    expect(normalizePayload(cursor('sessionEnd'))?.state).toBe('idle');
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
    expect(r?.state).toBe('idle');
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

  it('PostToolUse → idle', () => {
    expect(normalizePayload(copilot('PostToolUse'))?.state).toBe('idle');
  });

  it('Stop → waiting', () => {
    expect(normalizePayload(copilot('Stop'))?.state).toBe('waiting');
  });

  it('SubagentStop → idle', () => {
    expect(normalizePayload(copilot('SubagentStop'))?.state).toBe('idle');
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

  it('PostToolUse → idle', () => {
    expect(normalizePayload(codex('PostToolUse'))?.state).toBe('idle');
  });

  it('Stop → waiting', () => {
    expect(normalizePayload(codex('Stop'))?.state).toBe('waiting');
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

  it('postToolUse → idle', () => {
    expect(normalizePayload(kiroByVersion('postToolUse'))?.state).toBe('idle');
  });

  it('unknown Kiro event → null', () => {
    expect(normalizePayload(kiroByVersion('unknownEvent'))).toBeNull();
  });
});

// ── Gemini CLI ───────────────────────────────────────────────────────────────

const gemini = (hook_event_name: string, extra: object = {}) => ({
  hook_event_name,
  _ap_tool: 'gemini-cli',
  session_id: 'sess-gemini',
  ...extra,
});

describe('Gemini CLI events', () => {
  it('SessionStart → working', () => {
    const r = normalizePayload(gemini('SessionStart'));
    expect(r?.toolId).toBe('gemini-cli');
    expect(r?.state).toBe('working');
  });

  it('BeforeAgent → working', () => {
    expect(normalizePayload(gemini('BeforeAgent'))?.state).toBe('working');
  });

  it('BeforeTool → working', () => {
    expect(normalizePayload(gemini('BeforeTool', { tool_name: 'write_file' }))?.state).toBe('working');
  });

  it('BeforeModel → working', () => {
    expect(normalizePayload(gemini('BeforeModel'))?.state).toBe('working');
  });

  it('BeforeToolSelection → working', () => {
    expect(normalizePayload(gemini('BeforeToolSelection'))?.state).toBe('working');
  });

  it('AfterAgent → waiting', () => {
    expect(normalizePayload(gemini('AfterAgent'))?.state).toBe('waiting');
  });

  it('Notification → waiting', () => {
    expect(normalizePayload(gemini('Notification'))?.state).toBe('waiting');
  });

  it('SessionEnd → idle', () => {
    expect(normalizePayload(gemini('SessionEnd'))?.state).toBe('idle');
  });

  it('AfterTool → idle', () => {
    expect(normalizePayload(gemini('AfterTool'))?.state).toBe('idle');
  });

  it('AfterModel → idle', () => {
    expect(normalizePayload(gemini('AfterModel'))?.state).toBe('idle');
  });

  it('unknown Gemini event → null', () => {
    expect(normalizePayload(gemini('UnknownEvent'))).toBeNull();
  });

  it('extracts session_id into payload.sessionId', () => {
    const r = normalizePayload(gemini('BeforeAgent'));
    expect(r?.payload.sessionId).toBe('sess-gemini');
  });

  it('extracts tool_name into payload.taskSummary', () => {
    const r = normalizePayload(gemini('BeforeTool', { tool_name: 'read_file' }));
    expect(r?.payload.taskSummary).toBe('Tool: read_file');
  });

  it('Gemini with PascalCase events is NOT misidentified as Claude Code', () => {
    // Gemini uses PascalCase events like CC, but has _ap_tool: 'gemini-cli'
    const payload = {
      hook_event_name: 'SessionStart',
      _ap_tool: 'gemini-cli',
      session_id: 'gemini-sess-1',
    };
    const r = normalizePayload(payload);
    expect(r?.toolId).toBe('gemini-cli');
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

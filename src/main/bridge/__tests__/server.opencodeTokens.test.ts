import { describe, it, expect } from 'vitest';
import { normalizePayload, sanitizeInlineTokens } from '../server';
import { extractCommand } from '../../guardrails/extractCommand';

// OpenCode reaches the bridge through our in-process plugin rather than a shell
// hook, so it posts the Format 1 envelope directly. These cover the two things
// that envelope adds: an inline token delta (no transcript to parse) and
// top-level guardrail fields.

const envelope = (state: string, payload: object = {}, top: object = {}) => ({
  toolId: 'opencode',
  state,
  payload: { cwd: '/workspace', agentPid: 4321, ...payload },
  ...top,
});

describe('normalizePayload — OpenCode Format 1 envelope', () => {
  it('accepts every state the plugin emits', () => {
    for (const state of ['working', 'waiting', 'idle', 'idle-active', 'error']) {
      const out = normalizePayload(envelope(state));
      expect(out, state).not.toBeNull();
      expect(out!.toolId).toBe('opencode');
      expect(out!.state).toBe(state);
    }
  });

  it('carries sessionId, cwd, model and activeAgents through', () => {
    const out = normalizePayload(
      envelope('working', { sessionId: 'ses_abc', model: 'claude-sonnet-4-5', activeAgents: 2 }),
    );
    expect(out!.payload).toMatchObject({
      sessionId: 'ses_abc',
      cwd: '/workspace',
      model: 'claude-sonnet-4-5',
      activeAgents: 2,
      agentPid: 4321,
    });
  });

  it('preserves a well-formed inline token delta', () => {
    const out = normalizePayload(
      envelope('working', {
        sessionId: 'ses_abc',
        tokens: { model: 'claude-sonnet-4-5', tokensIn: 120, tokensOut: 45, cacheRead: 900, cacheWrite: 10 },
      }),
    );
    expect(out!.payload.tokens).toEqual({
      model: 'claude-sonnet-4-5',
      tokensIn: 120,
      tokensOut: 45,
      cacheRead: 900,
      cacheWrite: 10,
    });
  });

  it('drops a malformed token delta rather than passing it to the timeline', () => {
    const out = normalizePayload(
      envelope('working', { sessionId: 'ses_abc', tokens: { tokensIn: 'lots', tokensOut: null } }),
    );
    expect(out).not.toBeNull();
    expect(out!.payload.tokens).toBeUndefined();
  });

  it('rejects an unknown toolId even with a valid state', () => {
    expect(normalizePayload({ toolId: 'opencode-nightly', state: 'working' })).toBeNull();
  });
});

describe('sanitizeInlineTokens', () => {
  it('floors fractional counts and keeps the model label', () => {
    expect(sanitizeInlineTokens({ model: 'gpt-5', tokensIn: 10.9, tokensOut: 2.2 })).toEqual({
      model: 'gpt-5',
      tokensIn: 10,
      tokensOut: 2,
      cacheRead: undefined,
      cacheWrite: undefined,
    });
  });

  it('coerces numeric strings', () => {
    expect(sanitizeInlineTokens({ tokensIn: '50' })?.tokensIn).toBe(50);
  });

  it('rejects negatives, NaN and absurd values', () => {
    expect(sanitizeInlineTokens({ tokensIn: -5 })).toBeNull();
    expect(sanitizeInlineTokens({ tokensIn: NaN })).toBeNull();
    expect(sanitizeInlineTokens({ tokensIn: Number.MAX_SAFE_INTEGER })).toBeNull();
  });

  it('returns null for an all-zero delta so no empty usage row is written', () => {
    expect(sanitizeInlineTokens({ tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });

  it('returns null for non-objects', () => {
    expect(sanitizeInlineTokens(null)).toBeNull();
    expect(sanitizeInlineTokens('120')).toBeNull();
  });

  it('truncates an over-long model label', () => {
    const out = sanitizeInlineTokens({ model: 'm'.repeat(500), tokensIn: 1 });
    expect(out!.model!.length).toBe(200);
  });
});

describe('extractCommand — OpenCode', () => {
  it('reads the command off the top level for the bash tool', () => {
    const body = envelope('working', {}, { toolName: 'bash', command: 'rm -rf /tmp/x' });
    expect(extractCommand('opencode', body)).toBe('rm -rf /tmp/x');
  });

  it('ignores non-shell tools', () => {
    const body = envelope('working', {}, { toolName: 'read', command: 'not-a-shell-call' });
    expect(extractCommand('opencode', body)).toBeNull();
  });

  it('returns null when no command is present', () => {
    expect(extractCommand('opencode', envelope('working', {}, { toolName: 'bash' }))).toBeNull();
  });
});

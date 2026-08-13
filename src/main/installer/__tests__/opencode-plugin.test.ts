import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { ConfigWriter } from '../config-writer';

// Loads the ACTUAL generated plugin source and drives its hooks, so the state
// machine is tested as shipped rather than as a re-implementation. Event shapes
// below are copied from a real OpenCode 1.18.18 event trace.

type Post = { toolId: string; state: string; payload: any; toolName?: string; command?: string };

let hooks: any;
let posts: Post[];
let pluginFile: string;
let AgentPulse: any;

const status = (sessionID: string, type: 'busy' | 'idle' | 'retry') => ({
  event: { type: 'session.status', properties: { sessionID, status: { type } } },
});

const sessionUpdated = (sessionID: string, modelId: string) => ({
  event: {
    type: 'session.updated',
    properties: { sessionID, info: { id: sessionID, model: { id: modelId, providerID: 'anthropic' } } },
  },
});

const sessionError = (sessionID: string, message: string) => ({
  event: {
    type: 'session.error',
    properties: { sessionID, error: { name: 'UnknownError', data: { message } } },
  },
});

const assistantMessage = (
  sessionID: string,
  id: string,
  tokens: any,
  opts: { completed?: boolean; modelID?: string } = {},
) => ({
  event: {
    type: 'message.updated',
    properties: {
      sessionID,
      info: {
        id,
        sessionID,
        role: 'assistant',
        modelID: opts.modelID ?? 'claude-sonnet-4-5',
        providerID: 'anthropic',
        time: { created: 1, ...(opts.completed === false ? {} : { completed: 2 }) },
        tokens,
      },
    },
  },
});

const states = () => posts.map((p) => p.state);

beforeAll(async () => {
  const src = (new ConfigWriter() as any).buildOpencodePlugin();
  // Must live under the project root — Vite's resolver won't load an ESM file
  // from the OS temp dir. node_modules/.tmp is inside the root and ignored.
  const tmpDir = path.join(process.cwd(), 'node_modules', '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  pluginFile = path.join(tmpDir, `agent-pulse-opencode-plugin-${process.pid}.mjs`);
  fs.writeFileSync(pluginFile, src, 'utf8');
  ({ AgentPulse } = await import(pathToFileURL(pluginFile).href));
});

afterAll(() => {
  try { fs.unlinkSync(pluginFile); } catch { /* ignore */ }
});

beforeEach(async () => {
  posts = [];
  vi.stubGlobal('fetch', (_url: string, init: any) => {
    posts.push(JSON.parse(init.body));
    return Promise.resolve({ ok: true });
  });
  hooks = await AgentPulse({ directory: '/workspace', worktree: '/worktree' });
});

describe('OpenCode plugin — state mapping', () => {
  it('maps busy to working and idle to idle-active', async () => {
    await hooks.event(status('s1', 'busy'));
    await hooks.event(status('s1', 'idle'));
    expect(states()).toEqual(['working', 'idle-active']);
  });

  it('treats retry as still working, not as an error', async () => {
    await hooks.event(status('s1', 'retry'));
    expect(states()).toEqual(['working']);
  });

  it('prefers the worktree over the directory for cwd', async () => {
    await hooks.event(status('s1', 'busy'));
    expect(posts[0].payload.cwd).toBe('/worktree');
  });

  it('maps permission.asked to waiting and permission.replied back to working', async () => {
    await hooks.event({ event: { type: 'permission.asked', properties: { sessionID: 's1' } } });
    await hooks.event({ event: { type: 'permission.replied', properties: { sessionID: 's1' } } });
    expect(states()).toEqual(['waiting', 'working']);
  });

  it('ignores session.idle once session.status has been seen (no duplicate events)', async () => {
    await hooks.event(status('s1', 'busy'));
    await hooks.event(status('s1', 'idle'));
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    expect(states()).toEqual(['working', 'idle-active']);
  });

  it('falls back to session.idle when no session.status was ever emitted', async () => {
    await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 's1' } } });
    expect(states()).toEqual(['idle-active']);
  });

  it('maps session.deleted to idle', async () => {
    await hooks.event({ event: { type: 'session.deleted', properties: { sessionID: 's1' } } });
    expect(states()).toEqual(['idle']);
  });

  it('ignores events it does not map', async () => {
    await hooks.event({ event: { type: 'file.edited', properties: { file: 'a.ts' } } });
    await hooks.event({ event: { type: 'session.created', properties: { sessionID: 's1' } } });
    expect(posts).toHaveLength(0);
  });
});

describe('OpenCode plugin — error latch', () => {
  // Verified upstream ordering: a failed turn emits session.error and THEN
  // session.status{idle}. Without the latch the red state would be overwritten.
  it('swallows the idle that follows an error', async () => {
    await hooks.event(status('s1', 'busy'));
    await hooks.event(sessionError('s1', 'Model not found'));
    await hooks.event(status('s1', 'idle'));
    expect(states()).toEqual(['working', 'error']);
  });

  it('reports the upstream error message', async () => {
    await hooks.event(sessionError('s1', 'Model not found: anthropic/x'));
    expect(posts[0].payload.errorMessage).toBe('Model not found: anthropic/x');
  });

  it('falls back to the error name when no message is present', async () => {
    await hooks.event({
      event: { type: 'session.error', properties: { sessionID: 's1', error: { name: 'ProviderAuthError' } } },
    });
    expect(posts[0].payload.errorMessage).toBe('ProviderAuthError');
  });

  it('clears the latch on the next turn so a later idle is reported', async () => {
    await hooks.event(sessionError('s1', 'boom'));
    await hooks.event(status('s1', 'idle'));   // swallowed
    await hooks.event(status('s1', 'busy'));   // new turn
    await hooks.event(status('s1', 'idle'));   // must be reported
    expect(states()).toEqual(['error', 'working', 'idle-active']);
  });
});

describe('OpenCode plugin — concurrent sessions', () => {
  // Subagents get their own session ids and their status events interleave, so
  // "working" has to be a count rather than the most recent event.
  it('stays working while any session is still busy', async () => {
    await hooks.event(status('parent', 'busy'));
    await hooks.event(status('child', 'busy'));
    await hooks.event(status('child', 'idle'));
    expect(states()).toEqual(['working', 'working', 'working']);
    expect(posts[posts.length - 1].payload.activeAgents).toBe(1);
  });

  it('reports idle-active only once the last session finishes', async () => {
    await hooks.event(status('parent', 'busy'));
    await hooks.event(status('child', 'busy'));
    await hooks.event(status('child', 'idle'));
    await hooks.event(status('parent', 'idle'));
    expect(states()[3]).toBe('idle-active');
    expect(posts[3].payload.activeAgents).toBe(0);
  });
});

describe('OpenCode plugin — token reporting', () => {
  const tokens = { input: 120, output: 45, reasoning: 0, cache: { read: 900, write: 10 } };

  it('reports a completed assistant message once', async () => {
    await hooks.event(assistantMessage('s1', 'msg1', tokens));
    const withTokens = posts.filter((p) => p.payload.tokens);
    expect(withTokens).toHaveLength(1);
    expect(withTokens[0].payload.tokens).toEqual({
      model: 'claude-sonnet-4-5',
      tokensIn: 120,
      tokensOut: 45,
      cacheRead: 900,
      cacheWrite: 10,
    });
  });

  it('does not double-count repeated updates for the same message', async () => {
    await hooks.event(assistantMessage('s1', 'msg1', tokens));
    await hooks.event(assistantMessage('s1', 'msg1', tokens));
    await hooks.event(assistantMessage('s1', 'msg1', tokens));
    expect(posts.filter((p) => p.payload.tokens)).toHaveLength(1);
  });

  it('ignores a message that is still streaming', async () => {
    await hooks.event(assistantMessage('s1', 'msg1', tokens, { completed: false }));
    expect(posts).toHaveLength(0);
  });

  it('ignores user messages', async () => {
    await hooks.event({
      event: {
        type: 'message.updated',
        properties: { sessionID: 's1', info: { id: 'u1', role: 'user', time: { created: 1, completed: 2 } } },
      },
    });
    expect(posts).toHaveLength(0);
  });

  it('counts separate messages separately', async () => {
    await hooks.event(assistantMessage('s1', 'msg1', tokens));
    await hooks.event(assistantMessage('s1', 'msg2', tokens));
    expect(posts.filter((p) => p.payload.tokens)).toHaveLength(2);
  });

  it('defaults missing token fields to zero rather than undefined', async () => {
    await hooks.event(assistantMessage('s1', 'msg1', { input: 5 }));
    expect(posts[0].payload.tokens).toEqual({
      model: 'claude-sonnet-4-5',
      tokensIn: 5,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it('reports working when the token arrives mid-turn', async () => {
    await hooks.event(status('s1', 'busy'));
    await hooks.event(assistantMessage('s1', 'msg1', tokens));
    expect(posts[1].state).toBe('working');
  });

  it('does not resurrect working when the token arrives after the turn ended', async () => {
    await hooks.event(status('s1', 'busy'));
    await hooks.event(status('s1', 'idle'));
    await hooks.event(assistantMessage('s1', 'msg1', tokens));
    expect(states()).toEqual(['working', 'idle-active', 'idle-active']);
    expect(posts[2].payload.tokens).toBeDefined();
  });

  it('keeps the error state when the token arrives after a failure', async () => {
    await hooks.event(sessionError('s1', 'boom'));
    await hooks.event(assistantMessage('s1', 'msg1', tokens));
    expect(states()).toEqual(['error', 'error']);
    // The usage is still recorded — a failed turn can still have burned tokens.
    expect(posts[1].payload.tokens).toBeDefined();
  });

  it('remembers the model from session.updated for later state events', async () => {
    await hooks.event(sessionUpdated('s1', 'gpt-5-codex'));
    await hooks.event(status('s1', 'busy'));
    expect(posts[0].payload.model).toBe('gpt-5-codex');
  });
});

describe('OpenCode plugin — tool.execute.before', () => {
  it('lifts guardrail fields to the top level and marks the session busy', async () => {
    await hooks['tool.execute.before'](
      { tool: 'bash', sessionID: 's1', callID: 'c1' },
      { args: { command: 'rm -rf /tmp/x' } },
    );
    expect(posts[0]).toMatchObject({
      toolId: 'opencode',
      state: 'working',
      toolName: 'bash',
      command: 'rm -rf /tmp/x',
    });
    expect(posts[0].payload.taskSummary).toBe('Tool: bash');
    expect(posts[0].payload.activeAgents).toBe(1);
  });

  it('omits command for tools that do not take one', async () => {
    await hooks['tool.execute.before']({ tool: 'read', sessionID: 's1' }, { args: { filePath: 'a.ts' } });
    expect(posts[0].command).toBeUndefined();
    expect(posts[0].toolName).toBe('read');
  });
});

describe('OpenCode plugin — resilience', () => {
  it('never throws when the bridge is unreachable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));
    const isolated = await AgentPulse({ directory: '/workspace' });
    await expect(isolated.event(status('s1', 'busy'))).resolves.toBeUndefined();
  });

  it('never throws when fetch is missing entirely', async () => {
    vi.stubGlobal('fetch', undefined);
    const isolated = await AgentPulse({ directory: '/workspace' });
    await expect(isolated.event(status('s1', 'busy'))).resolves.toBeUndefined();
  });

  it('tolerates malformed events', async () => {
    await expect(hooks.event({ event: {} })).resolves.toBeUndefined();
    await expect(hooks.event({ event: { type: 'session.status' } })).resolves.toBeUndefined();
    expect(states()).toEqual(['idle-active']); // status with no properties → treated as idle
  });
});

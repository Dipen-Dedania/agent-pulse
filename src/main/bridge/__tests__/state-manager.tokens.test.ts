import { describe, it, expect, vi } from 'vitest';
import { NormalizedEvent } from '../../../common/types';

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

import { StatusStateManager } from '../state-manager';
import { normalizePayload } from '../server';

// updateStatus rebuilds the event payload field-by-field for its listeners.
// OpenCode's inline token deltas were once dropped in that rebuild — the
// bridge sanitized them, but the timeline (which stages event.payload.tokens)
// never saw them. This covers the full hop: raw POST body → normalizePayload
// → updateStatus → onEvent listener.

const flushImmediate = () => new Promise((r) => setImmediate(r));

describe('StatusStateManager — inline token delta passthrough', () => {
  it('delivers payload.tokens from a normalized OpenCode post to event listeners', async () => {
    const manager = new StatusStateManager();
    const received: NormalizedEvent[] = [];
    manager.onEvent((e) => received.push(e));

    const normalized = normalizePayload({
      toolId: 'opencode',
      state: 'idle-active',
      payload: {
        sessionId: 'ses_abc',
        cwd: '/workspace',
        agentPid: 4321,
        tokens: { model: 'big-pickle', tokensIn: 6365, tokensOut: 27, cacheRead: 1792, cacheWrite: 0 },
      },
    });
    expect(normalized).not.toBeNull();

    manager.updateStatus(normalized!.toolId, normalized!.state, normalized!.payload);
    await flushImmediate();

    expect(received).toHaveLength(1);
    expect(received[0].payload.sessionId).toBe('ses_abc');
    expect(received[0].payload.tokens).toEqual({
      model: 'big-pickle',
      tokensIn: 6365,
      tokensOut: 27,
      cacheRead: 1792,
      cacheWrite: 0,
    });
  });

  it('leaves tokens undefined for events that carry none', async () => {
    const manager = new StatusStateManager();
    const received: NormalizedEvent[] = [];
    manager.onEvent((e) => received.push(e));

    manager.updateStatus('opencode', 'working', { sessionId: 'ses_abc' });
    await flushImmediate();

    expect(received).toHaveLength(1);
    expect(received[0].payload.tokens).toBeUndefined();
  });
});

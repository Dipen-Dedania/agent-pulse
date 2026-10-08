import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

import { StatusStateManager } from '../state-manager';

// The bridge accepts hook POSTs before the app is `ready`, while the timeline
// (the only persisting subscriber) boots in a deferred launch stage. The
// pending buffer bridges that gap; these tests pin its hand-off semantics.

const flushImmediate = () => new Promise((r) => setImmediate(r));

describe('StatusStateManager — pending replay buffer', () => {
  it('buffers events emitted before drainPending() and returns them oldest first', async () => {
    const manager = new StatusStateManager();
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', taskSummary: 'first' });
    manager.updateStatus('cursor', 'waiting', { sessionId: 's2', taskSummary: 'second' });
    await flushImmediate();

    const drained = manager.drainPending();
    expect(drained.map((e) => e.payload.taskSummary)).toEqual(['first', 'second']);
    expect(drained[0].toolId).toBe('claude-code');
    expect(drained[1].state).toBe('waiting');
  });

  it('stops buffering after the drain: later events reach live listeners only', async () => {
    const manager = new StatusStateManager();
    manager.drainPending();

    const live: string[] = [];
    manager.onEvent((e) => live.push(e.payload.taskSummary ?? ''));
    manager.updateStatus('claude-code', 'working', { taskSummary: 'live-one' });
    await flushImmediate();

    expect(live).toEqual(['live-one']);
    expect(manager.drainPending()).toEqual([]);
  });

  it('a second drain returns an empty array', async () => {
    const manager = new StatusStateManager();
    manager.updateStatus('claude-code', 'working', { taskSummary: 'x' });
    await flushImmediate();
    expect(manager.drainPending()).toHaveLength(1);
    expect(manager.drainPending()).toEqual([]);
  });

  it('caps the buffer and drops the oldest events past the cap', async () => {
    const manager = new StatusStateManager();
    for (let i = 0; i < 520; i++) {
      manager.updateStatus('claude-code', 'working', { taskSummary: `t${i}` });
    }
    await flushImmediate();
    const drained = manager.drainPending();
    expect(drained).toHaveLength(500);
    expect(drained[0].payload.taskSummary).toBe('t20');
    expect(drained[499].payload.taskSummary).toBe('t519');
  });

  it('delivers a buffered event to live listeners too (buffering never swallows)', async () => {
    const manager = new StatusStateManager();
    const live: string[] = [];
    manager.onEvent((e) => live.push(e.payload.taskSummary ?? ''));
    manager.updateStatus('claude-code', 'working', { taskSummary: 'both' });
    await flushImmediate();
    expect(live).toEqual(['both']);
    expect(manager.drainPending().map((e) => e.payload.taskSummary)).toEqual(['both']);
  });
});

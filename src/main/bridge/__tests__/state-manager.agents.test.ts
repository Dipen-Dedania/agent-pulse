import { describe, it, expect, vi } from 'vitest';
import { NormalizedEvent } from '../../../common/types';

vi.mock('electron', () => ({
  app: {},
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

import { StatusStateManager } from '../state-manager';

// Subagent depth counting: SubagentStart/Stop carry agentDelta hints instead
// of an absolute count; Stop/SessionStart/SessionEnd carry agentReset. The
// counter feeds activeAgents, and a finishing subagent must never change the
// displayed state (background subagents can outlive the main turn's Stop).

const flushImmediate = () => new Promise((r) => setImmediate(r));

describe('StatusStateManager — subagent depth counting', () => {
  it('increments on SubagentStart and decrements on SubagentStop', async () => {
    const manager = new StatusStateManager();

    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: 1 });
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: 1 });
    expect(manager.getStatus('claude-code')?.activeAgents).toBe(2);

    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: -1 });
    expect(manager.getStatus('claude-code')?.activeAgents).toBe(1);
    await flushImmediate();
  });

  it('floors at zero on extra SubagentStops', () => {
    const manager = new StatusStateManager();
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: -1 });
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: -1 });
    expect(manager.getStatus('claude-code')?.activeAgents).toBe(0);
  });

  it('resets on agentReset (Stop / SessionStart / SessionEnd)', () => {
    const manager = new StatusStateManager();
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: 1 });
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: 1 });
    manager.updateStatus('claude-code', 'idle-active', { sessionId: 's1', agentReset: true });
    expect(manager.getStatus('claude-code')?.activeAgents).toBe(0);
  });

  it('resets when the session id changes', () => {
    const manager = new StatusStateManager();
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: 1 });
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: 1 });
    manager.updateStatus('claude-code', 'working', { sessionId: 's2', agentDelta: 1 });
    expect(manager.getStatus('claude-code')?.activeAgents).toBe(1);
  });

  it('SubagentStop preserves the current state (no idle→working revival)', () => {
    const manager = new StatusStateManager();
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: 1 });
    // Main turn finishes while the background subagent is still running.
    manager.updateStatus('claude-code', 'idle-active', { sessionId: 's1', agentReset: true });
    // The late SubagentStop arrives mapped as 'working' — must stay idle.
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: -1 });
    expect(manager.getStatus('claude-code')?.state).toBe('idle-active');
    expect(manager.getStatus('claude-code')?.activeAgents).toBe(0);
  });

  it('event payload carries the computed depth and the preserved state', async () => {
    const manager = new StatusStateManager();
    const received: NormalizedEvent[] = [];
    manager.onEvent((e) => received.push(e));

    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: 1 });
    manager.updateStatus('claude-code', 'idle-active', { sessionId: 's1', agentReset: true });
    manager.updateStatus('claude-code', 'working', { sessionId: 's1', agentDelta: -1 });
    await flushImmediate();

    expect(received).toHaveLength(3);
    expect(received[0].payload.activeAgents).toBe(1);
    expect(received[1].payload.activeAgents).toBe(0);
    // Preserved state also flows to event listeners (sessions deriver would
    // otherwise count a phantom idle→working turn).
    expect(received[2].state).toBe('idle-active');
    expect(received[2].payload.activeAgents).toBe(0);
  });

  it('does not disturb tools that pass explicit activeAgents', () => {
    const manager = new StatusStateManager();
    manager.updateStatus('vscode-copilot', 'working', { sessionId: 'c1', activeAgents: 3 });
    expect(manager.getStatus('vscode-copilot')?.activeAgents).toBe(3);
    // Carry-forward when the next event omits it.
    manager.updateStatus('vscode-copilot', 'working', { sessionId: 'c1' });
    expect(manager.getStatus('vscode-copilot')?.activeAgents).toBe(3);
  });
});

// Hook scripts only walk the process tree on some events (the walk is slow on
// Windows), so most payloads carry no PID fields. The last chain must survive
// them or a bubble click loses its focus target mid-turn.
describe('StatusStateManager — agent PID latching', () => {
  it('keeps the latched pid and chain when a later event omits them', () => {
    const manager = new StatusStateManager();

    manager.updateStatus('openai-codex', 'working', { sessionId: 's1', agentPid: 200, agentPidChain: [100, 200, 300] });
    manager.updateStatus('openai-codex', 'working', { sessionId: 's1' });
    manager.updateStatus('openai-codex', 'idle', { sessionId: 's1', agentPidChain: [] });

    expect(manager.getStatus('openai-codex')?.agentPid).toBe(200);
    expect(manager.getStatus('openai-codex')?.agentPidChain).toEqual([100, 200, 300]);
  });

  it('replaces the latch when a later event carries a new chain', () => {
    const manager = new StatusStateManager();

    manager.updateStatus('openai-codex', 'working', { sessionId: 's1', agentPid: 200, agentPidChain: [100, 200] });
    manager.updateStatus('openai-codex', 'working', { sessionId: 's2', agentPid: 500, agentPidChain: [400, 500] });

    expect(manager.getStatus('openai-codex')?.agentPid).toBe(500);
    expect(manager.getStatus('openai-codex')?.agentPidChain).toEqual([400, 500]);
  });
});

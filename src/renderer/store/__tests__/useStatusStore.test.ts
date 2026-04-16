import { describe, it, expect, beforeEach } from 'vitest';
import { useStatusStore } from '../useStatusStore';
import { ToolStatus } from '../../../common/types';

function makeStatus(toolId: string, state: string): ToolStatus {
  return {
    toolId: toolId as any,
    state:  state as any,
    lastUpdated: Date.now(),
    activeAgents: 0,
  };
}

describe('useStatusStore', () => {
  beforeEach(() => {
    // Reset store state between tests
    useStatusStore.setState({ statuses: {} as any });
  });

  it('starts with empty statuses', () => {
    expect(Object.keys(useStatusStore.getState().statuses)).toHaveLength(0);
  });

  it('updateStatus stores a new entry', () => {
    const s = makeStatus('claude-code', 'working');
    useStatusStore.getState().updateStatus(s);
    expect(useStatusStore.getState().statuses['claude-code']).toEqual(s);
  });

  it('updateStatus overwrites the existing entry for the same toolId', () => {
    useStatusStore.getState().updateStatus(makeStatus('claude-code', 'working'));
    const idle = makeStatus('claude-code', 'idle');
    useStatusStore.getState().updateStatus(idle);
    expect(useStatusStore.getState().statuses['claude-code'].state).toBe('idle');
  });

  it('multiple tools hold independent states', () => {
    useStatusStore.getState().updateStatus(makeStatus('claude-code', 'working'));
    useStatusStore.getState().updateStatus(makeStatus('cursor', 'waiting'));
    useStatusStore.getState().updateStatus(makeStatus('kiro', 'error'));

    const s = useStatusStore.getState().statuses;
    expect(s['claude-code'].state).toBe('working');
    expect(s['cursor'].state).toBe('waiting');
    expect(s['kiro'].state).toBe('error');
  });

  it('setInitialStatuses replaces all statuses', () => {
    useStatusStore.getState().updateStatus(makeStatus('cursor', 'working'));

    const next = [
      makeStatus('claude-code', 'idle'),
      makeStatus('kiro', 'waiting'),
    ];
    useStatusStore.getState().setInitialStatuses(next);

    const s = useStatusStore.getState().statuses;
    expect(Object.keys(s)).toHaveLength(2);
    expect(s['claude-code'].state).toBe('idle');
    expect(s['kiro'].state).toBe('waiting');
    // Previous cursor entry should be gone
    expect(s['cursor']).toBeUndefined();
  });
});

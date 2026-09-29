import { describe, it, expect } from 'vitest';
import { openTimelineDb, TimelineDb } from '../db';
import { SessionsDeriver } from '../sessions-deriver';
import { NormalizedEvent, AgentState } from '../../../common/types';

const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();

function ev(state: AgentState, timestamp: number): NormalizedEvent {
  return {
    toolId: 'claude-code',
    state,
    timestamp,
    payload: { sessionId: 's1', cwd: '/workspace/project' },
  };
}

function closedTurns(db: TimelineDb): number[] {
  return db.query<{ turns: number }>('SELECT turns FROM sessions').map((r) => r.turns);
}

// The new Claude Code lifecycle events flow through the deriver with the
// state-manager's resolved states: SessionStart arrives as idle-active, and a
// late SubagentStop arrives with the PRESERVED current state (never a raw
// 'working' that would fake a turn).

describe.skipIf(!dbAvailable)('SessionsDeriver — Claude Code lifecycle events', () => {
  it('SessionStart → UserPromptSubmit → tools counts exactly one turn', () => {
    const db = openTimelineDb(':memory:')!;
    const deriver = new SessionsDeriver(db);

    deriver.onEvent(ev('idle-active', NOW));        // SessionStart
    deriver.onEvent(ev('working', NOW + 1_000));    // UserPromptSubmit
    deriver.onEvent(ev('working', NOW + 2_000));    // PreToolUse
    deriver.onEvent(ev('working', NOW + 3_000));    // SubagentStart
    deriver.onEvent(ev('idle-active', NOW + 4_000)); // Stop

    deriver.flushAll();
    expect(closedTurns(db)).toEqual([1]);
    db.close();
  });

  it('a preserved-state SubagentStop after Stop does not add a turn', () => {
    const db = openTimelineDb(':memory:')!;
    const deriver = new SessionsDeriver(db);

    deriver.onEvent(ev('working', NOW));             // UserPromptSubmit (turn 1)
    deriver.onEvent(ev('idle-active', NOW + 1_000)); // Stop
    // Late SubagentStop: the state manager preserved idle-active, so the
    // deriver sees idle-active — not a working flap.
    deriver.onEvent(ev('idle-active', NOW + 2_000));
    deriver.onEvent(ev('working', NOW + 3_000));     // next real prompt (turn 2)

    deriver.flushAll();
    expect(closedTurns(db)).toEqual([2]);
    db.close();
  });
});

import { describe, it, expect } from 'vitest';
import { openTimelineDb, TimelineDb, EventRow } from '../db';
import { TimelineQueries } from '../queries';

// better-sqlite3 is built for Electron's ABI, so it may not load under plain
// Node — skip cleanly, same as the other query suites.
const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();
const BASE = NOW - 3 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;

let tick = 0;
function ev(db: TimelineDb, row: Partial<EventRow> & Pick<EventRow, 'toolId' | 'state'>) {
  db.insertEvent({ timestamp: BASE + tick++ * 1000, sessionId: 's1', ...row } as EventRow);
}

describe.skipIf(!dbAvailable)('TimelineQueries.getActionMix', () => {
  it('counts one call per before-tool row and groups by category', () => {
    const db = openTimelineDb(':memory:')!;
    // Claude Code: only the before-tool event is hooked.
    ev(db, { toolId: 'claude-code', state: 'working', taskSummary: 'Tool: Read' });
    ev(db, { toolId: 'claude-code', state: 'working', taskSummary: 'Tool: Read' });
    ev(db, { toolId: 'claude-code', state: 'working', taskSummary: 'Tool: Edit' });
    ev(db, { toolId: 'claude-code', state: 'working', taskSummary: 'Tool: mcp__srv__do' });
    // A permission prompt repeats the tool name — not a second call.
    ev(db, { toolId: 'claude-code', state: 'waiting', taskSummary: 'Tool: Edit' });
    // A prompt-submit row carries no tool.
    ev(db, { toolId: 'claude-code', state: 'working' });
    // Codex: before = working, after = idle-active, both named.
    ev(db, { toolId: 'openai-codex', state: 'working', taskSummary: 'Tool: Bash' });
    ev(db, { toolId: 'openai-codex', state: 'idle-active', taskSummary: 'Tool: Bash' });

    const out = new TimelineQueries(db).getActionMix('7d');
    expect(out.totalCalls).toBe(5);
    expect(out.agents.map((a) => [a.toolId, a.calls])).toEqual([['claude-code', 4], ['openai-codex', 1]]);
    expect(out.categories.map((c) => [c.category, c.calls])).toEqual([
      ['explore', 2], ['edit', 1], ['shell', 1], ['mcp', 1],
    ]);
    expect(out.categories.reduce((s, c) => s + c.pct, 0)).toBeCloseTo(100);
    expect(out.agents[0].topTools[0]).toEqual({ name: 'Read', category: 'explore', calls: 2 });
    db.close();
  });

  it('halves agents that log both the before and after event as working', () => {
    const db = openTimelineDb(':memory:')!;
    for (const name of ['view_file', 'view_file', 'run_command']) {
      ev(db, { toolId: 'antigravity-cli', state: 'working', taskSummary: `Tool: ${name}` }); // before
      ev(db, { toolId: 'antigravity-cli', state: 'working', taskSummary: `Tool: ${name}` }); // after
    }
    const out = new TimelineQueries(db).getActionMix('7d');
    expect(out.totalCalls).toBe(3);
    expect(out.agents[0].topTools).toEqual([
      { name: 'view_file', category: 'explore', calls: 2 },
      { name: 'run_command', category: 'shell', calls: 1 },
    ]);
    db.close();
  });

  it('ignores rows outside the window and returns an empty payload with no tool rows', () => {
    const db = openTimelineDb(':memory:')!;
    db.insertEvent({ toolId: 'claude-code', state: 'working', timestamp: NOW - 40 * DAY, sessionId: 'old', taskSummary: 'Tool: Read' } as EventRow);
    const out = new TimelineQueries(db).getActionMix('7d');
    expect(out).toMatchObject({ totalCalls: 0, categories: [], agents: [] });
    db.close();
  });
});

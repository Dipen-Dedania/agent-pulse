import { describe, it, expect } from 'vitest';
import { ActivityFact } from '../activity-facts';
import { openTimelineDb, TimelineDb } from '../db';
import { TimelineQueries } from '../queries';

// better-sqlite3 is built for Electron's ABI, so it may not load under plain
// Node — skip cleanly, same as the other query suites.
const probe = openTimelineDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let seq = 0;
function fact(db: TimelineDb, over: Partial<ActivityFact> & Pick<ActivityFact, 'kind'>) {
  db.insertActivityFacts([{
    key: `k${seq++}`, ts: NOW - HOUR, toolId: 'claude-code', sessionId: 's1', ...over,
  } as ActivityFact]);
}

describe.skipIf(!dbAvailable)('TimelineQueries — activity cards', () => {
  it('getPromptSize: median, average, buckets and per-agent rows', () => {
    const db = openTimelineDb(':memory:')!;
    for (const words of [4, 10, 11, 60, 300]) fact(db, { kind: 'prompt', words });
    fact(db, { kind: 'prompt', words: 0 });                          // image-only
    fact(db, { kind: 'prompt', words: 20, toolId: 'openai-codex' });
    fact(db, { kind: 'prompt', words: 999, ts: NOW - 40 * DAY });    // outside 7d
    fact(db, { kind: 'edit', linesAdded: 5, linesRemoved: 0 });      // not a prompt

    const out = new TimelineQueries(db).getPromptSize('7d');
    expect(out.prompts).toBe(6);
    expect(out.imageOnlyPrompts).toBe(1);
    expect(out.medianWords).toBe(15.5);                              // 4,10,11,20,60,300
    expect(out.avgWords).toBeCloseTo(405 / 6);
    expect(out.longestWords).toBe(300);
    expect(out.buckets).toEqual([
      { label: '1–10', count: 2 }, { label: '11–25', count: 2 }, { label: '26–50', count: 0 },
      { label: '51–100', count: 1 }, { label: '101–250', count: 0 }, { label: '250+', count: 1 },
    ]);
    expect(out.agents).toEqual([
      { toolId: 'claude-code', prompts: 5, medianWords: 11, avgWords: 77 },
      { toolId: 'openai-codex', prompts: 1, medianWords: 20, avgWords: 20 },
    ]);
    db.close();
  });

  it('getPromptSize: empty window', () => {
    const db = openTimelineDb(':memory:')!;
    const out = new TimelineQueries(db).getPromptSize('7d');
    expect(out).toMatchObject({ prompts: 0, imageOnlyPrompts: 0, medianWords: 0, avgWords: 0, longestWords: 0, agents: [] });
    expect(out.buckets.every((b) => b.count === 0)).toBe(true);
    db.close();
  });

  it('getLinesChanged: totals, per-agent rows and gap-free days', () => {
    const db = openTimelineDb(':memory:')!;
    fact(db, { kind: 'edit', linesAdded: 10, linesRemoved: 2 });
    fact(db, { kind: 'edit', linesAdded: 5, linesRemoved: 0, ts: NOW - 2 * DAY });
    fact(db, { kind: 'edit', linesAdded: 100, linesRemoved: 40, toolId: 'openai-codex', sessionId: 't1' });
    fact(db, { kind: 'edit', linesAdded: 7, linesRemoved: 7, ts: NOW - 40 * DAY });
    fact(db, { kind: 'prompt', words: 3 });

    const out = new TimelineQueries(db).getLinesChanged('7d');
    expect(out).toMatchObject({ edits: 3, added: 115, removed: 42 });
    expect(out.agents).toEqual([
      { toolId: 'openai-codex', edits: 1, added: 100, removed: 40 },
      { toolId: 'claude-code', edits: 2, added: 15, removed: 2 },
    ]);
    expect(out.byDay).toHaveLength(7);
    expect(out.byDay.reduce((s, d) => s + d.added, 0)).toBe(115);
    expect(out.byDay.reduce((s, d) => s + d.removed, 0)).toBe(42);
    db.close();
  });

  it('getSubagentUse: launches, session share, and auto-reviews kept apart', () => {
    const db = openTimelineDb(':memory:')!;
    // Claude Code: 3 sessions, subagents in 2 of them (3 launches).
    fact(db, { kind: 'subagent', sessionId: 's1' });
    fact(db, { kind: 'subagent', sessionId: 's1' });
    fact(db, { kind: 'subagent', sessionId: 's2' });
    fact(db, { kind: 'prompt', words: 5, sessionId: 's3' });
    // Codex: 1 session, no launches, 4 auto-reviews.
    for (let i = 0; i < 4; i++) fact(db, { kind: 'auto_review', toolId: 'openai-codex', sessionId: 't1' });
    fact(db, { kind: 'subagent', sessionId: 'old', ts: NOW - 40 * DAY });

    const out = new TimelineQueries(db).getSubagentUse('7d');
    expect(out).toMatchObject({ launches: 3, sessionsWithSubagents: 2, sessions: 4, autoReviews: 4 });
    expect(out.agents).toEqual([
      { toolId: 'claude-code', launches: 3, sessionsWithSubagents: 2, sessions: 3, autoReviews: 0 },
      { toolId: 'openai-codex', launches: 0, sessionsWithSubagents: 0, sessions: 1, autoReviews: 4 },
    ]);
    expect(out.byDay).toHaveLength(7);
    expect(out.byDay.reduce((s, d) => s + d.launches, 0)).toBe(3);
    db.close();
  });
});

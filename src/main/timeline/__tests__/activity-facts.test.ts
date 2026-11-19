import { describe, it, expect } from 'vitest';
import { countDiffLines, countLines, countWords, extractClaudeFacts, extractCodexFacts } from '../activity-facts';

const TS = '2026-11-19T10:00:00.000Z';
const T = Date.parse(TS);
const jsonl = (...rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n');

describe('counting helpers', () => {
  it('counts words and lines', () => {
    expect(countWords('  go for   phase 1\n')).toBe(4);
    expect(countWords('')).toBe(0);
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\r\nb\r\n')).toBe(2);
  });

  it('counts diff lines without file headers', () => {
    expect(countDiffLines('--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+more')).toEqual({ added: 2, removed: 1 });
  });
});

describe('extractClaudeFacts', () => {
  const user = (over: Record<string, unknown>) => ({
    type: 'user', uuid: 'u1', timestamp: TS, sessionId: 's1', isSidechain: false, ...over,
  });

  it('records a typed prompt as a word count, minus image placeholders', () => {
    const facts = extractClaudeFacts(jsonl(
      user({ promptSource: 'typed', message: { role: 'user', content: 'Is this possible? [Image #1]' } }),
    ), 's1');
    expect(facts).toEqual([{ key: 'cc:p:u1', ts: T, toolId: 'claude-code', sessionId: 's1', kind: 'prompt', words: 3 }]);
  });

  it('reads text blocks and ignores image blocks', () => {
    const facts = extractClaudeFacts(jsonl(user({
      promptSource: 'typed',
      message: { content: [{ type: 'text', text: 'two words' }, { type: 'image', source: {} }] },
    })), 's1');
    expect(facts[0].words).toBe(2);
  });

  it('skips prompts no person typed', () => {
    const facts = extractClaudeFacts(jsonl(
      user({ uuid: 'a', promptSource: 'sdk', message: { content: 'headless run prompt' } }),
      user({ uuid: 'b', promptSource: 'system', message: { content: 'task finished' } }),
      user({ uuid: 'c', isMeta: true, message: { content: 'Base directory for this skill' } }),
      user({ uuid: 'd', isSidechain: true, promptSource: 'typed', message: { content: 'subagent brief' } }),
      user({ uuid: 'e', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } }),
    ), 's1');
    expect(facts).toEqual([]);
  });

  it('without a source tag (older versions), keeps plain text and drops injected tags', () => {
    const facts = extractClaudeFacts(jsonl(
      user({ uuid: 'a', message: { content: 'an old typed prompt' } }),
      user({ uuid: 'b', message: { content: '<command-name>/clear</command-name>' } }),
      user({ uuid: 'c', message: { content: '<local-command-stdout></local-command-stdout>' } }),
    ), 's1');
    expect(facts.map((f) => [f.key, f.words])).toEqual([['cc:p:a', 4]]);
  });

  it('counts lines from an edit patch and from a created file', () => {
    const facts = extractClaudeFacts(jsonl(
      user({ uuid: 'e1', toolUseResult: { structuredPatch: [{ lines: [' ctx', '-old', '+new', '+more'] }, { lines: ['-gone'] }] } }),
      user({ uuid: 'e2', toolUseResult: { type: 'create', content: 'a\nb\nc\n', structuredPatch: [] } }),
      user({ uuid: 'e3', toolUseResult: { type: 'update', structuredPatch: [{ lines: ['+x'] }] } }),
      // Not edits: a Bash result, a Read result, a string result.
      user({ uuid: 'n1', toolUseResult: { stdout: 'hi', stderr: '' } }),
      user({ uuid: 'n2', toolUseResult: { type: 'text', file: { content: 'x' } } }),
      user({ uuid: 'n3', toolUseResult: 'Error: nope' }),
    ), 's1');
    expect(facts.map((f) => [f.key, f.toolName, f.linesAdded, f.linesRemoved])).toEqual([
      ['cc:e:e1', 'Edit', 2, 2],
      ['cc:e:e2', 'Write', 3, 0],
      ['cc:e:e3', 'Write', 1, 0],
    ]);
  });

  it('records one subagent launch per Agent/Task tool call', () => {
    const facts = extractClaudeFacts(jsonl({
      type: 'assistant', timestamp: TS, sessionId: 's1',
      message: { content: [
        { type: 'text', text: 'delegating' },
        { type: 'tool_use', id: 'toolu_1', name: 'Agent', input: {} },
        { type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} },
        { type: 'tool_use', id: 'toolu_3', name: 'Task', input: {} },
      ] },
    }), 's1');
    expect(facts.map((f) => [f.key, f.kind, f.toolName])).toEqual([
      ['cc:s:toolu_1', 'subagent', 'Agent'],
      ['cc:s:toolu_3', 'subagent', 'Task'],
    ]);
  });

  it('survives malformed and half-written lines', () => {
    const good = JSON.stringify(user({ promptSource: 'typed', message: { content: 'ok then' } }));
    expect(extractClaudeFacts(`{"type":"user", broken\n${good}\n${good.slice(0, 30)}`, 's1')).toHaveLength(1);
  });
});

describe('extractCodexFacts', () => {
  const meta = (over: Record<string, unknown> = {}) => ({
    timestamp: TS, type: 'session_meta',
    payload: { id: 'th1', session_id: 'th1', thread_source: 'user', timestamp: TS, ...over },
  });
  const item = (it: Record<string, unknown>, completedAt = T + 5000) => ({
    timestamp: TS, type: 'event_msg', payload: { type: 'item_completed', item: it, completed_at_ms: completedAt },
  });

  it('counts a typed prompt and unwraps a question reply', () => {
    const { facts, context } = extractCodexFacts(jsonl(
      meta(),
      item({ type: 'UserMessage', id: 'm1', content: [{ type: 'text', text: 'agent pulse word count test alpha bravo charlie delta echo\n' }] }),
      item({ type: 'UserMessage', id: 'm2', content: [
        { type: 'text', text: '<send_user_message_question_reply>yes please</send_user_message_question_reply>' },
        { type: 'local_image', path: 'C:/x.png' },
      ] }),
    ), {});
    expect(context).toMatchObject({ threadId: 'th1', sessionId: 'th1', threadSource: 'user' });
    expect(facts).toEqual([
      { key: 'cx:p:th1:m1', ts: T + 5000, toolId: 'openai-codex', sessionId: 'th1', kind: 'prompt', words: 10 },
      { key: 'cx:p:th1:m2', ts: T + 5000, toolId: 'openai-codex', sessionId: 'th1', kind: 'prompt', words: 2 },
    ]);
  });

  it('counts lines from completed file changes only', () => {
    const { facts } = extractCodexFacts(jsonl(
      meta(),
      item({ type: 'FileChange', id: 'f1', status: 'completed', changes: {
        'C:\\a.ts': { type: 'update', unified_diff: '@@ -1 +1,2 @@\n-old\n+new\n+more', move_path: null },
        'C:\\b.ts': { type: 'add', content: 'one\ntwo\n' },
      } }),
      item({ type: 'FileChange', id: 'f2', status: 'declined', changes: { 'C:\\c.ts': { type: 'add', content: 'x\n' } } }),
    ), {});
    expect(facts.map((f) => [f.key, f.kind, f.linesAdded, f.linesRemoved])).toEqual([['cx:e:th1:f1', 'edit', 4, 1]]);
  });

  it('turns a guardian-review thread into auto-reviews and nothing else', () => {
    const { facts } = extractCodexFacts(jsonl(
      meta({ id: 'g1', session_id: 'th1', thread_source: 'guardian_review', parent_thread_id: 'th1', source: { subagent: { other: 'x' } } }),
      { timestamp: TS, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-a', started_at: T / 1000 } },
      item({ type: 'UserMessage', id: 'm1', content: [{ type: 'text', text: 'please review this command '.repeat(40) }] }),
      { timestamp: TS, type: 'event_msg', payload: { type: 'task_started', turn_id: 'turn-b', started_at: T / 1000 + 60 } },
    ), {});
    expect(facts.map((f) => [f.key, f.kind, f.sessionId, f.ts])).toEqual([
      ['cx:r:turn-a', 'auto_review', 'th1', T],
      ['cx:r:turn-b', 'auto_review', 'th1', T + 60_000],
    ]);
  });

  it('counts any other child thread as one subagent, without its prompts', () => {
    const { facts } = extractCodexFacts(jsonl(
      meta({ id: 'c1', session_id: 'th1', thread_source: 'subagent', parent_thread_id: 'th1' }),
      item({ type: 'UserMessage', id: 'm1', content: [{ type: 'text', text: 'instructions from the parent agent' }] }),
      item({ type: 'FileChange', id: 'f1', status: 'completed', changes: { x: { type: 'add', content: 'a\n' } } }),
    ), {});
    expect(facts.map((f) => [f.key, f.kind, f.sessionId])).toEqual([
      ['cx:s:c1', 'subagent', 'th1'],
      ['cx:e:c1:f1', 'edit', 'th1'],
    ]);
  });

  it('uses the carried context on a tail read, and yields nothing without one', () => {
    const tail = jsonl(item({ type: 'UserMessage', id: 'm9', content: [{ type: 'text', text: 'later prompt' }] }));
    expect(extractCodexFacts(tail, { threadId: 'th1', sessionId: 'th1', threadSource: 'user' }).facts.map((f) => f.key))
      .toEqual(['cx:p:th1:m9']);
    expect(extractCodexFacts(tail, {}).facts).toEqual([]);
  });
});

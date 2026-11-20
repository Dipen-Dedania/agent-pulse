import { describe, it, expect } from 'vitest';
import {
  CodexThreadContext, codexTypedText, countDiffLines, countLines, countWords, extractClaudeFacts, extractCodexFacts,
} from '../activity-facts';

// Fixtures follow the shapes of real Claude Code 2.1.x transcripts and Codex
// 0.169 rollouts (key order included — the Codex reader reads a record's type
// off the front of the line).

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

  it('skips file headers only before the first hunk', () => {
    expect(countDiffLines('--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+more')).toEqual({ added: 2, removed: 1 });
  });

  it('counts content lines that merely look like headers', () => {
    // Codex diffs start at the hunk. Removing "-- note" yields "--- note";
    // removing a Markdown rule yields "----"; adding "++i" yields "+++i".
    expect(countDiffLines('@@ -1,3 +1,2 @@\n--- note\n----\n+++i\n keep')).toEqual({ added: 1, removed: 2 });
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

  it('skips the untagged records Claude Code writes itself', () => {
    const facts = extractClaudeFacts(jsonl(
      // The summary that replaces the conversation on compaction: ~1,200 words, no promptSource.
      user({ uuid: 'a', isCompactSummary: true, isVisibleInTranscriptOnly: true,
        message: { content: 'This session is being continued from a previous conversation that ran out of context. ' + 'word '.repeat(400) } }),
      user({ uuid: 'b', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }),
      user({ uuid: 'c', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
      user({ uuid: 'd', message: { content: '/compact' } }),
      user({ uuid: 'e', message: { content: '<command-name>/clear</command-name>' } }),
      user({ uuid: 'f', message: { content: '<local-command-stdout></local-command-stdout>' } }),
    ), 's1');
    expect(facts).toEqual([]);
  });

  it('keeps an untagged plain prompt (older versions) and a tagged slash command', () => {
    const facts = extractClaudeFacts(jsonl(
      user({ uuid: 'a', message: { content: 'an old typed prompt' } }),
      user({ uuid: 'b', promptSource: 'typed', message: { content: '/hard do the thing' } }),
    ), 's1');
    expect(facts.map((f) => [f.key, f.words])).toEqual([['cc:p:a', 4], ['cc:p:b', 4]]);
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

  it('in a subagent transcript (all sidechain): counts edits, never prompts', () => {
    const facts = extractClaudeFacts(jsonl(
      user({ uuid: 'brief', isSidechain: true, agentId: 'a1', message: { content: 'Review the diff and report findings' } }),
      user({ uuid: 'e1', isSidechain: true, agentId: 'a1', toolUseResult: { structuredPatch: [{ lines: ['+one', '+two'] }] } }),
    ), 's1');
    expect(facts.map((f) => [f.key, f.kind, f.sessionId, f.linesAdded])).toEqual([['cc:e:e1', 'edit', 's1', 2]]);
  });

  it('records a compaction with its trigger and context size', () => {
    const boundary = (uuid: string, compactMetadata: unknown, over: Record<string, unknown> = {}) => ({
      parentUuid: 'p', isSidechain: false, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted',
      level: 'info', timestamp: TS, uuid, sessionId: 's1', compactMetadata, ...over,
    });
    const facts = extractClaudeFacts(jsonl(
      boundary('c1', { trigger: 'manual', preTokens: 142033, postTokens: 22010, durationMs: 33000 }),
      boundary('c2', { trigger: 'auto', preTokens: 370627, postTokens: 32000 }),
      boundary('c3', { trigger: 'something-new' }),
      boundary('c4', { trigger: 'auto', preTokens: 1 }, { isSidechain: true }), // a subagent's own — skipped
      { type: 'system', subtype: 'turn_duration', uuid: 'x', timestamp: TS, sessionId: 's1' },
    ), 's1');
    expect(facts).toEqual([
      { key: 'cc:c:c1', ts: T, toolId: 'claude-code', sessionId: 's1', kind: 'compaction', trigger: 'manual', tokensBefore: 142033, tokensAfter: 22010 },
      { key: 'cc:c:c2', ts: T, toolId: 'claude-code', sessionId: 's1', kind: 'compaction', trigger: 'auto', tokensBefore: 370627, tokensAfter: 32000 },
      { key: 'cc:c:c3', ts: T, toolId: 'claude-code', sessionId: 's1', kind: 'compaction', trigger: 'unknown', tokensBefore: null, tokensAfter: null },
    ]);
  });

  it('survives malformed and half-written lines', () => {
    const good = JSON.stringify(user({ promptSource: 'typed', message: { content: 'ok then' } }));
    expect(extractClaudeFacts(`{"type":"user", broken\n${good}\n${good.slice(0, 30)}`, 's1')).toHaveLength(1);
  });
});

describe('codexTypedText', () => {
  const text = (t: string) => [{ type: 'text', text: t, text_elements: [] }];

  it('counts only the answers in a question reply', () => {
    const body = JSON.stringify([
      { questionItemId: '["turn-1","call_abc",0]', question: 'Which database should the migration target first?', answer: 'staging please' },
      { questionItemId: '["turn-1","call_abc",1]', question: 'Run it now?', answer: 'yes' },
    ]);
    const typed = codexTypedText(text(`<send_user_message_question_reply>${body}</send_user_message_question_reply>`));
    expect(countWords(typed)).toBe(3);
  });

  it('falls back to the body when a reply is not the JSON form', () => {
    expect(countWords(codexTypedText(text('<send_user_message_question_reply>yes please</send_user_message_question_reply>')))).toBe(2);
  });

  it('counts only the request under an attachment wrapper', () => {
    const wrapped = [
      '',
      '# Files mentioned by the user:',
      '',
      '## codex-clipboard-0f3a9c1e-1111-2222-3333-444455556666.png: C:/Users/x/AppData/Local/Temp/codex-clipboard.png',
      '',
      '## My request:',
      'make the header sticky',
      'and keep the shadow',
    ].join('\n');
    expect(countWords(codexTypedText(text(wrapped)))).toBe(8);
  });

  it('leaves an ordinary message that happens to use headings alone', () => {
    expect(countWords(codexTypedText(text('please add a section called\n## My request: handling')))).toBe(9);
  });

  it('ignores non-text blocks', () => {
    expect(codexTypedText([{ type: 'local_image', path: 'C:/x.png' }])).toBe('');
    expect(codexTypedText(undefined)).toBe('');
  });
});

describe('extractCodexFacts', () => {
  // Real key order: timestamp, type, payload.
  const rec = (type: string, payload: unknown, timestamp = TS) => ({ timestamp, type, payload });
  const meta = (over: Record<string, unknown> = {}) =>
    rec('session_meta', { id: 'th1', session_id: 'th1', thread_source: 'user', timestamp: TS, ...over });
  const item = (it: Record<string, unknown>, completedAt = T + 5000) =>
    rec('event_msg', { type: 'item_completed', thread_id: 'th1', turn_id: 't', item: it, completed_at_ms: completedAt });
  const taskStarted = (turnId = 'turn-1') =>
    rec('event_msg', { type: 'task_started', turn_id: turnId, started_at: T / 1000 });
  const taskComplete = () => rec('event_msg', { type: 'task_complete', turn_id: 'turn-1', duration_ms: 1000 });
  const responseItem = (payloadType = 'function_call') => rec('response_item', { type: payloadType, id: 'r1' });
  const compaction = (id = 'cmp1') => item({ type: 'ContextCompaction', id });
  // The bookkeeping records Codex writes around a compaction — never activity.
  const noise = () => [
    rec('token_usage_record', { thread_id: 'th1' }),
    rec('compacted', { message: '', window_number: 2 }),
    rec('world_state', { full: true }),
    rec('turn_context', { turn_id: 'turn-1' }),
    rec('event_msg', { type: 'thread_settings_applied' }),
    rec('event_msg', { type: 'token_count', info: {} }),
  ];
  const USER: CodexThreadContext = { threadId: 'th1', sessionId: 'th1', threadSource: 'user' };

  it('counts a typed prompt', () => {
    const { facts, context } = extractCodexFacts(jsonl(
      meta(),
      item({ type: 'UserMessage', id: 'm1', content: [{ type: 'text', text: 'agent pulse word count test alpha bravo charlie delta echo\n' }] }),
      item({ type: 'UserMessage', id: 'm2', content: [{ type: 'text', text: 'look at this' }, { type: 'local_image', path: 'C:/x.png' }] }),
    ), {});
    expect(context).toMatchObject({ threadId: 'th1', sessionId: 'th1', threadSource: 'user' });
    expect(facts).toEqual([
      { key: 'cx:p:th1:m1', ts: T + 5000, toolId: 'openai-codex', sessionId: 'th1', kind: 'prompt', words: 10 },
      { key: 'cx:p:th1:m2', ts: T + 5000, toolId: 'openai-codex', sessionId: 'th1', kind: 'prompt', words: 3 },
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
      taskStarted('turn-a'),
      item({ type: 'UserMessage', id: 'm1', content: [{ type: 'text', text: 'please review this command '.repeat(40) }] }),
      compaction('g-cmp'),
      taskComplete(),
      rec('event_msg', { type: 'task_started', turn_id: 'turn-b', started_at: T / 1000 + 60 }),
    ), {});
    expect(facts.map((f) => [f.key, f.kind, f.sessionId, f.ts])).toEqual([
      ['cx:r:turn-a', 'auto_review', 'th1', T],
      ['cx:r:turn-b', 'auto_review', 'th1', T + 60_000],
    ]);
  });

  it('counts any other child thread as one subagent: edits yes, prompts and compactions no', () => {
    const { facts } = extractCodexFacts(jsonl(
      meta({ id: 'c1', session_id: 'th1', thread_source: 'subagent', parent_thread_id: 'th1' }),
      taskStarted(),
      item({ type: 'UserMessage', id: 'm1', content: [{ type: 'text', text: 'instructions from the parent agent' }] }),
      item({ type: 'FileChange', id: 'f1', status: 'completed', changes: { x: { type: 'add', content: 'a\n' } } }),
      compaction(),
      taskComplete(),
    ), {});
    expect(facts.map((f) => [f.key, f.kind, f.sessionId])).toEqual([
      ['cx:s:c1', 'subagent', 'th1'],
      ['cx:e:c1:f1', 'edit', 'th1'],
    ]);
  });

  it('files a child without its own session id under its parent, for every fact', () => {
    const { facts } = extractCodexFacts(jsonl(
      rec('session_meta', { id: 'c1', thread_source: 'subagent', parent_thread_id: 'th1', timestamp: TS }),
      item({ type: 'FileChange', id: 'f1', status: 'completed', changes: { x: { type: 'add', content: 'a\n' } } }),
    ), {});
    expect(facts.map((f) => [f.kind, f.sessionId])).toEqual([['subagent', 'th1'], ['edit', 'th1']]);
  });

  it('uses the carried context on a tail read, and yields nothing without one', () => {
    const tail = jsonl(item({ type: 'UserMessage', id: 'm9', content: [{ type: 'text', text: 'later prompt' }] }));
    expect(extractCodexFacts(tail, USER).facts.map((f) => f.key)).toEqual(['cx:p:th1:m9']);
    expect(extractCodexFacts(tail, {}).facts).toEqual([]);
  });

  it('does not mutate the context it was given', () => {
    const ctx: CodexThreadContext = { ...USER, turnActivity: 0 };
    extractCodexFacts(jsonl(taskStarted(), responseItem(), responseItem()), ctx);
    expect(ctx).toEqual({ ...USER, turnActivity: 0 });
  });

  describe('compaction trigger', () => {
    const triggers = (text: string, ctx: CodexThreadContext = USER) =>
      extractCodexFacts(text, ctx).facts.filter((f) => f.kind === 'compaction').map((f) => [f.key, f.trigger]);

    it('manual: the turn holds nothing but the compaction', () => {
      // The exact sequence a typed compact command produced (Codex 0.169).
      expect(triggers(jsonl(taskStarted(), ...noise(), compaction(), taskComplete())))
        .toEqual([['cx:c:th1:cmp1', 'manual']]);
    });

    it('auto: work earlier in the same turn', () => {
      expect(triggers(jsonl(
        taskStarted(),
        item({ type: 'UserMessage', id: 'm1', content: [{ type: 'text', text: 'do the thing' }] }),
        responseItem(), item({ type: 'CommandExecution', id: 'x1', status: 'completed' }),
        ...noise(), compaction(), responseItem(), taskComplete(),
      ))).toEqual([['cx:c:th1:cmp1', 'auto']]);
    });

    it('auto: the user message alone counts as the turn doing something', () => {
      expect(triggers(jsonl(
        taskStarted(),
        item({ type: 'UserMessage', id: 'm1', content: [{ type: 'text', text: 'continue' }] }),
        ...noise(), compaction(), taskComplete(),
      ))).toEqual([['cx:c:th1:cmp1', 'auto']]);
    });

    it('auto: the turn opens with the compaction, then goes on working', () => {
      expect(triggers(jsonl(
        taskStarted(), ...noise(), compaction(),
        item({ type: 'Reasoning', id: 'r1' }), responseItem(), taskComplete(),
      ))).toEqual([['cx:c:th1:cmp1', 'auto']]);
    });

    it('does not treat the compaction’s own response item as work', () => {
      expect(triggers(jsonl(taskStarted(), responseItem('compaction'), ...noise(), compaction(), responseItem('compaction'), taskComplete())))
        .toEqual([['cx:c:th1:cmp1', 'manual']]);
    });

    it('unknown: the turn is aborted, or replaced, before it resolves', () => {
      expect(triggers(jsonl(taskStarted(), compaction('a'), rec('event_msg', { type: 'turn_aborted', turn_id: 'turn-1', reason: 'interrupted' }))))
        .toEqual([['cx:c:th1:a', 'unknown']]);
      expect(triggers(jsonl(taskStarted(), compaction('b'), taskStarted('turn-2'))))
        .toEqual([['cx:c:th1:b', 'unknown']]);
    });

    it('waits across reads: the verdict arrives with a later tail', () => {
      const first = extractCodexFacts(jsonl(taskStarted(), ...noise(), compaction()), USER);
      expect(first.facts).toEqual([]);
      expect(first.context.pendingCompaction).toEqual({ key: 'cx:c:th1:cmp1', ts: T + 5000 });

      // The context survives being stored as JSON between reads.
      const restored = JSON.parse(JSON.stringify(first.context)) as CodexThreadContext;
      const second = extractCodexFacts(jsonl(taskComplete()), restored);
      expect(second.facts).toEqual([
        { key: 'cx:c:th1:cmp1', ts: T + 5000, toolId: 'openai-codex', sessionId: 'th1', kind: 'compaction', trigger: 'manual' },
      ]);
      expect(second.context.pendingCompaction).toBeUndefined();
    });

    it('carries the turn’s activity across reads too', () => {
      const first = extractCodexFacts(jsonl(taskStarted(), responseItem()), USER);
      expect(triggers(jsonl(compaction(), taskComplete()), first.context)).toEqual([['cx:c:th1:cmp1', 'auto']]);
    });

    it('resets activity at each turn', () => {
      expect(triggers(jsonl(
        taskStarted('turn-1'), responseItem(), taskComplete(),
        taskStarted('turn-2'), ...noise(), compaction(), taskComplete(),
      ))).toEqual([['cx:c:th1:cmp1', 'manual']]);
    });
  });
});

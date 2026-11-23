import { describe, expect, it } from 'vitest';
import { extractClaudeCommands } from '../command-history';

const T0 = 1_763_116_642_737;

const line = (display: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({ display, pastedContents: {}, timestamp: T0, project: 'E:\\repo', sessionId: 's1', ...over });

const inline = (names: string[]) => ({ isInlineCommand: (n: string) => names.includes(n) });

describe('extractClaudeCommands', () => {
  it('takes the leading command and lower-cases it', () => {
    const { uses } = extractClaudeCommands([line('/model'), line('/Compact', { timestamp: T0 + 5000 })].join('\n'));
    expect(uses).toEqual([
      { key: `cc:h:${T0}:s1:model`, ts: T0, sessionId: 's1', name: 'model', entry: 'typed' },
      { key: `cc:h:${T0 + 5000}:s1:compact`, ts: T0 + 5000, sessionId: 's1', name: 'compact', entry: 'typed' },
    ]);
  });

  it('drops arguments, pasted content and the project path', () => {
    const { uses } = extractClaudeCommands(line('/goal ship the secret thing', { pastedContents: { 1: { content: 'private' } } }));
    expect(uses).toHaveLength(1);
    expect(uses[0].name).toBe('goal');
    expect(JSON.stringify(uses)).not.toMatch(/secret|private|repo/);
  });

  it('rejects path-like and non-command leading tokens', () => {
    const text = [
      line('/Users/x/project is broken'),
      line('/tmp/foo'),
      line('/1st thing'),
      line('/ spaced'),
      line('plain prompt'),
      line('//comment'),
    ].join('\n');
    expect(extractClaudeCommands(text).uses).toEqual([]);
  });

  it('keeps an unknown leading token, so typos are counted', () => {
    expect(extractClaudeCommands(line('/nre')).uses.map((u) => u.name)).toEqual(['nre']);
  });

  it('keeps plugin and MCP names whole', () => {
    const text = [line('/anthropic-skills:repo-ready now'), line('/mcp__server__prompt', { timestamp: T0 + 1 })].join('\n');
    expect(extractClaudeCommands(text).uses.map((u) => u.name)).toEqual(['anthropic-skills:repo-ready', 'mcp__server__prompt']);
  });

  it('counts inline mentions only for allowed names', () => {
    const text = line('please /hard fix the /login route and tell /me, see src/hard and https://x.dev/hard');
    const { uses } = extractClaudeCommands(text, {}, inline(['hard']));
    expect(uses).toEqual([{ key: `cc:h:${T0}:s1:hard:i`, ts: T0, sessionId: 's1', name: 'hard', entry: 'inline' }]);
  });

  it('ignores inline mentions when no inline check is given', () => {
    expect(extractClaudeCommands(line('please /hard fix it')).uses).toEqual([]);
  });

  it('strips sentence punctuation from an inline name and counts a name once per line', () => {
    const { uses } = extractClaudeCommands(line('use /hard. Then /hard, again (/hard)'), {}, inline(['hard']));
    expect(uses.map((u) => u.name)).toEqual(['hard']);
  });

  it('records a leading command and an inline one from the same line separately', () => {
    const { uses } = extractClaudeCommands(line('/hard do it the /hard way'), {}, inline(['hard']));
    expect(uses.map((u) => [u.entry, u.key])).toEqual([
      ['typed', `cc:h:${T0}:s1:hard`],
      ['inline', `cc:h:${T0}:s1:hard:i`],
    ]);
  });

  it('drops a duplicate of the same session and name within a second', () => {
    const text = [
      line('/new'),
      line('/new', { timestamp: T0 + 400 }),                       // duplicate
      line('/new', { timestamp: T0 + 5000 }),                      // a real second use
      line('/new', { timestamp: T0 + 5200, sessionId: 's2' }),     // another session
    ].join('\n');
    expect(extractClaudeCommands(text).uses.map((u) => [u.ts, u.sessionId])).toEqual([
      [T0, 's1'], [T0 + 5000, 's1'], [T0 + 5200, 's2'],
    ]);
  });

  it('carries the dedupe window across reads', () => {
    const first = extractClaudeCommands(line('/new'));
    const second = extractClaudeCommands(line('/new', { timestamp: T0 + 300 }), first.context);
    expect(first.uses).toHaveLength(1);
    expect(second.uses).toEqual([]);
    expect(extractClaudeCommands(line('/new', { timestamp: T0 + 300 })).uses).toHaveLength(1);
  });

  it('drops lines older than the cutoff', () => {
    const text = [line('/old', { timestamp: T0 - 10 }), line('/model')].join('\n');
    expect(extractClaudeCommands(text, {}, { cutoffMs: T0 }).uses.map((u) => u.name)).toEqual(['model']);
  });

  it('skips bad JSON and rows of the wrong shape', () => {
    const text = [
      '{not json',
      '',
      '42',
      'null',
      JSON.stringify({ display: 7, timestamp: T0 }),
      JSON.stringify({ display: '/model', timestamp: 'yesterday' }),
      line('/exit'),
    ].join('\n');
    expect(extractClaudeCommands(text).uses.map((u) => u.name)).toEqual(['exit']);
  });

  it('keeps a row without a session id', () => {
    const { uses } = extractClaudeCommands(line('/model', { sessionId: undefined }));
    expect(uses).toEqual([{ key: `cc:h:${T0}::model`, ts: T0, sessionId: null, name: 'model', entry: 'typed' }]);
  });
});

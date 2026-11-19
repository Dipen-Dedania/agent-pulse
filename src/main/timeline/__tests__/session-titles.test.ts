import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractSessionTitle, resolveClaudeSessionTitle } from '../session-titles';

const ai = (title: string) => JSON.stringify({ type: 'ai-title', aiTitle: title, sessionId: 's1' });
const custom = (title: string) => JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: 's1' });
const message = (text: string) => JSON.stringify({ type: 'user', message: { content: text } });

describe('extractSessionTitle', () => {
  it('returns the newest AI title', () => {
    expect(extractSessionTitle([ai('First'), message('hi'), ai('Second')].join('\n'))).toBe('Second');
  });

  it('prefers a /rename title over a later AI title', () => {
    expect(extractSessionTitle([ai('Generated'), custom('Mine'), ai('Regenerated')].join('\n'))).toBe('Mine');
  });

  it('returns null when there is no title record', () => {
    expect(extractSessionTitle(message('{"type":"ai-title" quoted in a prompt'))).toBeNull();
  });

  it('skips a record cut in half by the read window and blank titles', () => {
    const cut = ai('Truncated').slice(10);
    expect(extractSessionTitle([cut, ai('   '), ai('Whole')].join('\n'))).toBe('Whole');
  });

  it('collapses whitespace and caps the length', () => {
    expect(extractSessionTitle(ai('a\n  b'))).toBe('a b');
    expect(extractSessionTitle(ai('x'.repeat(300)))).toHaveLength(120);
  });
});

describe('resolveClaudeSessionTitle', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-titles-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const write = (sessionId: string, lines: string[]) => {
    const proj = path.join(dir, 'E--some-project');
    fs.mkdirSync(proj, { recursive: true });
    const file = path.join(proj, `${sessionId}.jsonl`);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return file;
  };

  it('finds the transcript under any project folder', () => {
    write('sess-a', [message('hi'), ai('Fix the login bug')]);
    expect(resolveClaudeSessionTitle('sess-a', dir)).toBe('Fix the login bug');
  });

  it('falls back to the head when the tail has no title record', () => {
    write('sess-b', [ai('Early title'), message('y'.repeat(600 * 1024))]);
    expect(resolveClaudeSessionTitle('sess-b', dir)).toBe('Early title');
  });

  it('re-reads once the transcript grows', () => {
    const file = write('sess-c', [ai('Old')]);
    expect(resolveClaudeSessionTitle('sess-c', dir)).toBe('Old');
    fs.appendFileSync(file, ai('Newer title') + '\n');
    expect(resolveClaudeSessionTitle('sess-c', dir)).toBe('Newer title');
  });

  it('returns null for an unknown, untitled, or unsafe session id', () => {
    write('sess-d', [message('no title yet')]);
    expect(resolveClaudeSessionTitle('missing', dir)).toBeNull();
    expect(resolveClaudeSessionTitle('sess-d', dir)).toBeNull();
    expect(resolveClaudeSessionTitle('..\\..\\evil', dir)).toBeNull();
  });
});

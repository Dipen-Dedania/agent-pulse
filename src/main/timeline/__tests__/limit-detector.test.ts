import { describe, it, expect } from 'vitest';
import { detectLimitHits } from '../limit-detector';

const notice = (over: Record<string, unknown> = {}, text = "You've hit your session limit · resets 2:50pm (Asia/Calcutta)") =>
  JSON.stringify({
    type: 'assistant',
    uuid: 'u-1',
    timestamp: '2026-07-30T08:41:52.012Z',
    sessionId: 's1',
    message: { model: '<synthetic>', content: [{ type: 'text', text }] },
    ...over,
  });

describe('detectLimitHits', () => {
  it('detects a session-limit notice and classifies it', () => {
    const hits = detectLimitHits(notice(), 's1', 'claude-code');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      uuid: 'u-1',
      ts: Date.parse('2026-07-30T08:41:52.012Z'),
      toolId: 'claude-code',
      sessionId: 's1',
      kind: 'session',
    });
    expect(hits[0].resetText).toContain('session limit');
  });

  it('classifies weekly and usage limits', () => {
    const weekly = detectLimitHits(
      notice({ uuid: 'w' }, "You've hit your weekly limit · resets Monday"), 's1', 'claude-code');
    const usage = detectLimitHits(
      notice({ uuid: 'g' }, "You've hit your usage limit"), 's1', 'claude-code');
    expect(weekly[0].kind).toBe('weekly');
    expect(usage[0].kind).toBe('usage');
  });

  it('ignores benign synthetic messages (No response requested, API errors)', () => {
    const text = [
      notice({ uuid: 'a' }, 'No response requested.'),
      notice({ uuid: 'b' }, 'API Error: 529 Overloaded.'),
    ].join('\n');
    expect(detectLimitHits(text, 's1', 'claude-code')).toHaveLength(0);
  });

  it('ignores a real assistant message that merely mentions a limit', () => {
    const real = JSON.stringify({
      type: 'assistant',
      uuid: 'r',
      timestamp: '2026-07-30T08:00:00.000Z',
      sessionId: 's1',
      message: { model: 'claude-opus-4-7', content: [{ type: 'text', text: "You've hit your session limit of tokens per file" }] },
    });
    expect(detectLimitHits(real, 's1', 'claude-code')).toHaveLength(0);
  });

  it('falls back to a stable synthetic key when uuid is missing', () => {
    const hits = detectLimitHits(notice({ uuid: undefined }), 's1', 'claude-code');
    expect(hits[0].uuid).toBe(`s1:${Date.parse('2026-07-30T08:41:52.012Z')}`);
  });

  it('skips notices with an unparseable timestamp', () => {
    expect(detectLimitHits(notice({ timestamp: 'not-a-date' }), 's1', 'claude-code')).toHaveLength(0);
  });

  it('skips malformed lines without throwing', () => {
    const text = `not json\n${notice()}\n`;
    expect(detectLimitHits(text, 's1', 'claude-code')).toHaveLength(1);
  });
});

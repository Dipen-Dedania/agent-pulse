import { describe, it, expect } from 'vitest';
import { aggregateAssistantTurns, aggregateCodexTokenCounts } from '../transcript-reader';

const codexMeta = (model?: string) =>
  JSON.stringify({ type: 'session_meta', payload: { id: 's1', model: model ?? null } });
const codexCtx = (model: string) =>
  JSON.stringify({ type: 'turn_context', payload: { turn_id: 't', model } });
const codexTokens = (total: {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens?: number;
}) =>
  JSON.stringify({
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: total } },
  });

describe('aggregateAssistantTurns', () => {
  it('returns null when no assistant turns are present', () => {
    const text = JSON.stringify({ type: 'user', sessionId: 's1', message: { content: 'hi' } });
    expect(aggregateAssistantTurns(text, 's1')).toBeNull();
  });

  it('sums input/output/cache tokens across multiple assistant turns', () => {
    const turn1 = {
      type: 'assistant',
      sessionId: 's1',
      message: {
        model: 'claude-opus-4-7',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
      },
    };
    const turn2 = {
      type: 'assistant',
      sessionId: 's1',
      message: {
        model: 'claude-opus-4-7',
        usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 20, cache_creation_input_tokens: 0 },
      },
    };
    const text = `${JSON.stringify(turn1)}\n${JSON.stringify(turn2)}\n`;
    const delta = aggregateAssistantTurns(text, 's1');
    expect(delta).toEqual({
      model: 'claude-opus-4-7',
      tokensIn: 300,
      tokensOut: 130,
      cacheRead: 30,
      cacheWrite: 5,
    });
  });

  it('filters by sessionId so cross-session lines are ignored', () => {
    const wrongSession = {
      type: 'assistant',
      sessionId: 'other',
      message: { model: 'm', usage: { input_tokens: 999, output_tokens: 999 } },
    };
    const ours = {
      type: 'assistant',
      sessionId: 's1',
      message: { model: 'm', usage: { input_tokens: 1, output_tokens: 2 } },
    };
    const text = `${JSON.stringify(wrongSession)}\n${JSON.stringify(ours)}\n`;
    const delta = aggregateAssistantTurns(text, 's1');
    expect(delta).toEqual({ model: 'm', tokensIn: 1, tokensOut: 2, cacheRead: 0, cacheWrite: 0 });
  });

  it('skips malformed lines without throwing', () => {
    const text = `not json\n{"type":"assistant","sessionId":"s1","message":{"model":"m","usage":{"input_tokens":7,"output_tokens":3}}}\n`;
    const delta = aggregateAssistantTurns(text, 's1');
    expect(delta?.tokensIn).toBe(7);
    expect(delta?.tokensOut).toBe(3);
  });

  it('tolerates session_id (snake_case) in addition to sessionId', () => {
    const row = {
      type: 'assistant',
      session_id: 's1',
      message: { model: 'm', usage: { input_tokens: 5, output_tokens: 5 } },
    };
    expect(aggregateAssistantTurns(JSON.stringify(row), 's1')?.tokensIn).toBe(5);
  });
});

describe('aggregateCodexTokenCounts', () => {
  it('first read returns the session-to-date cumulative as the delta', () => {
    const text = [
      codexMeta(),
      codexCtx('gpt-5.5'),
      codexTokens({ input_tokens: 14784, cached_input_tokens: 11648, output_tokens: 226, reasoning_output_tokens: 46 }),
    ].join('\n');
    const { delta, snapshot } = aggregateCodexTokenCounts(text, undefined);
    // tokensIn = input − cached; tokensOut = output_tokens (reasoning already in it); no cache-write.
    expect(delta).toEqual({ model: 'gpt-5.5', tokensIn: 3136, tokensOut: 226, cacheRead: 11648, cacheWrite: 0 });
    expect(snapshot).toEqual({ freshIn: 3136, cacheRead: 11648, out: 226, model: 'gpt-5.5' });
  });

  it('second read diffs against the previous cumulative snapshot', () => {
    const prev = { freshIn: 3136, cacheRead: 11648, out: 226, model: 'gpt-5.5' };
    // Next token_count carries the new running total (cumulative).
    const text = codexTokens({ input_tokens: 30000, cached_input_tokens: 25000, output_tokens: 500 });
    const { delta, snapshot } = aggregateCodexTokenCounts(text, prev);
    expect(delta).toEqual({
      model: 'gpt-5.5',
      tokensIn: (30000 - 25000) - 3136, // fresh delta
      tokensOut: 500 - 226,
      cacheRead: 25000 - 11648,
      cacheWrite: 0,
    });
    expect(snapshot?.freshIn).toBe(5000);
    expect(snapshot?.cacheRead).toBe(25000);
    expect(snapshot?.out).toBe(500);
  });

  it('does NOT sum per-event totals (uses the last/largest cumulative in the slice)', () => {
    // Two token_count events in one slice — must take the latest, not the sum.
    const text = [
      codexTokens({ input_tokens: 100, cached_input_tokens: 0, output_tokens: 10 }),
      codexTokens({ input_tokens: 250, cached_input_tokens: 50, output_tokens: 40 }),
    ].join('\n');
    const { delta } = aggregateCodexTokenCounts(text, undefined);
    expect(delta).toEqual({ model: undefined, tokensIn: 200, tokensOut: 40, cacheRead: 50, cacheWrite: 0 });
  });

  it('re-read of unchanged cumulative emits no delta (self-correcting, never double-counts)', () => {
    const prev = { freshIn: 5000, cacheRead: 25000, out: 500 };
    const text = codexTokens({ input_tokens: 30000, cached_input_tokens: 25000, output_tokens: 500 });
    const { delta, snapshot } = aggregateCodexTokenCounts(text, prev);
    expect(delta).toBeNull();
    expect(snapshot?.freshIn).toBe(5000);
  });

  it('returns null delta when the slice has no token_count events', () => {
    const text = [codexCtx('gpt-5.5'), JSON.stringify({ type: 'response_item', payload: {} })].join('\n');
    expect(aggregateCodexTokenCounts(text, undefined).delta).toBeNull();
  });

  it('skips malformed lines without throwing', () => {
    const text = `not json\n${codexTokens({ input_tokens: 7, cached_input_tokens: 2, output_tokens: 3 })}\n`;
    const { delta } = aggregateCodexTokenCounts(text, undefined);
    expect(delta).toEqual({ model: undefined, tokensIn: 5, tokensOut: 3, cacheRead: 2, cacheWrite: 0 });
  });
});

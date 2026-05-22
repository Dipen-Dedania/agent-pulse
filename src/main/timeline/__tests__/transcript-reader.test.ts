import { describe, it, expect } from 'vitest';
import { aggregateAssistantTurns } from '../transcript-reader';

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

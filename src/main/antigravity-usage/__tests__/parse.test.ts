import { describe, it, expect } from 'vitest';
import { parseModelsResponse } from '../parse';

const gated = (overrides: Record<string, unknown> = {}) => ({
  displayName: 'Claude Opus 4.6 (Thinking)',
  recommended: true,
  quotaInfo: { remainingFraction: 0.4, resetTime: '2026-05-28T09:41:56Z' },
  ...overrides,
});

const placeholder = (overrides: Record<string, unknown> = {}) => ({
  // no displayName, no resetTime — should be filtered out
  quotaInfo: { remainingFraction: 1 },
  ...overrides,
});

describe('parseModelsResponse', () => {
  it('keeps only models with a resetTime', () => {
    const out = parseModelsResponse({
      response: {
        models: {
          'claude-opus-4-6-thinking': gated(),
          'chat_20706': placeholder(),
          'chat_23310': placeholder(),
        },
      },
    });
    expect(out?.models).toHaveLength(1);
    expect(out?.models[0].modelKey).toBe('claude-opus-4-6-thinking');
    expect(out?.models[0].displayName).toBe('Claude Opus 4.6 (Thinking)');
  });

  it('computes utilization from remainingFraction', () => {
    const out = parseModelsResponse({
      response: { models: { 'm1': gated({ quotaInfo: { remainingFraction: 0.25, resetTime: '2026-05-28T09:41:56Z' } }) } },
    });
    expect(out?.models[0].utilization).toBe(75);
  });

  it('clamps utilization to [0, 100]', () => {
    const out = parseModelsResponse({
      response: {
        models: {
          'over': gated({ quotaInfo: { remainingFraction: -0.5, resetTime: '2026-05-28T09:41:56Z' } }),
          'under': gated({ quotaInfo: { remainingFraction: 1.5, resetTime: '2026-05-28T09:41:56Z' } }),
        },
      },
    });
    const byKey = Object.fromEntries(out!.models.map((m) => [m.modelKey, m]));
    expect(byKey.over.utilization).toBe(100);
    expect(byKey.under.utilization).toBe(0);
  });

  it('accepts unix-seconds and unix-ms resetTime', () => {
    const out = parseModelsResponse({
      response: {
        models: {
          'sec': gated({ quotaInfo: { remainingFraction: 0.5, resetTime: 1779694268 } }),
          'ms':  gated({ quotaInfo: { remainingFraction: 0.5, resetTime: 1779694268000 } }),
        },
      },
    });
    const byKey = Object.fromEntries(out!.models.map((m) => [m.modelKey, m]));
    expect(byKey.sec.resetsAt).toBe(1779694268 * 1000);
    expect(byKey.ms.resetsAt).toBe(1779694268000);
  });

  it('falls back to modelKey when displayName is missing', () => {
    const out = parseModelsResponse({
      response: {
        models: {
          'fallback-key': gated({ displayName: undefined }),
        },
      },
    });
    expect(out?.models[0].displayName).toBe('fallback-key');
  });

  it('sorts recommended first, then most depleted', () => {
    const out = parseModelsResponse({
      response: {
        models: {
          'a-recommended-plenty':   gated({ recommended: true,  quotaInfo: { remainingFraction: 0.9, resetTime: '2026-05-28T09:41:56Z' } }),
          'b-recommended-depleted': gated({ recommended: true,  quotaInfo: { remainingFraction: 0.1, resetTime: '2026-05-28T09:41:56Z' } }),
          'c-other-depleted':       gated({ recommended: false, quotaInfo: { remainingFraction: 0.05, resetTime: '2026-05-28T09:41:56Z' } }),
          'd-other-plenty':         gated({ recommended: false, quotaInfo: { remainingFraction: 0.8, resetTime: '2026-05-28T09:41:56Z' } }),
        },
      },
    });
    const keys = out!.models.map((m) => m.modelKey);
    expect(keys).toEqual([
      'b-recommended-depleted',
      'a-recommended-plenty',
      'c-other-depleted',
      'd-other-plenty',
    ]);
  });

  it('skips entries whose quotaInfo is missing entirely', () => {
    const out = parseModelsResponse({
      response: {
        models: {
          'gated': gated(),
          'no-quota': { displayName: 'X', resetTime: '2026-05-28T09:41:56Z' },
        },
      },
    });
    expect(out?.models.map((m) => m.modelKey)).toEqual(['gated']);
  });

  it('skips entries whose remainingFraction is present but malformed', () => {
    const out = parseModelsResponse({
      response: {
        models: {
          'gated': gated(),
          'broken': gated({ quotaInfo: { remainingFraction: 'nope', resetTime: '2026-05-28T09:41:56Z' } }),
        },
      },
    });
    expect(out?.models.map((m) => m.modelKey)).toEqual(['gated']);
  });

  it('treats a missing remainingFraction (proto3 default) as exhausted', () => {
    // The IDE omits remainingFraction entirely when it's 0 — those models
    // need to surface, not get filtered out.
    const out = parseModelsResponse({
      response: {
        models: {
          'exhausted': {
            displayName: 'Gemini 3.1 Pro (Low)',
            quotaInfo: { resetTime: '2026-05-28T09:41:56Z' },
          },
        },
      },
    });
    expect(out?.models).toHaveLength(1);
    expect(out?.models[0].utilization).toBe(100);
    expect(out?.models[0].exhausted).toBe(true);
  });

  it('flags exhausted=true when remainingFraction is explicitly 0', () => {
    const out = parseModelsResponse({
      response: {
        models: {
          'm': gated({ quotaInfo: { remainingFraction: 0, resetTime: '2026-05-28T09:41:56Z' } }),
        },
      },
    });
    expect(out?.models[0].exhausted).toBe(true);
  });

  it('does not set exhausted when remaining > 0', () => {
    const out = parseModelsResponse({
      response: {
        models: {
          'm': gated({ quotaInfo: { remainingFraction: 0.01, resetTime: '2026-05-28T09:41:56Z' } }),
        },
      },
    });
    expect(out?.models[0].exhausted).toBeUndefined();
  });

  it('returns null on non-object input', () => {
    expect(parseModelsResponse(null)).toBeNull();
    expect(parseModelsResponse(undefined)).toBeNull();
    expect(parseModelsResponse('x')).toBeNull();
  });

  it('returns null when response.models is missing', () => {
    expect(parseModelsResponse({})).toBeNull();
    expect(parseModelsResponse({ response: {} })).toBeNull();
    expect(parseModelsResponse({ response: { models: null } })).toBeNull();
  });

  it('returns an empty models array when every entry is a placeholder', () => {
    const out = parseModelsResponse({
      response: { models: { a: placeholder(), b: placeholder() } },
    });
    expect(out?.models).toEqual([]);
  });
});

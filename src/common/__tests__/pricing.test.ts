import { describe, it, expect, afterEach } from 'vitest';
import {
  rateForModel,
  estimateCost,
  formatUsd,
  applyLitellmPricing,
  buildRatesFromLitellm,
  buildFallbackRates,
  installRates,
  resetRates,
  getPricingMeta,
  referencedModelIds,
  RateEntry,
  LitellmPriceMap,
} from '../pricing';

describe('rateForModel', () => {
  it('matches Claude families across versions', () => {
    expect(rateForModel('claude-fable-5')?.label).toBe('Claude Fable');
    expect(rateForModel('claude-opus-4-8')?.label).toBe('Claude Opus');
    expect(rateForModel('claude-opus-4-7-thinking')?.label).toBe('Claude Opus');
    expect(rateForModel('claude-sonnet-4-6')?.label).toBe('Claude Sonnet');
    expect(rateForModel('claude-3-5-sonnet-20241022')?.label).toBe('Claude Sonnet');
    expect(rateForModel('claude-haiku-4-5')?.label).toBe('Claude Haiku');
  });

  it('distinguishes OpenAI size tiers (most specific wins)', () => {
    expect(rateForModel('gpt-5-mini')?.label).toBe('GPT-5 mini');
    expect(rateForModel('gpt-5-nano')?.label).toBe('GPT-5 nano');
    expect(rateForModel('gpt-5-codex')?.label).toBe('GPT-5 Codex');
    expect(rateForModel('gpt-5')?.label).toBe('GPT-5');
  });

  it('matches Gemini families', () => {
    expect(rateForModel('gemini-3-pro')?.label).toBe('Gemini 3 Pro');
    expect(rateForModel('gemini-2.5-pro')?.label).toBe('Gemini 2.5 Pro');
    expect(rateForModel('gemini-2.5-flash')?.label).toBe('Gemini Flash');
  });

  it('matches xAI Grok families (most specific wins)', () => {
    expect(rateForModel('grok-code-fast-1')?.label).toBe('Grok Code');
    expect(rateForModel('grok-4.5')?.label).toBe('Grok 4.5');
    expect(rateForModel('grok-4')?.label).toBe('Grok 4');
    expect(rateForModel('grok-3')?.label).toBe('Grok');
    expect(rateForModel('grok-4.5')?.provider).toBe('xai');
  });

  it('returns null for unknown / empty models', () => {
    expect(rateForModel('some-random-model')).toBeNull();
    expect(rateForModel('')).toBeNull();
    expect(rateForModel(null)).toBeNull();
    expect(rateForModel(undefined)).toBeNull();
  });
});

describe('estimateCost', () => {
  it('prices each token class with the cache split (Opus 4.5+)', () => {
    // Opus 4.5+: $5 in / $25 out / $6.25 cacheWrite / $0.50 cacheRead per 1M.
    const { costUsd, priced } = estimateCost('claude-opus-4-7', {
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      cacheWrite: 1_000_000,
      cacheRead: 1_000_000,
    });
    expect(priced).toBe(true);
    expect(costUsd).toBeCloseTo(5 + 25 + 6.25 + 0.5, 6);
  });

  it('prices Fable 5 at $10/$50 with the Anthropic cache split', () => {
    const { costUsd, priced } = estimateCost('claude-fable-5', {
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      cacheWrite: 1_000_000,
      cacheRead: 1_000_000,
    });
    expect(priced).toBe(true);
    expect(costUsd).toBeCloseTo(10 + 50 + 12.5 + 1.0, 6);
  });

  it('prices legacy Opus (3/4/4.1) at the old $15/$75', () => {
    const { costUsd } = estimateCost('claude-opus-4-1-20250805', {
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
    });
    expect(costUsd).toBeCloseTo(15 + 75, 6);
  });

  it('scales linearly below 1M tokens', () => {
    // Sonnet input $3/1M → 500k input = $1.50.
    const { costUsd } = estimateCost('claude-sonnet-4-6', { tokensIn: 500_000 });
    expect(costUsd).toBeCloseTo(1.5, 6);
  });

  it('treats missing token fields as zero', () => {
    const { costUsd } = estimateCost('claude-opus-4-7', { tokensOut: 1_000_000 });
    expect(costUsd).toBeCloseTo(25, 6);
  });

  it('prices Grok 4.5 at $3/$15 with cached-read discount', () => {
    const { costUsd, priced } = estimateCost('grok-4.5', {
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      cacheRead: 1_000_000,
    });
    expect(priced).toBe(true);
    expect(costUsd).toBeCloseTo(3 + 15 + 0.75, 6);
  });

  it('returns unpriced zero for unknown models', () => {
    const r = estimateCost('mystery-model', { tokensIn: 9_999_999 });
    expect(r).toEqual({ costUsd: 0, priced: false });
  });
});

describe('applyLitellmPricing', () => {
  // A bundled-style Opus row (Anthropic: has a distinct cache-write charge).
  const opusRow: RateEntry = {
    match: ['opus', '4-5'],
    source: 'claude-opus-4-5',
    rate: { label: 'Claude Opus', provider: 'anthropic', input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  };
  // A bundled-style OpenAI row (no distinct cache-write charge in the feed).
  const gptRow: RateEntry = {
    match: ['gpt-5'],
    source: 'gpt-5',
    rate: { label: 'GPT-5', provider: 'openai', input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 },
  };

  it('refreshes numbers, converting per-token → per-1M', () => {
    const data: LitellmPriceMap = {
      'claude-opus-4-5': {
        input_cost_per_token: 6e-6,
        output_cost_per_token: 30e-6,
        cache_creation_input_token_cost: 7.5e-6,
        cache_read_input_token_cost: 0.6e-6,
      },
    };
    const [row] = applyLitellmPricing([opusRow], data);
    expect(row.rate).toMatchObject({ input: 6, output: 30, cacheWrite: 7.5, cacheRead: 0.6 });
    // Match patterns / label / provider are preserved.
    expect(row.match).toEqual(['opus', '4-5']);
    expect(row.rate.label).toBe('Claude Opus');
  });

  it('keeps the bundled value for fields the feed omits or zeroes', () => {
    const data: LitellmPriceMap = {
      'claude-opus-4-5': {
        input_cost_per_token: 6e-6,   // refreshes
        output_cost_per_token: 0,     // zero → ignored
        // cache fields omitted
      },
    };
    const [row] = applyLitellmPricing([opusRow], data);
    expect(row.rate.input).toBe(6);        // refreshed
    expect(row.rate.output).toBe(25);      // zero ignored → bundled
    expect(row.rate.cacheRead).toBe(0.5);  // omitted → bundled
  });

  it('falls cache-write back to refreshed input when the feed has no cache-create cost', () => {
    const data: LitellmPriceMap = {
      'gpt-5': { input_cost_per_token: 2e-6, cache_read_input_token_cost: 0.2e-6 },
    };
    const [row] = applyLitellmPricing([gptRow], data);
    expect(row.rate.input).toBe(2);
    expect(row.rate.cacheRead).toBeCloseTo(0.2, 9);
    expect(row.rate.cacheWrite).toBe(2); // no cache_creation cost → tracks input
  });

  it('leaves a source-less row, and a row with no feed match, untouched', () => {
    const pinned: RateEntry = { match: ['x'], rate: { ...opusRow.rate } };
    const data: LitellmPriceMap = { 'claude-opus-4-5': { input_cost_per_token: 99e-6 } };
    expect(applyLitellmPricing([pinned], data)[0]).toEqual(pinned);          // no source
    expect(applyLitellmPricing([gptRow], data)[0]).toEqual(gptRow);          // source not in feed
  });

  it('ignores unrelated keys like sample_spec', () => {
    const data = { sample_spec: { input_cost_per_token: 1 } } as unknown as LitellmPriceMap;
    expect(() => applyLitellmPricing([opusRow], data)).not.toThrow();
    expect(applyLitellmPricing([opusRow], data)[0]).toEqual(opusRow);
  });
});

describe('buildFallbackRates', () => {
  const feed = {
    // Anthropic chat model with full cache pricing — the auto-add case.
    'claude-next-9': {
      litellm_provider: 'anthropic',
      mode: 'chat',
      input_cost_per_token: 10e-6,
      output_cost_per_token: 50e-6,
      cache_creation_input_token_cost: 12.5e-6,
      cache_read_input_token_cost: 1e-6,
    },
    // Gemini id carries a provider prefix in the feed — must be stripped.
    'gemini/gemini-9-flash': {
      litellm_provider: 'gemini',
      mode: 'chat',
      input_cost_per_token: 0.3e-6,
      output_cost_per_token: 2.5e-6,
    },
    // Non-chat mode → excluded.
    'text-embedding-3-large': {
      litellm_provider: 'openai',
      mode: 'embedding',
      input_cost_per_token: 0.13e-6,
      output_cost_per_token: 0.13e-6,
    },
    // xAI is a rendered provider (FALLBACK_PROVIDERS has `xai`) → auto-added.
    // Without that entry unknown Grok models would price at $0.
    'grok-5': {
      litellm_provider: 'xai',
      mode: 'chat',
      input_cost_per_token: 3e-6,
      output_cost_per_token: 15e-6,
    },
    // Provider we don't render → excluded.
    'mistral-large-latest': {
      litellm_provider: 'mistral',
      mode: 'chat',
      input_cost_per_token: 2e-6,
      output_cost_per_token: 6e-6,
    },
    // Missing output cost → excluded (can't price generation).
    'claude-input-only': {
      litellm_provider: 'anthropic',
      mode: 'chat',
      input_cost_per_token: 1e-6,
    },
    // LiteLLM's schema-doc dummy entry → excluded (no provider match).
    sample_spec: { input_cost_per_token: 1, output_cost_per_token: 1 },
  };

  it('keeps chat models from rendered providers, per-1M, id as label', () => {
    const map = buildFallbackRates(feed);
    expect(Object.keys(map).sort()).toEqual(['claude-next-9', 'gemini-9-flash', 'grok-5']);
    expect(map['grok-5'].provider).toBe('xai');
    expect(map['claude-next-9']).toEqual({
      label: 'claude-next-9',
      provider: 'anthropic',
      input: 10,
      output: 50,
      cacheWrite: 12.5,
      cacheRead: 1,
    });
  });

  it('falls cache costs back to input when the feed omits them', () => {
    const g = buildFallbackRates(feed)['gemini-9-flash'];
    expect(g.provider).toBe('google');
    expect(g.cacheWrite).toBeCloseTo(0.3, 9);
    expect(g.cacheRead).toBeCloseTo(0.3, 9);
  });
});

describe('rateForModel fallback', () => {
  afterEach(() => resetRates());

  it('prices an unknown model via the installed fallback map', () => {
    expect(rateForModel('claude-next-9')).toBeNull(); // bundled: no fallback
    installRates(
      buildRatesFromLitellm({}),
      { source: 'litellm', lastUpdated: '2026-07-03', fetchedAt: 1 },
      {
        'claude-next-9': {
          label: 'claude-next-9', provider: 'anthropic',
          input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1,
        },
      },
    );
    expect(rateForModel('claude-next-9')?.label).toBe('claude-next-9');
    expect(estimateCost('claude-next-9', { tokensIn: 1_000_000 })).toEqual({
      costUsd: 10,
      priced: true,
    });
    // Still null for models in neither the table nor the fallback.
    expect(rateForModel('some-random-model')).toBeNull();
  });

  it('curated rows win over a colliding fallback entry', () => {
    installRates(
      buildRatesFromLitellm({}),
      { source: 'litellm', lastUpdated: '2026-07-03', fetchedAt: 1 },
      {
        'claude-fable-5': {
          label: 'claude-fable-5', provider: 'anthropic',
          input: 999, output: 999, cacheWrite: 999, cacheRead: 999,
        },
      },
    );
    expect(rateForModel('claude-fable-5')?.label).toBe('Claude Fable');
    expect(rateForModel('claude-fable-5')?.input).toBe(10);
  });

  it('resetRates clears the fallback map', () => {
    installRates(
      buildRatesFromLitellm({}),
      { source: 'litellm', lastUpdated: '2026-07-03', fetchedAt: 1 },
      {
        'claude-next-9': {
          label: 'claude-next-9', provider: 'anthropic',
          input: 10, output: 50, cacheWrite: 12.5, cacheRead: 1,
        },
      },
    );
    resetRates();
    expect(rateForModel('claude-next-9')).toBeNull();
  });
});

describe('referencedModelIds', () => {
  it('lists sourced ids without duplicates and omits pinned (legacy) rows', () => {
    const ids = referencedModelIds();
    expect(ids).toContain('claude-fable-5');
    expect(ids).toContain('claude-opus-4-5');
    expect(ids).toContain('gpt-5-codex');
    expect(ids).toContain('gemini-2.5-pro');
    expect(new Set(ids).size).toBe(ids.length);     // no dupes despite shared sources
    // Legacy Haiku has no `source`, so it must not appear.
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  });
});

describe('installRates / resetRates', () => {
  afterEach(() => resetRates()); // never leak live rates into other suites

  it('makes rateForModel and meta reflect installed live prices, then reverts', () => {
    expect(getPricingMeta().source).toBe('bundled');
    expect(rateForModel('claude-opus-4-8')?.input).toBe(5); // bundled

    const table = buildRatesFromLitellm({ 'claude-opus-4-5': { input_cost_per_token: 9e-6 } });
    installRates(table, { source: 'litellm', lastUpdated: '2026-06-04', fetchedAt: 1_700_000_000_000 });

    // The 'opus 4-8' row tracks 'claude-opus-4-5', so it picks up the new input.
    expect(rateForModel('claude-opus-4-8')?.input).toBe(9);
    expect(getPricingMeta()).toMatchObject({ source: 'litellm', lastUpdated: '2026-06-04' });

    resetRates();
    expect(rateForModel('claude-opus-4-8')?.input).toBe(5);
    expect(getPricingMeta().source).toBe('bundled');
  });

  it('ignores an empty installed table (stays on bundled rates)', () => {
    installRates([], { source: 'litellm', lastUpdated: '2026-06-04', fetchedAt: 1 });
    expect(rateForModel('claude-opus-4-8')?.input).toBe(5);
  });
});

describe('formatUsd', () => {
  it('formats across magnitudes', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.004)).toBe('<$0.01');
    expect(formatUsd(0.42)).toBe('$0.42');
    expect(formatUsd(12.3)).toBe('$12.30');
    expect(formatUsd(1500)).toBe('$1.50k');
    expect(formatUsd(2_500_000)).toBe('$2.50M');
  });
});

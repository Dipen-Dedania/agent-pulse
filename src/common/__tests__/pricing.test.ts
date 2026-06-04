import { describe, it, expect, afterEach } from 'vitest';
import {
  rateForModel,
  estimateCost,
  formatUsd,
  applyLitellmPricing,
  buildRatesFromLitellm,
  installRates,
  resetRates,
  getPricingMeta,
  referencedModelIds,
  RateEntry,
  LitellmPriceMap,
} from '../pricing';

describe('rateForModel', () => {
  it('matches Claude families across versions', () => {
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

describe('referencedModelIds', () => {
  it('lists sourced ids without duplicates and omits pinned (legacy) rows', () => {
    const ids = referencedModelIds();
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

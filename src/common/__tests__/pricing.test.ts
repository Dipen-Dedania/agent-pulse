import { describe, it, expect } from 'vitest';
import { rateForModel, estimateCost, formatUsd } from '../pricing';

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
  it('prices each token class with the cache split (Opus)', () => {
    // Opus: $15 in / $75 out / $18.75 cacheWrite / $1.50 cacheRead per 1M.
    const { costUsd, priced } = estimateCost('claude-opus-4-7', {
      tokensIn: 1_000_000,
      tokensOut: 1_000_000,
      cacheWrite: 1_000_000,
      cacheRead: 1_000_000,
    });
    expect(priced).toBe(true);
    expect(costUsd).toBeCloseTo(15 + 75 + 18.75 + 1.5, 6);
  });

  it('scales linearly below 1M tokens', () => {
    // Sonnet input $3/1M → 500k input = $1.50.
    const { costUsd } = estimateCost('claude-sonnet-4-6', { tokensIn: 500_000 });
    expect(costUsd).toBeCloseTo(1.5, 6);
  });

  it('treats missing token fields as zero', () => {
    const { costUsd } = estimateCost('claude-opus-4-7', { tokensOut: 1_000_000 });
    expect(costUsd).toBeCloseTo(75, 6);
  });

  it('returns unpriced zero for unknown models', () => {
    const r = estimateCost('mystery-model', { tokensIn: 9_999_999 });
    expect(r).toEqual({ costUsd: 0, priced: false });
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

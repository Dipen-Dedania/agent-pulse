import { describe, it, expect } from 'vitest';
import { parseStatusLinePayload } from '../statusline';

// The statusline stdin schema is CC-version-dependent: every section is
// optional, field spellings vary (used_percentage/utilization, resets_at as
// seconds/ms/ISO), and partial payloads must still yield partial snapshots.

const NOW = 1_757_900_000_000;

const fullPayload = {
  session_id: 'sess-1',
  transcript_path: 'C:\\Users\\test\\.claude\\projects\\p\\sess-1.jsonl',
  model: { id: 'claude-opus-5', display_name: 'Opus' },
  cost: { total_cost_usd: 1.2345, total_duration_ms: 60_000 },
  context_window: { used_percentage: 42.5, context_window_size: 200000 },
  rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 1_757_903_600 },       // unix seconds
    seven_day: { utilization: 41, resets_at: '2026-09-20T00:00:00Z' },    // ISO + alias
  },
  prompt_cache: { warm: true, hit_ratio: 0.91, misses: 2, ttl: '1h', expires_at: 1_757_903_600 },
};

describe('parseStatusLinePayload', () => {
  it('parses a full payload', () => {
    const snap = parseStatusLinePayload(fullPayload, NOW);
    expect(snap).not.toBeNull();
    expect(snap!.sessionId).toBe('sess-1');
    expect(snap!.receivedAt).toBe(NOW);
    expect(snap!.model).toBe('claude-opus-5');
    expect(snap!.costUsd).toBeCloseTo(1.2345);
    expect(snap!.contextUsedPct).toBeCloseTo(42.5);
    expect(snap!.rateLimits).toEqual({
      fiveHour: { utilization: 23.5, resetsAt: 1_757_903_600_000 },
      sevenDay: { utilization: 41, resetsAt: Date.parse('2026-09-20T00:00:00Z') },
    });
    expect(snap!.cache).toEqual({
      warm: true,
      hitRatio: 0.91,
      misses: 2,
      ttlSeconds: 3600,
      expiresAt: 1_757_903_600_000,
    });
    expect(snap!.transcriptPath).toContain('sess-1.jsonl');
  });

  it('returns null without a session_id', () => {
    const { session_id: _drop, ...rest } = fullPayload;
    expect(parseStatusLinePayload(rest, NOW)).toBeNull();
    expect(parseStatusLinePayload({ ...fullPayload, session_id: '' }, NOW)).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(parseStatusLinePayload(null, NOW)).toBeNull();
    expect(parseStatusLinePayload('nope', NOW)).toBeNull();
    expect(parseStatusLinePayload(42, NOW)).toBeNull();
  });

  it('yields a partial snapshot when sections are missing', () => {
    const snap = parseStatusLinePayload({ session_id: 'sess-2', cost: { total_cost_usd: 0.5 } }, NOW);
    expect(snap).not.toBeNull();
    expect(snap!.costUsd).toBe(0.5);
    expect(snap!.rateLimits).toBeUndefined();
    expect(snap!.cache).toBeUndefined();
    expect(snap!.contextUsedPct).toBeUndefined();
  });

  it('drops a half-parsed rate_limits pair instead of emitting it', () => {
    const snap = parseStatusLinePayload({
      session_id: 'sess-3',
      rate_limits: { five_hour: { used_percentage: 10, resets_at: 1_757_903_600 } }, // no seven_day
    }, NOW);
    expect(snap).not.toBeNull();
    expect(snap!.rateLimits).toBeUndefined();
  });

  it('clamps used_percentage into 0..100 and hit_ratio into 0..1', () => {
    const snap = parseStatusLinePayload({
      session_id: 'sess-4',
      context_window: { used_percentage: 140 },
      prompt_cache: { hit_ratio: 1.5 },
    }, NOW);
    expect(snap!.contextUsedPct).toBe(100);
    expect(snap!.cache?.hitRatio).toBe(1);
  });

  it('handles resets_at already in milliseconds and numeric-string percentages', () => {
    const snap = parseStatusLinePayload({
      session_id: 'sess-5',
      rate_limits: {
        five_hour: { used_percentage: '23', resets_at: 1_757_903_600_000 },
        seven_day: { used_percentage: 41, resets_at: 1_757_990_000_000 },
      },
    }, NOW);
    expect(snap!.rateLimits?.fiveHour).toEqual({ utilization: 23, resetsAt: 1_757_903_600_000 });
  });

  it('falls back to display_name when model.id is absent, and accepts numeric ttl', () => {
    const snap = parseStatusLinePayload({
      session_id: 'sess-6',
      model: { display_name: 'Opus' },
      prompt_cache: { ttl: 300 },
    }, NOW);
    expect(snap!.model).toBe('Opus');
    expect(snap!.cache?.ttlSeconds).toBe(300);
  });
});

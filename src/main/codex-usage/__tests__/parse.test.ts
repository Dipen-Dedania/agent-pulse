import { describe, it, expect, vi } from 'vitest';
import { mergeCodexSnapshot, parseRolloutRateLimits, parseUsageResponse } from '../parse';
import { CodexUsageSnapshot } from '../../../common/types';

const ok = (overrides: object = {}) => ({
  rate_limit: {
    primary_window: {
      used_percent: 25,
      limit_window_seconds: 604800,
      reset_after_seconds: 501635,
      reset_at: 1779694268,
    },
    secondary_window: null,
    ...overrides,
  },
});

// Verified live payload shape (codex-cli 0.160.0, Team plan, 2026-10-05).
const teamPayload = {
  user_id: 'x', account_id: 'x', email: 'x',
  plan_type: 'team',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: { used_percent: 90, limit_window_seconds: 18000, reset_after_seconds: 12222, reset_at: 1791202340 },
    secondary_window: { used_percent: 14, limit_window_seconds: 604800, reset_after_seconds: 599022, reset_at: 1791789140 },
  },
  code_review_rate_limit: null,
  additional_rate_limits: null,
  model_usage: {
    'gpt-6-astra': { available: true, available_at: null, credits_would_enable: false },
  },
  credits: {
    has_credits: false, unlimited: false, overage_limit_reached: false,
    balance: null, approx_local_messages: null, approx_cloud_messages: null,
  },
  spend_control: { reached: false, individual_limit: null },
  rate_limit_reached_type: null,
  promo: null,
  rate_limit_reset_credits: { available_count: 0, applicable_available_count: 0 },
};

// Verified rollout `rate_limits` object (same session).
const rolloutRateLimits = {
  limit_id: 'codex', limit_name: null,
  primary: { used_percent: 90.0, window_minutes: 300, resets_at: 1791202340 },
  secondary: { used_percent: 14.0, window_minutes: 10080, resets_at: 1791789140 },
  credits: { has_credits: false, unlimited: false, balance: null },
  individual_limit: null, spend_control_reached: null,
  plan_type: 'team', rate_limit_reached_type: null,
};

describe('parseUsageResponse (codex)', () => {
  it('parses canonical shape with primary only', () => {
    const out = parseUsageResponse(ok());
    expect(out).toEqual({
      primary: { utilization: 25, resetsAt: 1779694268 * 1000, windowSeconds: 604800 },
      source: 'http',
      limitReached: false,
      limitReachedType: null,
      spendControlReached: false,
    });
  });

  it('includes secondary window when present', () => {
    const out = parseUsageResponse({
      rate_limit: {
        primary_window: { used_percent: 25, reset_at: 1779694268 },
        secondary_window: { used_percent: 10, reset_at: 1780000000 },
      },
    });
    expect(out?.secondary).toEqual({ utilization: 10, resetsAt: 1780000000 * 1000 });
  });

  it('omits secondary when null', () => {
    const out = parseUsageResponse(ok());
    expect(out?.secondary).toBeUndefined();
  });

  it('omits secondary when shape is unrecognized rather than failing the whole parse', () => {
    const out = parseUsageResponse({
      rate_limit: {
        primary_window: { used_percent: 5, reset_at: 1779694268 },
        secondary_window: { used_percent: 'nope' },
      },
    });
    expect(out?.primary).toBeDefined();
    expect(out?.secondary).toBeUndefined();
  });

  it('accepts ISO 8601 reset_at', () => {
    const out = parseUsageResponse({
      rate_limit: {
        primary_window: { used_percent: 5, reset_at: '2026-05-26T12:00:00Z' },
      },
    });
    expect(out?.primary.resetsAt).toBe(Date.parse('2026-05-26T12:00:00Z'));
  });

  it('accepts already-ms reset_at', () => {
    const ms = 1779694268000;
    const out = parseUsageResponse({
      rate_limit: { primary_window: { used_percent: 5, reset_at: ms } },
    });
    expect(out?.primary.resetsAt).toBe(ms);
  });

  it('falls back to reset_after_seconds when reset_at is missing', () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const out = parseUsageResponse({
      rate_limit: { primary_window: { used_percent: 5, reset_after_seconds: 60 } },
    });
    expect(out?.primary.resetsAt).toBe(now + 60_000);
    vi.useRealTimers();
  });

  it('coerces numeric strings for used_percent', () => {
    const out = parseUsageResponse({
      rate_limit: { primary_window: { used_percent: '42', reset_at: 1779694268 } },
    });
    expect(out?.primary.utilization).toBe(42);
  });

  it('clamps utilization above 100 or below 0', () => {
    const high = parseUsageResponse({
      rate_limit: { primary_window: { used_percent: 150, reset_at: 1779694268 } },
    });
    const low = parseUsageResponse({
      rate_limit: { primary_window: { used_percent: -5, reset_at: 1779694268 } },
    });
    expect(high?.primary.utilization).toBe(100);
    expect(low?.primary.utilization).toBe(0);
  });

  it('returns null when rate_limit is absent', () => {
    expect(parseUsageResponse({})).toBeNull();
    expect(parseUsageResponse({ rate_limit: null })).toBeNull();
  });

  it('returns null when primary_window is missing', () => {
    expect(parseUsageResponse({ rate_limit: { secondary_window: null } })).toBeNull();
  });

  it('returns null when used_percent is non-numeric', () => {
    expect(parseUsageResponse({
      rate_limit: { primary_window: { used_percent: 'oops', reset_at: 1 } },
    })).toBeNull();
  });

  it('returns null when reset cannot be parsed at all', () => {
    expect(parseUsageResponse({
      rate_limit: { primary_window: { used_percent: 5, reset_at: 'not-a-date' } },
    })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseUsageResponse(null)).toBeNull();
    expect(parseUsageResponse(undefined)).toBeNull();
    expect(parseUsageResponse('string')).toBeNull();
    expect(parseUsageResponse(42)).toBeNull();
  });

  // ─── Window lengths, plan, credits, models (F1/F2) ──────────────────────

  it('reads limit_window_seconds on both windows of a Team-plan payload', () => {
    const out = parseUsageResponse(teamPayload)!;
    expect(out.primary).toEqual({ utilization: 90, resetsAt: 1791202340_000, windowSeconds: 18000 });
    expect(out.secondary).toEqual({ utilization: 14, resetsAt: 1791789140_000, windowSeconds: 604800 });
  });

  it('ignores a non-positive limit_window_seconds', () => {
    const out = parseUsageResponse(ok({ primary_window: { used_percent: 1, reset_at: 1, limit_window_seconds: 0 } }));
    expect(out?.primary.windowSeconds).toBeUndefined();
  });

  it('extracts plan, credits, spend control and model availability', () => {
    const out = parseUsageResponse(teamPayload)!;
    expect(out.planType).toBe('team');
    expect(out.credits).toEqual({ hasCredits: false, unlimited: false, balance: null, overageLimitReached: false });
    expect(out.spendControlReached).toBe(false);
    expect(out.limitReached).toBe(false);
    expect(out.limitReachedType).toBeNull();
    expect(out.models).toEqual([{ model: 'gpt-6-astra', available: true, creditsWouldEnable: false }]);
    expect(out.review).toBeUndefined();
    expect(out.source).toBe('http');
  });

  it('flags limitReached from rate_limit.limit_reached, spend_control or a reached type', () => {
    const viaFlag = parseUsageResponse({ ...teamPayload, rate_limit: { ...teamPayload.rate_limit, limit_reached: true } })!;
    expect(viaFlag.limitReached).toBe(true);

    const viaSpend = parseUsageResponse({ ...teamPayload, spend_control: { reached: true, individual_limit: 50 } })!;
    expect(viaSpend.limitReached).toBe(true);
    expect(viaSpend.spendControlReached).toBe(true);

    const viaType = parseUsageResponse({ ...teamPayload, rate_limit_reached_type: 'primary' })!;
    expect(viaType.limitReached).toBe(true);
    expect(viaType.limitReachedType).toBe('primary');
  });

  it('parses model available_at as seconds or ISO', () => {
    const out = parseUsageResponse({
      ...teamPayload,
      model_usage: {
        a: { available: false, available_at: 1791202340, credits_would_enable: true },
        b: { available: false, available_at: '2026-10-05T12:00:00Z' },
        c: 'garbage',
      },
    })!;
    expect(out.models).toEqual([
      { model: 'a', available: false, availableAt: 1791202340_000, creditsWouldEnable: true },
      { model: 'b', available: false, availableAt: Date.parse('2026-10-05T12:00:00Z') },
    ]);
  });

  it('reads code_review_rate_limit when it mirrors the rate_limit shape', () => {
    const out = parseUsageResponse({
      ...teamPayload,
      code_review_rate_limit: {
        primary_window: { used_percent: 40, limit_window_seconds: 604800, reset_at: 1791789140 },
      },
    })!;
    expect(out.review).toEqual({ utilization: 40, resetsAt: 1791789140_000, windowSeconds: 604800 });
  });

  it('drops code_review_rate_limit on shape mismatch', () => {
    const out = parseUsageResponse({ ...teamPayload, code_review_rate_limit: { used_percent: 40 } })!;
    expect(out.review).toBeUndefined();
  });

  it('omits credits / plan when absent or malformed', () => {
    const out = parseUsageResponse(ok())!;
    expect(out.credits).toBeUndefined();
    expect(out.planType).toBeUndefined();
    expect(out.models).toBeUndefined();
    const weird = parseUsageResponse({ ...ok(), plan_type: '   ', credits: 'nope', model_usage: [] })!;
    expect(weird.planType).toBeUndefined();
    expect(weird.credits).toBeUndefined();
    expect(weird.models).toBeUndefined();
  });
});

describe('parseRolloutRateLimits', () => {
  it('parses the verified rollout object', () => {
    const out = parseRolloutRateLimits(rolloutRateLimits);
    expect(out).toEqual({
      primary: { utilization: 90, resetsAt: 1791202340_000, windowSeconds: 18000 },
      secondary: { utilization: 14, resetsAt: 1791789140_000, windowSeconds: 604800 },
      planType: 'team',
      credits: { hasCredits: false, unlimited: false, balance: null },
      limitReached: false,
      limitReachedType: null,
      spendControlReached: false,
      source: 'rollout',
    });
  });

  it('flags limitReached from rate_limit_reached_type or spend_control_reached', () => {
    expect(parseRolloutRateLimits({ ...rolloutRateLimits, rate_limit_reached_type: 'primary' })?.limitReached).toBe(true);
    expect(parseRolloutRateLimits({ ...rolloutRateLimits, spend_control_reached: true })?.limitReached).toBe(true);
    expect(parseRolloutRateLimits({ ...rolloutRateLimits, spend_control_reached: true })?.spendControlReached).toBe(true);
  });

  it('omits secondary when null and windowSeconds when window_minutes is absent', () => {
    const out = parseRolloutRateLimits({
      ...rolloutRateLimits,
      primary: { used_percent: 10, resets_at: 1791202340 },
      secondary: null,
    })!;
    expect(out.primary).toEqual({ utilization: 10, resetsAt: 1791202340_000 });
    expect(out.secondary).toBeUndefined();
  });

  it('returns null without a parseable primary', () => {
    expect(parseRolloutRateLimits(null)).toBeNull();
    expect(parseRolloutRateLimits({})).toBeNull();
    expect(parseRolloutRateLimits({ primary: { used_percent: 'x' } })).toBeNull();
    expect(parseRolloutRateLimits({ primary: { used_percent: 5 } })).toBeNull();
  });
});

describe('mergeCodexSnapshot', () => {
  const http: CodexUsageSnapshot = {
    primary: { utilization: 50, resetsAt: 1, windowSeconds: 18000 },
    secondary: { utilization: 5, resetsAt: 2, windowSeconds: 604800 },
    review: { utilization: 7, resetsAt: 3 },
    planType: 'team',
    credits: { hasCredits: false, unlimited: false, balance: null, overageLimitReached: false },
    models: [{ model: 'm', available: true }],
    limitReached: false,
    source: 'http',
  };
  const push: CodexUsageSnapshot = {
    primary: { utilization: 60, resetsAt: 1, windowSeconds: 18000 },
    planType: 'team',
    credits: { hasCredits: true, unlimited: false, balance: 12 },
    limitReached: false,
    source: 'rollout',
  };

  it('returns the incoming snapshot when there is no previous one', () => {
    expect(mergeCodexSnapshot(undefined, push)).toBe(push);
  });

  it('takes windows, plan and credits from the push and carries HTTP-only fields forward', () => {
    const merged = mergeCodexSnapshot(http, push);
    expect(merged.primary.utilization).toBe(60);
    expect(merged.secondary).toBeUndefined(); // absent in the push → dropped
    expect(merged.review).toEqual(http.review);
    expect(merged.models).toEqual(http.models);
    expect(merged.credits).toEqual({ hasCredits: true, unlimited: false, balance: 12, overageLimitReached: false });
    expect(merged.source).toBe('rollout');
  });

  it('does not invent credits when the push has none', () => {
    const merged = mergeCodexSnapshot(http, { ...push, credits: undefined });
    expect(merged.credits).toBeUndefined();
  });
});

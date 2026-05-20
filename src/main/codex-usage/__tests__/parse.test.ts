import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { parseUsageResponse } from '../parse';

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

describe('parseUsageResponse (codex)', () => {
  it('parses canonical shape with primary only', () => {
    const out = parseUsageResponse(ok());
    expect(out).toEqual({
      primary: { utilization: 25, resetsAt: 1779694268 * 1000 },
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
});

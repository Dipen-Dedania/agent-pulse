import { describe, it, expect } from 'vitest';
import { parseUsageResponse } from '../parse';

// The exact payload captured this session from GET /copilot_internal/user on a
// live free-plan account (improvement.md / dev-tools capture).
const realWorld = {
  login: 'Dipen-Dedania',
  access_type_sku: 'free_limited_copilot',
  copilot_plan: 'individual',
  chat_enabled: true,
  quota_snapshots: {
    chat: {
      percent_remaining: 93.8,
      quota_remaining: 187.7,
      unlimited: false,
      remaining: 187,
      entitlement: 200,
    },
    completions: {
      percent_remaining: 95.6,
      quota_remaining: 1912.0,
      unlimited: false,
      remaining: 1912,
      entitlement: 2000,
    },
    premium_interactions: {
      percent_remaining: 0.0,
      quota_remaining: 0.0,
      unlimited: false,
      remaining: 0,
      entitlement: 0,
    },
  },
  quota_reset_date: '2026-07-01',
  quota_reset_date_utc: '2026-07-01T00:00:00.000Z',
};

describe('parseUsageResponse (copilot)', () => {
  it('parses the real-world /user payload', () => {
    const out = parseUsageResponse(realWorld);
    expect(out).not.toBeNull();
    expect(out?.source).toBe('live');
    expect(out?.username).toBe('Dipen-Dedania');
    expect(out?.sku).toBe('free_limited_copilot');
    // premium_interactions (0/0) is omitted; chat + completions remain.
    expect(out?.quotas.map((q) => q.key)).toEqual(['chat', 'completions']);

    const chat = out!.quotas[0];
    expect(chat.label).toBe('Chat');
    expect(chat.remaining).toBe(187);
    expect(chat.entitlement).toBe(200);
    expect(chat.unlimited).toBe(false);
    // utilization = 100 − percent_remaining
    expect(chat.utilization).toBeCloseTo(6.2, 5);
    expect(chat.resetsAt).toBe(Date.parse('2026-07-01T00:00:00.000Z'));

    const completions = out!.quotas[1];
    expect(completions.remaining).toBe(1912);
    expect(completions.entitlement).toBe(2000);
  });

  it('keeps an unlimited window even when entitlement is 0', () => {
    const out = parseUsageResponse({
      quota_reset_date_utc: '2026-07-01T00:00:00.000Z',
      quota_snapshots: {
        chat: { percent_remaining: 50, remaining: 0, entitlement: 0, unlimited: true },
      },
    });
    expect(out?.quotas).toHaveLength(1);
    expect(out?.quotas[0].unlimited).toBe(true);
    expect(out?.quotas[0].utilization).toBe(50);
  });

  it('omits windows with zero entitlement and not unlimited', () => {
    const out = parseUsageResponse({
      quota_reset_date_utc: '2026-07-01T00:00:00.000Z',
      quota_snapshots: {
        chat: { percent_remaining: 100, remaining: 0, entitlement: 0, unlimited: false },
      },
    });
    expect(out?.quotas).toEqual([]);
  });

  it('clamps utilization to 0–100', () => {
    const out = parseUsageResponse({
      quota_reset_date_utc: '2026-07-01T00:00:00.000Z',
      quota_snapshots: {
        chat: { percent_remaining: 150, remaining: 5, entitlement: 10, unlimited: false },
        completions: { percent_remaining: -20, remaining: 5, entitlement: 10, unlimited: false },
      },
    });
    expect(out?.quotas[0].utilization).toBe(0);    // 100 − 150 → clamp 0
    expect(out?.quotas[1].utilization).toBe(100);  // 100 − (−20) → clamp 100
  });

  it('returns null when quota_snapshots is missing', () => {
    expect(parseUsageResponse({ quota_reset_date_utc: '2026-07-01T00:00:00.000Z' })).toBeNull();
  });

  it('returns null when the reset date cannot be parsed', () => {
    expect(parseUsageResponse({
      quota_reset_date_utc: 'not-a-date',
      quota_snapshots: { chat: { percent_remaining: 50, remaining: 1, entitlement: 2 } },
    })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseUsageResponse(null)).toBeNull();
    expect(parseUsageResponse(undefined)).toBeNull();
    expect(parseUsageResponse('string')).toBeNull();
    expect(parseUsageResponse(42)).toBeNull();
  });
});

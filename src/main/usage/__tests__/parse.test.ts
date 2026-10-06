import { describe, it, expect } from 'vitest';
import { mergeUsageSnapshot, parseUsageResponse } from '../parse';

describe('parseUsageResponse', () => {
  it('parses canonical shape with utilization + unix seconds', () => {
    const out = parseUsageResponse({
      five_hour: { utilization: 42, resets_at: 1742651200 },
      seven_day: { utilization: 18, resets_at: 1743120000 },
    });
    expect(out).toEqual({
      fiveHour: { utilization: 42, resetsAt: 1742651200 * 1000 },
      sevenDay: { utilization: 18, resetsAt: 1743120000 * 1000 },
    });
  });

  it('accepts used_percentage as an alias for utilization', () => {
    const out = parseUsageResponse({
      five_hour: { used_percentage: 12, resets_at: 1742651200 },
      seven_day: { used_percentage: 80, resets_at: 1743120000 },
    });
    expect(out?.fiveHour.utilization).toBe(12);
    expect(out?.sevenDay.utilization).toBe(80);
  });

  it('accepts ISO 8601 strings for resets_at', () => {
    const out = parseUsageResponse({
      five_hour: { utilization: 5, resets_at: '2026-05-19T12:00:00Z' },
      seven_day: { utilization: 6, resets_at: '2026-05-26T12:00:00Z' },
    });
    expect(out?.fiveHour.resetsAt).toBe(Date.parse('2026-05-19T12:00:00Z'));
    expect(out?.sevenDay.resetsAt).toBe(Date.parse('2026-05-26T12:00:00Z'));
  });

  it('accepts already-ms numeric timestamps', () => {
    const ms = 1742651200000;
    const out = parseUsageResponse({
      five_hour: { utilization: 1, resets_at: ms },
      seven_day: { utilization: 2, resets_at: ms },
    });
    expect(out?.fiveHour.resetsAt).toBe(ms);
  });

  it('coerces numeric strings for utilization', () => {
    const out = parseUsageResponse({
      five_hour: { utilization: '42', resets_at: 1742651200 },
      seven_day: { utilization: '18', resets_at: 1743120000 },
    });
    expect(out?.fiveHour.utilization).toBe(42);
    expect(out?.sevenDay.utilization).toBe(18);
  });

  it('clamps utilization above 100 or below 0', () => {
    const out = parseUsageResponse({
      five_hour: { utilization: 150, resets_at: 1742651200 },
      seven_day: { utilization: -5, resets_at: 1743120000 },
    });
    expect(out?.fiveHour.utilization).toBe(100);
    expect(out?.sevenDay.utilization).toBe(0);
  });

  it('returns null when either window is missing', () => {
    expect(parseUsageResponse({ five_hour: { utilization: 10, resets_at: 1 } })).toBeNull();
    expect(parseUsageResponse({ seven_day: { utilization: 10, resets_at: 1 } })).toBeNull();
  });

  it('returns null when utilization is non-numeric or absent', () => {
    expect(parseUsageResponse({
      five_hour: { utilization: 'oops', resets_at: 1 },
      seven_day: { utilization: 10, resets_at: 1 },
    })).toBeNull();
    expect(parseUsageResponse({
      five_hour: { resets_at: 1 },
      seven_day: { utilization: 10, resets_at: 1 },
    })).toBeNull();
  });

  it('returns null when resets_at is unparseable', () => {
    expect(parseUsageResponse({
      five_hour: { utilization: 10, resets_at: 'not-a-date' },
      seven_day: { utilization: 10, resets_at: 1 },
    })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseUsageResponse(null)).toBeNull();
    expect(parseUsageResponse(undefined)).toBeNull();
    expect(parseUsageResponse('string')).toBeNull();
    expect(parseUsageResponse(42)).toBeNull();
  });
});


// ─── Extra usage (credits) + scoped limits ───────────────────────────────────
// Fixture mirrors a live 2026-10 Team-seat payload (identifiers removed).

describe('parseUsageResponse — extra usage & scoped limits', () => {
  const base = {
    five_hour: { utilization: 34, resets_at: '2026-10-05T14:09:59Z' },
    seven_day: { utilization: 11, resets_at: '2026-10-10T20:59:59Z' },
  };

  it('parses a Team-seat extra_usage block with null caps', () => {
    const out = parseUsageResponse({
      ...base,
      extra_usage: {
        is_enabled: true, monthly_limit: null, used_credits: 0.0, utilization: null,
        currency: 'USD', decimal_places: 2, disabled_reason: null, user_disabled: false,
        spend_limit_reached: false, credits_ever_enabled: true, daily: null, weekly: null,
      },
      spend: {
        used: { amount_minor: 0, currency: 'USD', exponent: 2 }, limit: null, percent: 0,
        severity: 'normal', enabled: true, disabled_reason: null, cap: null, balance: null,
        auto_reload: null, can_purchase_credits: false, can_toggle: false,
      },
    });
    expect(out?.extraUsage).toEqual({
      enabled: true,
      usedCredits: 0,
      monthlyLimit: null,
      utilization: 0,
      balance: null,
      currency: 'USD',
      spendLimitReached: false,
      userDisabled: false,
      canPurchaseCredits: false,
    });
    expect(out?.scopedLimits).toBeUndefined();
  });

  it('reads a $10 member spend limit (live Team payload, 2026-10)', () => {
    const out = parseUsageResponse({
      ...base,
      extra_usage: {
        is_enabled: true, monthly_limit: 1000, used_credits: 0.0, utilization: null,
        currency: 'USD', decimal_places: 2, user_disabled: false, spend_limit_reached: false,
      },
      spend: {
        used: { amount_minor: 0, currency: 'USD', exponent: 2 },
        limit: { amount_minor: 1000, currency: 'USD', exponent: 2 },
        percent: 0, severity: 'normal', enabled: true,
        cap: { money: null, credits: { amount_minor: 1000, exponent: 2 } },
        balance: null, auto_reload: null, can_purchase_credits: false, can_toggle: false,
      },
    });
    expect(out?.extraUsage).toMatchObject({
      enabled: true, usedCredits: 0, monthlyLimit: 10, utilization: 0, balance: null, currency: 'USD',
    });
  });

  it('prefers self-describing spend.* objects and reads the cap wrapper', () => {
    const out = parseUsageResponse({
      ...base,
      // extra_usage bare numbers are minor units; here they deliberately disagree
      // with spend.* so the test proves spend wins.
      extra_usage: { is_enabled: true, monthly_limit: 99, used_credits: 99, utilization: 25, currency: 'USD' },
      spend: {
        used: { amount_minor: 1250, currency: 'USD', exponent: 2 },
        balance: { amount_minor: 3775, currency: 'USD', exponent: 2 },
        cap: { money: { amount_minor: 5000, currency: 'USD', exponent: 2 }, credits: null },
        can_purchase_credits: true,
      },
    });
    expect(out?.extraUsage).toMatchObject({
      enabled: true,
      usedCredits: 12.5,     // spend.used wins over extra_usage.used_credits
      monthlyLimit: 50,      // no spend.limit → spend.cap.money
      utilization: 25,       // extra_usage.utilization wins over spend.percent
      balance: 37.75,        // only spend carries balance
      canPurchaseCredits: true,
    });
  });

  it('scales extra_usage bare numbers by decimal_places when spend is absent', () => {
    const out = parseUsageResponse({
      ...base,
      extra_usage: { is_enabled: true, monthly_limit: 1000, used_credits: 250, decimal_places: 2, currency: 'USD' },
    });
    expect(out?.extraUsage).toMatchObject({ usedCredits: 2.5, monthlyLimit: 10 });

    const threeDp = parseUsageResponse({
      ...base,
      extra_usage: { is_enabled: true, monthly_limit: 10000, used_credits: 0, decimal_places: 3, currency: 'KWD' },
    });
    expect(threeDp?.extraUsage).toMatchObject({ monthlyLimit: 10, currency: 'KWD' });
  });

  it('falls back to spend.* when extra_usage is missing', () => {
    const out = parseUsageResponse({
      ...base,
      spend: {
        used: { amount_minor: 999, currency: 'EUR', exponent: 2 },
        limit: { amount_minor: 10000, currency: 'EUR', exponent: 2 },
        percent: 10, enabled: false,
      },
    });
    expect(out?.extraUsage).toMatchObject({
      enabled: false, usedCredits: 9.99, monthlyLimit: 100, utilization: 10, currency: 'EUR',
    });
  });

  it('flags spend_limit_reached and user_disabled', () => {
    const out = parseUsageResponse({
      ...base,
      extra_usage: { is_enabled: false, user_disabled: true, spend_limit_reached: true },
    });
    expect(out?.extraUsage).toMatchObject({ enabled: false, userDisabled: true, spendLimitReached: true });
  });

  it('omits extraUsage when neither block is present', () => {
    const out = parseUsageResponse(base);
    expect(out).toEqual({
      fiveHour: { utilization: 34, resetsAt: Date.parse('2026-10-05T14:09:59Z') },
      sevenDay: { utilization: 11, resetsAt: Date.parse('2026-10-10T20:59:59Z') },
    });
  });

  it('extracts per-model weekly caps from limits[] and ignores other kinds', () => {
    const out = parseUsageResponse({
      ...base,
      limits: [
        { kind: 'session', group: 'session', percent: 34, resets_at: '2026-10-05T14:09:59Z', scope: null },
        { kind: 'weekly_all', group: 'weekly', percent: 11, resets_at: '2026-10-10T20:59:59Z', scope: null },
        {
          kind: 'weekly_scoped', group: 'weekly', percent: 19, resets_at: '2026-10-10T20:59:59Z',
          scope: { model: { id: null, display_name: 'Opus' }, surface: null },
        },
        // Malformed: no scope label → dropped
        { kind: 'weekly_scoped', percent: 50, resets_at: '2026-10-10T20:59:59Z', scope: { model: {} } },
      ],
    });
    expect(out?.scopedLimits).toEqual([
      { label: 'Opus', utilization: 19, resetsAt: Date.parse('2026-10-10T20:59:59Z') },
    ]);
  });

  it('folds legacy seven_day_opus/sonnet in without duplicating limits[] entries', () => {
    const out = parseUsageResponse({
      ...base,
      seven_day_opus: { utilization: 19, resets_at: '2026-10-10T20:59:59Z' },
      seven_day_sonnet: { utilization: 3, resets_at: '2026-10-10T20:59:59Z' },
      limits: [
        {
          kind: 'weekly_scoped', percent: 19, resets_at: '2026-10-10T20:59:59Z',
          scope: { model: { display_name: 'opus' } },
        },
      ],
    });
    expect(out?.scopedLimits?.map((l) => l.label)).toEqual(['opus', 'Sonnet']);
  });
});

describe('mergeUsageSnapshot', () => {
  const win = (u: number) => ({ utilization: u, resetsAt: 1_800_000_000_000 });
  const extraUsage = {
    enabled: true, usedCredits: 1, monthlyLimit: null, utilization: null, balance: null,
    currency: 'USD', spendLimitReached: false, userDisabled: false, canPurchaseCredits: false,
  };

  it('returns incoming untouched when there is no previous snapshot', () => {
    const incoming = { fiveHour: win(1), sevenDay: win(2) };
    expect(mergeUsageSnapshot(undefined, incoming)).toBe(incoming);
  });

  it('carries HTTP-only blocks forward onto a windows-only push', () => {
    const prev = {
      fiveHour: win(1), sevenDay: win(2), extraUsage, planType: 'team',
      scopedLimits: [{ label: 'Opus', utilization: 19, resetsAt: 1 }],
    };
    const merged = mergeUsageSnapshot(prev, { fiveHour: win(5), sevenDay: win(6) });
    expect(merged.fiveHour.utilization).toBe(5);
    expect(merged.extraUsage).toBe(extraUsage);
    expect(merged.planType).toBe('team');
    expect(merged.scopedLimits).toEqual(prev.scopedLimits);
  });

  it('prefers incoming values when present', () => {
    const prev = { fiveHour: win(1), sevenDay: win(2), extraUsage, planType: 'team' };
    const fresh = { ...extraUsage, usedCredits: 9 };
    const merged = mergeUsageSnapshot(prev, { fiveHour: win(5), sevenDay: win(6), extraUsage: fresh, planType: 'max' });
    expect(merged.extraUsage).toBe(fresh);
    expect(merged.planType).toBe('max');
  });
});

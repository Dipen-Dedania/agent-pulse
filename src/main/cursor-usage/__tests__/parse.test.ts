import { describe, it, expect } from 'vitest';
import { parseUsageResponse } from '../parse';

// The exact payload from improvement.md (Cursor /api/usage-summary), free tier.
const realWorld = {
  billingCycleStart: '2026-05-27T05:16:55.135Z',
  billingCycleEnd: '2026-06-27T05:16:55.135Z',
  membershipType: 'free',
  limitType: 'user',
  isUnlimited: false,
  individualUsage: {
    plan: {
      enabled: true,
      used: 0,
      limit: 0,
      remaining: 0,
      breakdown: { included: 0, bonus: 201, total: 201 },
      autoPercentUsed: 0,
      apiPercentUsed: 100,
      totalPercentUsed: 100,
    },
    onDemand: { enabled: false, used: 0, limit: null, remaining: null },
  },
  teamUsage: {},
};

describe('parseUsageResponse (cursor)', () => {
  it('parses the real-world usage-summary payload', () => {
    const out = parseUsageResponse(realWorld);
    expect(out).not.toBeNull();
    expect(out?.plan.utilization).toBe(100);
    expect(out?.plan.resetsAt).toBe(Date.parse('2026-06-27T05:16:55.135Z'));
    expect(out?.membershipType).toBe('free');
    expect(out?.used).toBe(0);
    expect(out?.limit).toBe(0);
    expect(out?.remaining).toBe(0);
    expect(out?.breakdown).toEqual({ included: 0, bonus: 201, total: 201 });
    expect(out?.onDemandEnabled).toBe(false);
  });

  it('clamps utilization above 100 / below 0', () => {
    const mk = (pct: number) => ({
      billingCycleEnd: '2026-06-27T00:00:00Z',
      individualUsage: { plan: { totalPercentUsed: pct } },
    });
    expect(parseUsageResponse(mk(150))?.plan.utilization).toBe(100);
    expect(parseUsageResponse(mk(-5))?.plan.utilization).toBe(0);
  });

  it('coerces numeric strings for totalPercentUsed', () => {
    const out = parseUsageResponse({
      billingCycleEnd: '2026-06-27T00:00:00Z',
      individualUsage: { plan: { totalPercentUsed: '42' } },
    });
    expect(out?.plan.utilization).toBe(42);
  });

  it('accepts epoch-seconds and epoch-ms billingCycleEnd', () => {
    const sec = parseUsageResponse({
      billingCycleEnd: 1782000000,
      individualUsage: { plan: { totalPercentUsed: 10 } },
    });
    const ms = parseUsageResponse({
      billingCycleEnd: 1782000000000,
      individualUsage: { plan: { totalPercentUsed: 10 } },
    });
    expect(sec?.plan.resetsAt).toBe(1782000000 * 1000);
    expect(ms?.plan.resetsAt).toBe(1782000000000);
  });

  it('omits optional fields when absent', () => {
    const out = parseUsageResponse({
      billingCycleEnd: '2026-06-27T00:00:00Z',
      individualUsage: { plan: { totalPercentUsed: 30 } },
    });
    expect(out?.used).toBeUndefined();
    expect(out?.breakdown).toBeUndefined();
    expect(out?.onDemandEnabled).toBeUndefined();
  });

  it('returns null when plan is missing', () => {
    expect(parseUsageResponse({ billingCycleEnd: '2026-06-27T00:00:00Z', individualUsage: {} })).toBeNull();
    expect(parseUsageResponse({ billingCycleEnd: '2026-06-27T00:00:00Z' })).toBeNull();
  });

  it('returns null when totalPercentUsed is non-numeric', () => {
    expect(parseUsageResponse({
      billingCycleEnd: '2026-06-27T00:00:00Z',
      individualUsage: { plan: { totalPercentUsed: 'oops' } },
    })).toBeNull();
  });

  it('returns null when billingCycleEnd cannot be parsed', () => {
    expect(parseUsageResponse({
      billingCycleEnd: 'not-a-date',
      individualUsage: { plan: { totalPercentUsed: 10 } },
    })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(parseUsageResponse(null)).toBeNull();
    expect(parseUsageResponse(undefined)).toBeNull();
    expect(parseUsageResponse('string')).toBeNull();
    expect(parseUsageResponse(42)).toBeNull();
  });
});

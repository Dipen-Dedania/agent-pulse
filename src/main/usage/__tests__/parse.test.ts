import { describe, it, expect } from 'vitest';
import { parseUsageResponse } from '../parse';

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

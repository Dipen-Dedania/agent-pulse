import { describe, it, expect } from 'vitest';
import { nextFixedFire, nextAdaptiveFire, nextNudgeFire, nextEvent, parseHHmm } from '../timing';
import { SchedulerConfig, SchedulerSlot } from '../../user-config';

// All times built with the local-time Date constructor so the assertions match
// the implementation's local-time reasoning regardless of the test runner's TZ.
// 2024-01-01 is a Monday (getDay() === 1).
const local = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo, d, h, mi, 0, 0).getTime();

const MON_10AM = local(2024, 0, 1, 10, 0);

const slot = (time: string, days: number[], enabled = true): SchedulerSlot => ({ time, days, enabled });

function cfg(partial: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    mode: 'off',
    fixed: [],
    adaptive: { workHours: { start: '09:00', end: '18:00' }, maxWindowsPerDay: 3 },
    tokenNudge: { enabled: false, leadMs: 120_000 },
    maxOpenersPerDay: 6,
    ...partial,
  };
}

describe('parseHHmm', () => {
  it('parses valid times and rejects malformed ones', () => {
    expect(parseHHmm('09:30')).toEqual({ h: 9, m: 30 });
    expect(parseHHmm('6:05')).toEqual({ h: 6, m: 5 });
    expect(parseHHmm('24:00')).toBeNull();
    expect(parseHHmm('12:60')).toBeNull();
    expect(parseHHmm('nope')).toBeNull();
  });
});

describe('nextFixedFire', () => {
  it('fires later the same day when the slot is still ahead', () => {
    const next = nextFixedFire([slot('14:00', [0, 1, 2, 3, 4, 5, 6])], MON_10AM);
    expect(next).toBe(local(2024, 0, 1, 14, 0));
  });

  it('rolls to the next day once today\'s slot has passed', () => {
    const now = local(2024, 0, 1, 15, 0);
    const next = nextFixedFire([slot('14:00', [0, 1, 2, 3, 4, 5, 6])], now);
    expect(next).toBe(local(2024, 0, 2, 14, 0));
  });

  it('honors per-day selection (skips to the next enabled weekday)', () => {
    // Monday now; slot only on Wednesday (day 3).
    const next = nextFixedFire([slot('09:00', [3])], MON_10AM);
    expect(next).toBe(local(2024, 0, 3, 9, 0));
  });

  it('picks the earliest across multiple slots', () => {
    const next = nextFixedFire(
      [slot('16:00', [1]), slot('11:00', [1]), slot('14:00', [1])],
      MON_10AM,
    );
    expect(next).toBe(local(2024, 0, 1, 11, 0));
  });

  it('returns null for empty, disabled, or day-less slots', () => {
    expect(nextFixedFire([], MON_10AM)).toBeNull();
    expect(nextFixedFire([slot('14:00', [1], false)], MON_10AM)).toBeNull();
    expect(nextFixedFire([slot('14:00', [])], MON_10AM)).toBeNull();
  });
});

describe('nextAdaptiveFire', () => {
  const wh = { start: '09:00', end: '18:00' };

  it('returns null when the daily window cap is reached', () => {
    expect(nextAdaptiveFire(MON_10AM, wh, 3, 3, MON_10AM)).toBeNull();
  });

  it('fires at the live window reset when it lands inside work hours', () => {
    const resetsAt = local(2024, 0, 1, 14, 0);
    expect(nextAdaptiveFire(resetsAt, wh, 0, 3, MON_10AM)).toBe(resetsAt);
  });

  it('pushes a pre-work-hours candidate to the day start', () => {
    const now = local(2024, 0, 1, 7, 0);
    const resetsAt = local(2024, 0, 1, 7, 30);
    expect(nextAdaptiveFire(resetsAt, wh, 0, 3, now)).toBe(local(2024, 0, 1, 9, 0));
  });

  it('pushes a post-work-hours candidate to the next day start', () => {
    const now = local(2024, 0, 1, 19, 0);
    const resetsAt = local(2024, 0, 1, 20, 0);
    expect(nextAdaptiveFire(resetsAt, wh, 0, 3, now)).toBe(local(2024, 0, 2, 9, 0));
  });

  it('uses now when there is no live window', () => {
    expect(nextAdaptiveFire(null, wh, 0, 3, MON_10AM)).toBe(MON_10AM);
  });
});

describe('nextNudgeFire', () => {
  const lead = 120_000;

  it('returns null when expiry is unknown', () => {
    expect(nextNudgeFire(null, lead, null, MON_10AM)).toBeNull();
    expect(nextNudgeFire(undefined, lead, null, MON_10AM)).toBeNull();
  });

  it('fires lead time before expiry when no opener is coming', () => {
    const expiresAt = MON_10AM + 10 * 60_000;
    expect(nextNudgeFire(expiresAt, lead, null, MON_10AM)).toBe(expiresAt - lead);
  });

  it('is suppressed when an opener arrives at or before the nudge time', () => {
    const expiresAt = MON_10AM + 10 * 60_000;
    const nudgeAt = expiresAt - lead;
    expect(nextNudgeFire(expiresAt, lead, nudgeAt - 1, MON_10AM)).toBeNull();
  });

  it('still fires when the opener is after the nudge time', () => {
    const expiresAt = MON_10AM + 10 * 60_000;
    const nudgeAt = expiresAt - lead;
    expect(nextNudgeFire(expiresAt, lead, nudgeAt + 60_000, MON_10AM)).toBe(nudgeAt);
  });

  it('clamps a past nudge time to now', () => {
    const expiresAt = MON_10AM + 30_000; // expiry inside the lead window
    expect(nextNudgeFire(expiresAt, lead, null, MON_10AM)).toBe(MON_10AM);
  });
});

describe('nextEvent', () => {
  it('returns null in off mode with the nudge disabled', () => {
    expect(nextEvent(cfg(), { openersToday: 0 }, MON_10AM)).toBeNull();
  });

  it('returns the token nudge in off mode when enabled', () => {
    const expiresAt = MON_10AM + 10 * 60_000;
    const ev = nextEvent(
      cfg({ tokenNudge: { enabled: true, leadMs: 120_000 } }),
      { expiresAt, openersToday: 0 },
      MON_10AM,
    );
    expect(ev).toEqual({ at: expiresAt - 120_000, kind: 'nudge' });
  });

  it('returns the fixed opener in fixed mode', () => {
    const ev = nextEvent(
      cfg({ mode: 'fixed', fixed: [slot('14:00', [1])] }),
      { openersToday: 0 },
      MON_10AM,
    );
    expect(ev).toEqual({ at: local(2024, 0, 1, 14, 0), kind: 'opener' });
  });

  it('suppresses openers once the daily cap is hit (nudge can still fire)', () => {
    const expiresAt = MON_10AM + 10 * 60_000;
    const ev = nextEvent(
      cfg({ mode: 'fixed', fixed: [slot('14:00', [1])], maxOpenersPerDay: 2, tokenNudge: { enabled: true, leadMs: 120_000 } }),
      { expiresAt, openersToday: 2 },
      MON_10AM,
    );
    expect(ev?.kind).toBe('nudge');
  });

  it('picks the earlier of opener and nudge', () => {
    // Opener at 14:00, nudge at 12:00 → nudge wins.
    const expiresAt = local(2024, 0, 1, 12, 2);
    const ev = nextEvent(
      cfg({ mode: 'fixed', fixed: [slot('14:00', [1])], tokenNudge: { enabled: true, leadMs: 120_000 } }),
      { expiresAt, openersToday: 0 },
      MON_10AM,
    );
    expect(ev).toEqual({ at: local(2024, 0, 1, 12, 0), kind: 'nudge' });
  });
});

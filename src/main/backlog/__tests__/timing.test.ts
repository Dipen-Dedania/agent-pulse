import { describe, it, expect } from 'vitest';
import {
  activeWindow,
  nextWindowStart,
  pickNextCard,
  forecastNextWindow,
  cardBudgetMs,
  slotOccurrence,
  DEFAULT_CARD_COST_USD,
} from '../timing';
import { BacklogCard, BacklogSlot } from '../../../common/backlog-types';

// All times built with the local-time Date constructor so the assertions match
// the implementation's local-time reasoning regardless of the test runner's TZ.
// 2024-01-01 is a Monday (getDay() === 1); 2024-01-05 is a Friday.
const local = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo, d, h, mi, 0, 0).getTime();

const slot = (start: string, end: string, days: number[], enabled = true): BacklogSlot =>
  ({ start, end, days, enabled });

const NIGHTS = slot('23:00', '07:00', [1, 2, 3, 4, 5]);      // Mon–Fri
const WEEKENDS = slot('00:00', '23:59', [6, 0]);              // Sat–Sun

function card(partial: Partial<BacklogCard>): BacklogCard {
  return {
    id: 'c1',
    title: 't',
    description: '',
    projectId: 'p1',
    state: 'todo',
    taskType: 'research',
    riskTier: 'green',
    model: null,
    estimatedMinutes: null,
    estimatedCostUsd: null,
    prereqIds: [],
    qaProvider: 'none',
    qaCommand: null,
    qaUrl: null,
    acceptanceCriteria: [],
    worktreePath: null,
    baseSha: null,
    sortOrder: 0,
    blockedReason: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe('slotOccurrence', () => {
  it('wraps an end <= start range to the next day', () => {
    const now = local(2024, 0, 1, 12, 0); // Mon noon
    const occ = slotOccurrence(NIGHTS, 0, now)!;
    expect(occ.start).toBe(local(2024, 0, 1, 23, 0));
    expect(occ.end).toBe(local(2024, 0, 2, 7, 0));
  });

  it('returns null on a non-enabled weekday or malformed times', () => {
    const satNoon = local(2024, 0, 6, 12, 0);
    expect(slotOccurrence(NIGHTS, 0, satNoon)).toBeNull(); // Sat not in Mon–Fri
    expect(slotOccurrence(slot('25:00', '07:00', [1]), 0, satNoon)).toBeNull();
    expect(slotOccurrence(slot('23:00', '07:00', []), 0, satNoon)).toBeNull();
  });

  it('treats end === start as a full 24h window', () => {
    const now = local(2024, 0, 1, 12, 0);
    const occ = slotOccurrence(slot('09:00', '09:00', [1]), 0, now)!;
    expect(occ.end - occ.start).toBe(24 * 60 * 60 * 1000);
  });
});

describe('activeWindow', () => {
  it('is active inside a same-day range', () => {
    const satNoon = local(2024, 0, 6, 12, 0);
    const win = activeWindow([WEEKENDS], satNoon)!;
    expect(win.start).toBe(local(2024, 0, 6, 0, 0));
    expect(win.end).toBe(local(2024, 0, 6, 23, 59));
  });

  it('overnight slot started yesterday is still active this morning', () => {
    // Fri 23:00–07:00 → Sat 03:00 is inside (slot belongs to its start day).
    const satEarly = local(2024, 0, 6, 3, 0);
    const win = activeWindow([NIGHTS], satEarly)!;
    expect(win.start).toBe(local(2024, 0, 5, 23, 0));
    expect(win.end).toBe(local(2024, 0, 6, 7, 0));
  });

  it('overnight slot is NOT active after its end', () => {
    expect(activeWindow([NIGHTS], local(2024, 0, 6, 8, 0))).toBeNull(); // Sat 08:00
  });

  it('overnight slot is NOT active on a morning whose previous day is disabled', () => {
    // Mon 03:00: Sunday is not in Mon–Fri, and Monday's occurrence starts 23:00.
    expect(activeWindow([NIGHTS], local(2024, 0, 1, 3, 0))).toBeNull();
  });

  it('ignores disabled slots and picks the latest end among overlaps', () => {
    const disabled = slot('00:00', '23:59', [1], false);
    expect(activeWindow([disabled], local(2024, 0, 1, 12, 0))).toBeNull();

    const short = slot('10:00', '13:00', [1]);
    const long = slot('11:00', '18:00', [1]);
    const win = activeWindow([short, long], local(2024, 0, 1, 12, 0))!;
    expect(win.end).toBe(local(2024, 0, 1, 18, 0));
  });
});

describe('nextWindowStart', () => {
  it('finds the start later the same day', () => {
    expect(nextWindowStart([NIGHTS], local(2024, 0, 1, 12, 0)))
      .toBe(local(2024, 0, 1, 23, 0));
  });

  it('rolls across the week to the next enabled day', () => {
    // Sat 08:00 → next nights window is Mon 23:00.
    expect(nextWindowStart([NIGHTS], local(2024, 0, 6, 8, 0)))
      .toBe(local(2024, 0, 8, 23, 0));
  });

  it('returns the NEXT start even while a window is currently active', () => {
    // Sat noon inside the weekend slot → next start is Sunday 00:00.
    expect(nextWindowStart([WEEKENDS], local(2024, 0, 6, 12, 0)))
      .toBe(local(2024, 0, 7, 0, 0));
  });

  it('returns null when nothing can open', () => {
    expect(nextWindowStart([], local(2024, 0, 1, 12, 0))).toBeNull();
    expect(nextWindowStart([slot('23:00', '07:00', [1], false)], local(2024, 0, 1, 12, 0))).toBeNull();
  });
});

describe('cardBudgetMs', () => {
  it('defaults to 30 min and clamps estimates to [5, 120]', () => {
    expect(cardBudgetMs(card({ estimatedMinutes: null }))).toBe(30 * 60_000);
    expect(cardBudgetMs(card({ estimatedMinutes: 1 }))).toBe(5 * 60_000);
    expect(cardBudgetMs(card({ estimatedMinutes: 600 }))).toBe(120 * 60_000);
    expect(cardBudgetMs(card({ estimatedMinutes: 45 }))).toBe(45 * 60_000);
  });
});

describe('pickNextCard', () => {
  const HOUR = 60 * 60_000;

  it('honors sortOrder within Todo', () => {
    const cards = [
      card({ id: 'b', sortOrder: 20 }),
      card({ id: 'a', sortOrder: 10 }),
    ];
    expect(pickNextCard(cards, HOUR)!.id).toBe('a');
  });

  it('picks paused cards before todo cards', () => {
    const cards = [
      card({ id: 'todo-first', sortOrder: 0 }),
      card({ id: 'paused', state: 'paused', sortOrder: 99 }),
    ];
    expect(pickNextCard(cards, HOUR)!.id).toBe('paused');
  });

  it('picks rework after paused but before todo', () => {
    const cards = [
      card({ id: 'todo-first', sortOrder: 0 }),
      card({ id: 'rework', state: 'rework', sortOrder: 50 }),
      card({ id: 'paused', state: 'paused', sortOrder: 99 }),
    ];
    expect(pickNextCard(cards, HOUR)!.id).toBe('paused');
    expect(pickNextCard(cards.filter((c) => c.id !== 'paused'), HOUR)!.id).toBe('rework');
  });

  it('size-fit at the tail: skips a too-big card but picks a smaller one behind it', () => {
    const cards = [
      card({ id: 'big', sortOrder: 0, estimatedMinutes: 60 }),
      card({ id: 'small', sortOrder: 10, estimatedMinutes: 15 }),
    ];
    expect(pickNextCard(cards, 20 * 60_000)!.id).toBe('small');
    expect(pickNextCard(cards, 10 * 60_000)).toBeNull(); // nothing fits (floor is 5min... 15min > 10min)
  });

  it('never auto-picks amber/red or non-queued states', () => {
    const cards = [
      card({ id: 'amber', riskTier: 'amber' }),
      card({ id: 'red', riskTier: 'red' }),
      card({ id: 'done', state: 'done' }),
      card({ id: 'blocked', state: 'blocked' }),
      card({ id: 'refinement', state: 'refinement' }),
    ];
    expect(pickNextCard(cards, HOUR)).toBeNull();
  });

  it('skips cards whose prereqs are not done; deleted prereqs are ignored', () => {
    const cards = [
      card({ id: 'gated', sortOrder: 0, prereqIds: ['dep'] }),
      card({ id: 'dep', sortOrder: 10, state: 'refinement' }),
      card({ id: 'free', sortOrder: 20 }),
    ];
    expect(pickNextCard(cards, HOUR)!.id).toBe('free');

    // Prereq done → gated card is runnable again (and first by sortOrder).
    const done = cards.map((c) => (c.id === 'dep' ? { ...c, state: 'done' as const } : c));
    expect(pickNextCard(done, HOUR)!.id).toBe('gated');

    // Prereq referencing a deleted card doesn't block forever.
    const orphan = [card({ id: 'gated', prereqIds: ['gone'] })];
    expect(pickNextCard(orphan, HOUR)!.id).toBe('gated');
  });
});

describe('forecastNextWindow', () => {
  it('greedily fits cards into the upcoming window and totals cost', () => {
    // Mon noon; nights window is 23:00–07:00 = 8h → plenty of room.
    const now = local(2024, 0, 1, 12, 0);
    const cards = [
      card({ id: 'a', estimatedMinutes: 60, estimatedCostUsd: 2 }),
      card({ id: 'b', estimatedMinutes: 30, estimatedCostUsd: null }),
      card({ id: 'amber', riskTier: 'amber', estimatedCostUsd: 100 }),
    ];
    const f = forecastNextWindow(cards, [NIGHTS], now)!;
    expect(f.windowStartAt).toBe(local(2024, 0, 1, 23, 0));
    expect(f.cardCount).toBe(2);
    expect(f.totalCostUsd).toBe(2 + DEFAULT_CARD_COST_USD);
  });

  it('uses remaining time when already inside a window', () => {
    // Sat 23:00 inside the weekend slot: 59 minutes left → only the 30min card fits
    // after the 45min one is skipped... 45 fits too (45 <= 59) then 30 does not (14 left).
    const now = local(2024, 0, 6, 23, 0);
    const cards = [
      card({ id: 'a', sortOrder: 0, estimatedMinutes: 45 }),
      card({ id: 'b', sortOrder: 10, estimatedMinutes: 30 }),
    ];
    const f = forecastNextWindow(cards, [WEEKENDS], now)!;
    expect(f.windowStartAt).toBe(now);
    expect(f.cardCount).toBe(1);
  });

  it('returns null with no slots', () => {
    expect(forecastNextWindow([card({})], [], local(2024, 0, 1, 12, 0))).toBeNull();
  });

  it('counts a prereq-gated card once its prereq runs earlier in the same window', () => {
    const now = local(2024, 0, 1, 12, 0); // nights window = 8h, room for both
    const cards = [
      card({ id: 'dep', sortOrder: 0, estimatedMinutes: 30 }),
      card({ id: 'gated', sortOrder: 10, estimatedMinutes: 30, prereqIds: ['dep'] }),
    ];
    expect(forecastNextWindow(cards, [NIGHTS], now)!.cardCount).toBe(2);
  });
});

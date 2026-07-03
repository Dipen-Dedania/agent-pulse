// Pure window math for the Backlog Scheduler. No timers, no Electron, no I/O —
// every function takes an injected `now` (ms epoch) so the engine and the unit
// tests share identical logic. All wall-clock reasoning is in LOCAL time via
// the Date constructor's local-time fields (DST/rollover-safe), mirroring
// src/main/scheduler/timing.ts.
//
// A backlog slot is a RANGE (start–end, possibly wrapping past midnight),
// unlike the Cowork scheduler's fire instants.

import { parseHHmm } from '../scheduler/timing';
import { BacklogCard, BacklogSlot, countUnmetPrereqs } from '../../common/backlog-types';

// Per-card hard time budget (minutes) when the card has no estimate, and the
// clamp applied to user estimates so a typo can't produce a 10-hour run.
export const DEFAULT_CARD_MINUTES = 30;
export const CARD_MINUTES_MIN = 5;
export const CARD_MINUTES_MAX = 120;

// Flat per-card cost assumption for the forecast glance when the user hasn't
// set an estimate. Deliberately rough; actual attempt cost is recorded.
export const DEFAULT_CARD_COST_USD = 0.5;

export interface BacklogWindow {
  start: number; // ms epoch
  end: number;   // ms epoch, always > start
}

/** Hard time budget for a card, in ms. */
export function cardBudgetMs(card: Pick<BacklogCard, 'estimatedMinutes'>): number {
  const minutes = card.estimatedMinutes ?? DEFAULT_CARD_MINUTES;
  const clamped = Math.min(CARD_MINUTES_MAX, Math.max(CARD_MINUTES_MIN, minutes));
  return clamped * 60_000;
}

/** Local-time epoch ms for `daysAhead` from `now`, at hour:minute. */
function localTimeAt(now: number, daysAhead: number, h: number, m: number): number {
  const base = new Date(now);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + daysAhead, h, m, 0, 0).getTime();
}

/**
 * The occurrence of `slot` that STARTS on the local day `dayOffset` days from
 * `now`'s date. Returns null when the slot is malformed or that weekday isn't
 * enabled. An `end <= start` range wraps to the next day (23:00–07:00); the
 * degenerate `end === start` case is treated as a full 24h window.
 */
export function slotOccurrence(slot: BacklogSlot, dayOffset: number, now: number): BacklogWindow | null {
  const start = parseHHmm(slot.start);
  const end = parseHHmm(slot.end);
  if (!start || !end) return null;
  if (!Array.isArray(slot.days) || slot.days.length === 0) return null;

  const startMs = localTimeAt(now, dayOffset, start.h, start.m);
  if (!slot.days.includes(new Date(startMs).getDay())) return null;

  const sameDayEnd = localTimeAt(now, dayOffset, end.h, end.m);
  const endMs = sameDayEnd > startMs ? sameDayEnd : localTimeAt(now, dayOffset + 1, end.h, end.m);
  return { start: startMs, end: endMs };
}

/**
 * The window containing `now`, or null. Checks occurrences starting today AND
 * yesterday (a Fri 23:00–07:00 slot is still active Sat 03:00 — it belongs to
 * its start day). Overlapping slots merge implicitly by returning the
 * containing occurrence with the LATEST end.
 */
export function activeWindow(slots: BacklogSlot[], now: number): BacklogWindow | null {
  let best: BacklogWindow | null = null;
  for (const slot of slots) {
    if (!slot.enabled) continue;
    for (const dayOffset of [-1, 0]) {
      const occ = slotOccurrence(slot, dayOffset, now);
      if (!occ) continue;
      if (now >= occ.start && now < occ.end) {
        if (best === null || occ.end > best.end) best = occ;
      }
    }
  }
  return best;
}

/**
 * Start of the next window strictly after `now` (exclusive of any window
 * already containing `now`). Scans 8 local days like nextFixedFire so a slot
 * whose only day is today-already-passed resolves to next week. Returns null
 * when no enabled slot can ever open.
 */
export function nextWindowStart(slots: BacklogSlot[], now: number): number | null {
  let best: number | null = null;
  for (const slot of slots) {
    if (!slot.enabled) continue;
    for (let offset = 0; offset <= 7; offset++) {
      const occ = slotOccurrence(slot, offset, now);
      if (!occ) continue;
      if (occ.start <= now) continue;
      if (best === null || occ.start < best) best = occ.start;
      break; // earliest future occurrence for this slot found
    }
  }
  return best;
}

/**
 * The next card the executor should claim, honoring:
 *  1. paused cards first (they were interrupted mid-window, resume them),
 *  2. then Todo cards in user-set `sortOrder`,
 *  3. only green-tier cards autorun,
 *  4. prereqs: every prereq card must be Done (deleted prereqs are ignored),
 *  5. size-fit at the tail: skip a card whose hard budget exceeds the
 *     remaining window, but keep scanning — a smaller card behind it may fit.
 * Returns null when nothing runnable fits.
 */
export function pickNextCard(cards: BacklogCard[], remainingMs: number): BacklogCard | null {
  const candidates = cards
    .filter((c) =>
      (c.state === 'todo' || c.state === 'paused') &&
      c.riskTier === 'green' &&
      countUnmetPrereqs(c, cards) === 0)
    .sort((a, b) => {
      if (a.state !== b.state) return a.state === 'paused' ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
  for (const card of candidates) {
    if (cardBudgetMs(card) <= remainingMs) return card;
  }
  return null;
}

export interface BacklogForecast {
  windowStartAt: number;
  cardCount: number;
  totalCostUsd: number;
}

/**
 * Simulate the next window (the active one if inside it, else the upcoming
 * one) against the current queue: greedily fit cards in pick order and total
 * their estimated cost. Drives "queue will burn ~$X in the next window".
 */
export function forecastNextWindow(
  cards: BacklogCard[],
  slots: BacklogSlot[],
  now: number,
): BacklogForecast | null {
  const active = activeWindow(slots, now);
  const window: BacklogWindow | null = active
    ? { start: now, end: active.end }
    : (() => {
        const start = nextWindowStart(slots, now);
        if (start === null) return null;
        const next = activeWindow(slots, start);
        return next ?? null;
      })();
  if (!window) return null;

  let remainingMs = window.end - window.start;
  // Copies: the simulation marks picked cards Done (not removed) so a card
  // whose prereq runs earlier in the same window counts as runnable.
  const pool = cards.map((c) => ({ ...c }));
  let cardCount = 0;
  let totalCostUsd = 0;
  // Greedy sequential simulation: repeatedly pick what the engine would.
  for (;;) {
    const next = pickNextCard(pool, remainingMs);
    if (!next) break;
    remainingMs -= cardBudgetMs(next);
    cardCount += 1;
    totalCostUsd += next.estimatedCostUsd ?? DEFAULT_CARD_COST_USD;
    next.state = 'done';
  }
  return { windowStartAt: window.start, cardCount, totalCostUsd };
}

// Pure scheduling math for the Cowork Scheduler. No timers, no Electron, no
// I/O — every function takes an injected `now` (ms epoch) so the engine and
// the unit tests share identical logic. All wall-clock reasoning is in LOCAL
// time (the user schedules against their own day), via the Date constructor's
// local-time fields, which handles DST and month/year rollover correctly.

import { SchedulerConfig, SchedulerSlot } from '../user-config';
import { SchedulerEventKind } from '../../common/types';

/** Parse 'HH:mm' → {h, m}; returns null when malformed. */
export function parseHHmm(s: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { h, m };
}

/** Local-time epoch ms for `daysAhead` from `now`, at hour:minute. */
function localTimeAt(now: number, daysAhead: number, h: number, m: number): number {
  const base = new Date(now);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + daysAhead, h, m, 0, 0).getTime();
}

/** Minutes-since-local-midnight for an epoch ms. */
function minutesOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Next fire time across all enabled `fixed` slots on their enabled weekdays,
 * strictly after `now`. Scans the next 8 local days so a slot whose only
 * enabled day is today-already-passed still resolves to next week. Returns
 * null when no slot can ever fire (empty / all disabled / no days).
 */
export function nextFixedFire(slots: SchedulerSlot[], now: number): number | null {
  let best: number | null = null;
  for (const slot of slots) {
    if (!slot.enabled) continue;
    const hm = parseHHmm(slot.time);
    if (!hm) continue;
    if (!Array.isArray(slot.days) || slot.days.length === 0) continue;
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = localTimeAt(now, offset, hm.h, hm.m);
      if (candidate <= now) continue;
      const weekday = new Date(candidate).getDay(); // 0=Sun..6=Sat
      if (!slot.days.includes(weekday)) continue;
      if (best === null || candidate < best) best = candidate;
      break; // earliest valid occurrence for this slot found
    }
  }
  return best;
}

/**
 * Next adaptive opener: fire at the live window's `resetsAt` (or now, if the
 * window already expired / is unknown), clamped into the work-hours range. A
 * candidate before the day's start is pushed to start; after the day's end is
 * pushed to the next day's start. Returns null when the per-day window cap is
 * already reached.
 */
export function nextAdaptiveFire(
  resetsAt: number | null | undefined,
  workHours: { start: string; end: string },
  openersToday: number,
  maxWindowsPerDay: number,
  now: number,
): number | null {
  if (openersToday >= maxWindowsPerDay) return null;
  const start = parseHHmm(workHours.start);
  const end = parseHHmm(workHours.end);
  if (!start || !end) return null;
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;

  // Base candidate: ride to the current block's reset, but never the past.
  const candidate = Math.max(now, resetsAt ?? now);
  const candMin = minutesOfDay(candidate);

  if (candMin < startMin) {
    // Before work hours today → fire at today's start.
    return localTimeAt(candidate, 0, start.h, start.m);
  }
  if (candMin > endMin) {
    // After work hours → fire at tomorrow's start.
    return localTimeAt(candidate, 1, start.h, start.m);
  }
  return candidate;
}

/**
 * Token-refresh nudge time: `expiresAt - leadMs`, clamped to ≥ now. Returns
 * null when expiry is unknown, the nudge is disabled, or an opener is already
 * coming at-or-before the nudge time (openers refresh the token themselves,
 * so they subsume the nudge in fixed/adaptive mode).
 */
export function nextNudgeFire(
  expiresAt: number | null | undefined,
  leadMs: number,
  nextOpenerAt: number | null,
  now: number,
): number | null {
  if (typeof expiresAt !== 'number') return null;
  const fireAt = Math.max(now, expiresAt - leadMs);
  if (nextOpenerAt !== null && nextOpenerAt <= fireAt) return null;
  return fireAt;
}

export interface SchedulerTimingState {
  resetsAt?: number | null;   // live 5-hour window reset (from UsagePoller)
  expiresAt?: number | null;  // OAuth token expiry (from credentials)
  openersToday: number;       // openers fired since local midnight
}

export interface NextEvent {
  at: number;
  kind: SchedulerEventKind;
}

/**
 * The single next thing the scheduler should do: the earliest of the mode's
 * opener candidate and (if enabled) the token nudge. Returns null when nothing
 * is scheduled. The global `maxOpenersPerDay` cap suppresses openers in every
 * mode; adaptive additionally honors its own `maxWindowsPerDay`.
 */
export function nextEvent(
  config: SchedulerConfig,
  state: SchedulerTimingState,
  now: number,
): NextEvent | null {
  let openerAt: number | null = null;
  if (state.openersToday < config.maxOpenersPerDay) {
    if (config.mode === 'fixed') {
      openerAt = nextFixedFire(config.fixed, now);
    } else if (config.mode === 'adaptive') {
      openerAt = nextAdaptiveFire(
        state.resetsAt,
        config.adaptive.workHours,
        state.openersToday,
        config.adaptive.maxWindowsPerDay,
        now,
      );
    }
  }

  const nudgeAt = config.tokenNudge.enabled
    ? nextNudgeFire(state.expiresAt, config.tokenNudge.leadMs, openerAt, now)
    : null;

  if (openerAt === null && nudgeAt === null) return null;
  if (openerAt === null) return { at: nudgeAt!, kind: 'nudge' };
  if (nudgeAt === null) return { at: openerAt, kind: 'opener' };
  return openerAt <= nudgeAt ? { at: openerAt, kind: 'opener' } : { at: nudgeAt, kind: 'nudge' };
}

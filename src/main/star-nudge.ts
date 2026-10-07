// GitHub star nudge — pure helpers over UserConfig.starNudge. Main owns the
// side effects (save, broadcast, openExternal); everything here is testable
// without Electron. See star-nudge-plan.md.
import type { StarMilestoneKind, StarNudgeState, StarVoice } from '../common/star-types';
import type { StarNudgeConfig, TourConfig } from './user-config';

// The "week" milestone: 7 days after the install's first hook event.
export const STAR_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// How often main re-evaluates the week trigger while running. The toast is
// not time-critical; an hour keeps the timer cheap and the test surface small.
export const STAR_POLL_MS = 60 * 60 * 1000;

/** Coin-flip voice assignment, injectable for tests. */
export function pickStarVoice(random: () => number = Math.random): StarVoice {
  return random() < 0.5 ? 'earnest' : 'playful';
}

/**
 * Decide whether a milestone toast is due. Returns null once the user has
 * starred, once a toast is already pending, or once a toast was answered —
 * the toast is strictly one-shot. Otherwise the first backlog completion wins
 * over the week trigger because it is the more specific moment.
 */
export function evaluateStarMilestone(
  star: StarNudgeConfig,
  tour: Pick<TourConfig, 'firstEventAt'>,
  now: number,
  backlogDone: boolean,
): StarMilestoneKind | null {
  if (star.starredAt || star.milestoneDueAt || star.milestoneShownAt) return null;
  if (backlogDone) return 'backlog';
  if (tour.firstEventAt && now - tour.firstEventAt >= STAR_WEEK_MS) return 'week';
  return null;
}

/** Renderer-facing slice. `voice` must already be assigned (ensureStarVoice). */
export function projectStarState(star: StarNudgeConfig): StarNudgeState {
  return {
    voice: star.voice ?? 'earnest',
    starred: star.starredAt !== null,
    toastPending: star.milestoneDueAt !== null && star.milestoneShownAt === null && star.starredAt === null,
    milestoneKind: star.milestoneKind,
  };
}

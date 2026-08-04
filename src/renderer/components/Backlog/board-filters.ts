// Board view filters: the global history window and the Done column's category
// chips. View-only — none of this reaches the engine, and none of it may change
// what the autorun queue executes (see the Todo note below).
//
// The window deliberately reuses TimelineRange's literals so the board and the
// Analytics tab speak the same vocabulary ('7d', '30d', …), but the two keep
// SEPARATE state: changing what the board shows must never silently rewrite the
// numbers the Analytics tab reports. 7d is the floor — a shorter "today" window
// isn't in the shared union and isn't worth forking it for.

import { BacklogCard, BacklogCardState, isAwaitingReview } from '../../../common/backlog-types';
import type { TimelineRange } from '../../../common/timeline-types';

// 'all' is board-only: Analytics always wants a bounded window, but the board
// needs an escape hatch or old shipped cards become unreachable.
export type BoardRange = TimelineRange | 'all';

export const BOARD_RANGE_OPTIONS: { value: BoardRange; label: string }[] = [
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: '1y', label: '1y' },
  { value: 'all', label: 'All' },
];

export const BOARD_RANGE_LABEL: Record<BoardRange, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '1y': 'last year',
  all: 'all time',
};

const RANGE_DAYS: Record<Exclude<BoardRange, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

/** Oldest `updatedAt` the window admits; 0 for 'all' (admits everything). */
export function boardRangeCutoff(range: BoardRange, nowMs: number): number {
  if (range === 'all') return 0;
  return nowMs - RANGE_DAYS[range] * 86_400_000;
}

// Which columns the history window applies to. Only Done: every other column
// holds live work, not history.
//   • Todo is the autorun queue — the engine picks from the full set and
//     reordering already runs against the full list (see fullTodoOrder), so
//     hiding queue members by age would make the visible order lie.
//   • Blocked / Rework / Paused are by definition awaiting action; age is not a
//     reason to hide them.
//   • Refinement holds ideas, not history — a two-month-old idea is still live.
export const RANGE_FILTERED_STATES: BacklogCard['state'][] = ['done'];

// ─── Done column categories ──────────────────────────────────────────────────

export type DoneFilter = 'all' | 'needs-review' | 'shipped' | 'reports';

// Not a partition — 'all' is the escape hatch that guarantees every Done card
// stays reachable (e.g. an execution card whose worktree was cleaned up falls
// into none of the three narrow buckets).
export const DONE_FILTER_PREDICATES: Record<DoneFilter, (card: BacklogCard) => boolean> = {
  all: () => true,
  'needs-review': (card) => isAwaitingReview(card),
  shipped: (card) => card.appliedAt != null,
  reports: (card) => card.taskType !== 'execution',
};

export const DONE_FILTER_META: Record<DoneFilter, { label: string; hint: string }> = {
  all: { label: 'All', hint: 'every Done card in the window' },
  'needs-review': {
    label: 'Needs review',
    hint: 'execution cards with a diff you haven’t landed yet — never hidden by the history window',
  },
  shipped: { label: 'Shipped', hint: 'diffs already applied to the project' },
  reports: { label: 'Reports', hint: 'research and QA cards — no diff to land' },
};

export const DONE_FILTER_ORDER: DoneFilter[] = ['all', 'needs-review', 'shipped', 'reports'];

// ─── The combined rule ───────────────────────────────────────────────────────

export interface BoardViewFilters {
  doneFilter: DoneFilter;
  rangeCutoff: number; // from boardRangeCutoff()
}

/**
 * Whether a card survives the view filters for the column it's in. Two scoped
 * rules:
 *  • the Done chips apply to Done only;
 *  • the history window applies to RANGE_FILTERED_STATES only, and never hides
 *    a card that still needs a human — an unreviewed diff must not age out of
 *    sight just because it's old. That exemption is the safety property that
 *    makes a defaulted-on window safe.
 *
 * The chip is a deliberate choice, so it still wins: picking "Shipped" hides
 * unreviewed cards. The exemption guards the window, not the chip.
 */
export function passesViewFilters(
  card: BacklogCard,
  state: BacklogCardState,
  { doneFilter, rangeCutoff }: BoardViewFilters,
): boolean {
  if (state === 'done' && !DONE_FILTER_PREDICATES[doneFilter](card)) return false;
  if (RANGE_FILTERED_STATES.includes(state) && card.updatedAt < rangeCutoff && !isAwaitingReview(card)) return false;
  return true;
}

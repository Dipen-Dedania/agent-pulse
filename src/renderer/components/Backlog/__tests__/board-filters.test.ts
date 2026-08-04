import { describe, it, expect } from 'vitest';
import { BacklogCard, isAwaitingReview } from '../../../../common/backlog-types';
import {
  BOARD_RANGE_LABEL, BOARD_RANGE_OPTIONS, boardRangeCutoff,
  DONE_FILTER_ORDER, DONE_FILTER_PREDICATES, passesViewFilters,
} from '../board-filters';

// isAwaitingReview lives in common/ but its only consumer is these filters, and
// it's the predicate the window exemption keys on — so it's covered here, as one
// behavioural unit with the rules that use it.

const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);
const DAY = 86_400_000;

function card(over: Partial<BacklogCard> = {}): BacklogCard {
  return {
    id: 'c1', title: 't', description: '', projectId: 'p1',
    state: 'done', taskType: 'execution', riskTier: 'green',
    model: null, estimatedMinutes: null, estimatedCostUsd: null,
    prereqIds: [], qaProvider: 'none', qaCommand: null, qaUrl: null,
    acceptanceCriteria: [], worktreePath: 'E:/wt/c1', baseSha: 'sha',
    refinementSessionId: null, refinementStartedAt: null,
    appliedAt: null, applyMethod: null, appliedAutorun: false,
    appliedAdditions: null, appliedDeletions: null, appliedFiles: null,
    sortOrder: 0, blockedReason: null, sourceUrl: null, sourceFingerprint: null,
    createdAt: NOW, updatedAt: NOW,
    ...over,
  };
}

describe('isAwaitingReview', () => {
  it('is a done execution card with a worktree and no apply', () => {
    expect(isAwaitingReview(card())).toBe(true);
  });

  it('excludes applied, non-done, non-execution, and worktree-less cards', () => {
    expect(isAwaitingReview(card({ appliedAt: NOW }))).toBe(false);
    expect(isAwaitingReview(card({ state: 'todo' }))).toBe(false);
    expect(isAwaitingReview(card({ taskType: 'research' }))).toBe(false);
    expect(isAwaitingReview(card({ taskType: 'qa' }))).toBe(false);
    expect(isAwaitingReview(card({ worktreePath: null }))).toBe(false);
  });
});

describe('boardRangeCutoff', () => {
  it('admits everything for "all"', () => {
    expect(boardRangeCutoff('all', NOW)).toBe(0);
  });

  it('walks back the right number of days', () => {
    expect(boardRangeCutoff('7d', NOW)).toBe(NOW - 7 * DAY);
    expect(boardRangeCutoff('30d', NOW)).toBe(NOW - 30 * DAY);
    expect(boardRangeCutoff('1y', NOW)).toBe(NOW - 365 * DAY);
  });

  it('labels every option it offers', () => {
    for (const opt of BOARD_RANGE_OPTIONS) {
      expect(BOARD_RANGE_LABEL[opt.value]).toBeTruthy();
    }
  });
});

describe('DONE_FILTER_PREDICATES', () => {
  it('needs-review picks out unlanded diffs only', () => {
    const p = DONE_FILTER_PREDICATES['needs-review'];
    expect(p(card())).toBe(true);
    expect(p(card({ appliedAt: NOW, applyMethod: 'clean' }))).toBe(false);
    expect(p(card({ taskType: 'research', worktreePath: null }))).toBe(false);
  });

  it('shipped counts any apply, including a hand-mark and an already-present no-op', () => {
    const p = DONE_FILTER_PREDICATES.shipped;
    expect(p(card({ appliedAt: NOW, applyMethod: 'clean' }))).toBe(true);
    expect(p(card({ appliedAt: NOW, applyMethod: 'manual' }))).toBe(true);
    expect(p(card({ appliedAt: NOW, applyMethod: 'already-present' }))).toBe(true);
    expect(p(card())).toBe(false);
  });

  it('reports covers research and qa, never execution', () => {
    const p = DONE_FILTER_PREDICATES.reports;
    expect(p(card({ taskType: 'research', worktreePath: null }))).toBe(true);
    expect(p(card({ taskType: 'qa', worktreePath: null }))).toBe(true);
    expect(p(card())).toBe(false);
  });

  it('"all" is the escape hatch: it reaches a card no narrow bucket claims', () => {
    // Execution, done, worktree cleaned up, never applied — in none of the three
    // narrow buckets. It must still be reachable, or it's lost from the board.
    const orphan = card({ worktreePath: null });
    const narrow = DONE_FILTER_ORDER.filter((f) => f !== 'all');
    expect(narrow.some((f) => DONE_FILTER_PREDICATES[f](orphan))).toBe(false);
    expect(DONE_FILTER_PREDICATES.all(orphan)).toBe(true);
  });
});

describe('passesViewFilters', () => {
  const cutoff = boardRangeCutoff('7d', NOW);
  const old = NOW - 30 * DAY;

  it('hides stale shipped cards from Done but keeps recent ones', () => {
    const recent = card({ updatedAt: NOW - DAY, appliedAt: NOW - DAY, applyMethod: 'clean' });
    const stale = card({ updatedAt: old, appliedAt: old, applyMethod: 'clean' });
    expect(passesViewFilters(recent, 'done', { doneFilter: 'all', rangeCutoff: cutoff })).toBe(true);
    expect(passesViewFilters(stale, 'done', { doneFilter: 'all', rangeCutoff: cutoff })).toBe(false);
  });

  it('never ages out an unreviewed diff, however old', () => {
    const stale = card({ updatedAt: NOW - 400 * DAY });
    expect(isAwaitingReview(stale)).toBe(true);
    expect(passesViewFilters(stale, 'done', { doneFilter: 'all', rangeCutoff: cutoff })).toBe(true);
  });

  it('leaves work queues and the attention rail untouched by the window', () => {
    for (const state of ['refinement', 'todo', 'in-progress', 'blocked', 'rework', 'paused'] as const) {
      const stale = card({ state, updatedAt: old, worktreePath: null });
      expect(passesViewFilters(stale, state, { doneFilter: 'shipped', rangeCutoff: cutoff })).toBe(true);
    }
  });

  it('lets an explicit chip choice hide unreviewed cards — the exemption guards the window, not the chip', () => {
    const unreviewed = card({ updatedAt: NOW });
    expect(passesViewFilters(unreviewed, 'done', { doneFilter: 'shipped', rangeCutoff: cutoff })).toBe(false);
    expect(passesViewFilters(unreviewed, 'done', { doneFilter: 'needs-review', rangeCutoff: cutoff })).toBe(true);
  });

  it('applies both rules together: chip match still has to clear the window', () => {
    const staleShipped = card({ updatedAt: old, appliedAt: old, applyMethod: 'clean' });
    expect(DONE_FILTER_PREDICATES.shipped(staleShipped)).toBe(true);
    expect(passesViewFilters(staleShipped, 'done', { doneFilter: 'shipped', rangeCutoff: cutoff })).toBe(false);
    // 'all' range admits it again.
    expect(passesViewFilters(staleShipped, 'done', {
      doneFilter: 'shipped', rangeCutoff: boardRangeCutoff('all', NOW),
    })).toBe(true);
  });
});

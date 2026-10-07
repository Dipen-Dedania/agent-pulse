import { describe, it, expect } from 'vitest';
import { evaluateStarMilestone, pickStarVoice, projectStarState, STAR_WEEK_MS } from '../star-nudge';
import { migrateStarNudge, StarNudgeConfig } from '../user-config';

const NOW = 1_800_000_000_000;

function star(over: Partial<StarNudgeConfig> = {}): StarNudgeConfig {
  return { voice: 'earnest', starredAt: null, milestoneDueAt: null, milestoneShownAt: null, milestoneKind: null, ...over };
}

describe('pickStarVoice', () => {
  it('maps the lower half of the unit interval to earnest and the upper to playful', () => {
    expect(pickStarVoice(() => 0)).toBe('earnest');
    expect(pickStarVoice(() => 0.49)).toBe('earnest');
    expect(pickStarVoice(() => 0.5)).toBe('playful');
    expect(pickStarVoice(() => 0.99)).toBe('playful');
  });
});

describe('evaluateStarMilestone', () => {
  const weekAgo = { firstEventAt: NOW - STAR_WEEK_MS };

  it('returns null before the first hook event and under a week after it', () => {
    expect(evaluateStarMilestone(star(), { firstEventAt: null }, NOW, false)).toBeNull();
    expect(evaluateStarMilestone(star(), { firstEventAt: NOW - STAR_WEEK_MS + 1 }, NOW, false)).toBeNull();
  });

  it('fires "week" exactly at seven days since the first event', () => {
    expect(evaluateStarMilestone(star(), weekAgo, NOW, false)).toBe('week');
  });

  it('fires "backlog" on a completed card even before the week is up', () => {
    expect(evaluateStarMilestone(star(), { firstEventAt: NOW - 1000 }, NOW, true)).toBe('backlog');
    expect(evaluateStarMilestone(star(), { firstEventAt: null }, NOW, true)).toBe('backlog');
  });

  it('prefers "backlog" over "week" when both are true at once', () => {
    expect(evaluateStarMilestone(star(), weekAgo, NOW, true)).toBe('backlog');
  });

  it('is one-shot: starred, already due, or already answered all return null', () => {
    expect(evaluateStarMilestone(star({ starredAt: NOW - 1 }), weekAgo, NOW, true)).toBeNull();
    expect(evaluateStarMilestone(star({ milestoneDueAt: NOW - 1 }), weekAgo, NOW, true)).toBeNull();
    expect(evaluateStarMilestone(star({ milestoneShownAt: NOW - 1 }), weekAgo, NOW, true)).toBeNull();
  });
});

describe('projectStarState', () => {
  it('reports a pending toast only while due and unanswered and not starred', () => {
    expect(projectStarState(star()).toastPending).toBe(false);
    expect(projectStarState(star({ milestoneDueAt: NOW, milestoneKind: 'week' })).toastPending).toBe(true);
    expect(projectStarState(star({ milestoneDueAt: NOW, milestoneShownAt: NOW })).toastPending).toBe(false);
    expect(projectStarState(star({ milestoneDueAt: NOW, starredAt: NOW })).toastPending).toBe(false);
  });

  it('exposes starred, the voice and the milestone kind', () => {
    const s = projectStarState(star({ voice: 'playful', starredAt: NOW, milestoneKind: 'backlog' }));
    expect(s).toEqual({ voice: 'playful', starred: true, toastPending: false, milestoneKind: 'backlog' });
  });

  it('falls back to earnest when no voice has been assigned yet', () => {
    expect(projectStarState(star({ voice: null })).voice).toBe('earnest');
  });
});

describe('migrateStarNudge', () => {
  it('returns all-null defaults for missing / non-object input', () => {
    const d = { voice: null, starredAt: null, milestoneDueAt: null, milestoneShownAt: null, milestoneKind: null };
    expect(migrateStarNudge(undefined)).toEqual(d);
    expect(migrateStarNudge('nope')).toEqual(d);
  });

  it('keeps valid values and floors timestamps', () => {
    expect(migrateStarNudge({ voice: 'playful', starredAt: 12.7, milestoneKind: 'backlog' })).toEqual({
      voice: 'playful', starredAt: 12, milestoneDueAt: null, milestoneShownAt: null, milestoneKind: 'backlog',
    });
  });

  it('nulls bad timestamps, unknown voices and unknown kinds', () => {
    expect(migrateStarNudge({
      voice: 'shouty', starredAt: -5, milestoneDueAt: 'soon', milestoneShownAt: Infinity, milestoneKind: 'birthday',
    })).toEqual({ voice: null, starredAt: null, milestoneDueAt: null, milestoneShownAt: null, milestoneKind: null });
  });
});

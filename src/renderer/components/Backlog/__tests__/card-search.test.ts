import { describe, it, expect } from 'vitest';
import { BacklogCard, BacklogProject } from '../../../../common/backlog-types';
import { searchCards, MAX_SEARCH_RESULTS } from '../card-search';

const NOW = Date.UTC(2026, 7, 3, 12, 0, 0);

function card(over: Partial<BacklogCard> = {}): BacklogCard {
  return {
    id: 'c1', title: 't', description: '', projectId: 'p1',
    state: 'todo', taskType: 'research', riskTier: 'green',
    model: null, estimatedMinutes: null, estimatedCostUsd: null,
    prereqIds: [], qaProvider: 'none', qaCommand: null, qaUrl: null,
    acceptanceCriteria: [], worktreePath: null, baseSha: null,
    refinementSessionId: null, refinementStartedAt: null,
    appliedAt: null, applyMethod: null, appliedAutorun: false,
    appliedAdditions: null, appliedDeletions: null, appliedFiles: null,
    sortOrder: 0, blockedReason: null, sourceUrl: null, sourceFingerprint: null,
    createdAt: NOW, updatedAt: NOW,
    ...over,
  };
}

function projects(...names: [string, string][]): Map<string, BacklogProject> {
  return new Map(names.map(([id, name]) => [id, { id, name } as BacklogProject]));
}

describe('searchCards', () => {
  it('returns every card, most-recently-updated first, for a blank query', () => {
    const a = card({ id: 'a', title: 'alpha', updatedAt: NOW });
    const b = card({ id: 'b', title: 'beta', updatedAt: NOW + 1000 });
    const hits = searchCards([a, b], projects(['p1', 'Web']), '   ');
    expect(hits.map((h) => h.card.id)).toEqual(['b', 'a']);
  });

  it('ranks a title prefix above a description-only mention', () => {
    const prefix = card({ id: 'pre', title: 'login redirect fix' });
    const inDesc = card({ id: 'desc', title: 'unrelated', description: 'touches the login flow' });
    const hits = searchCards([inDesc, prefix], projects(['p1', 'Web']), 'login');
    expect(hits[0].card.id).toBe('pre');
    expect(hits.map((h) => h.card.id)).toContain('desc');
  });

  it('matches on project name', () => {
    const c = card({ id: 'c', title: 'nothing relevant', projectId: 'p2' });
    const hits = searchCards([c], projects(['p2', 'Payments']), 'paym');
    expect(hits.map((h) => h.card.id)).toEqual(['c']);
  });

  it('matches a fuzzy title subsequence', () => {
    const c = card({ id: 'c', title: 'fix login' });
    const hits = searchCards([c], projects(['p1', 'Web']), 'flgn');
    expect(hits.map((h) => h.card.id)).toEqual(['c']);
  });

  it('drops non-matching cards', () => {
    const c = card({ id: 'c', title: 'alpha', description: 'beta', projectId: 'p1' });
    const hits = searchCards([c], projects(['p1', 'Web']), 'zzzzz');
    expect(hits).toHaveLength(0);
  });

  it('caps results at MAX_SEARCH_RESULTS', () => {
    const many = Array.from({ length: MAX_SEARCH_RESULTS + 10 }, (_, i) =>
      card({ id: `c${i}`, title: `login task ${i}` }));
    const hits = searchCards(many, projects(['p1', 'Web']), 'login');
    expect(hits).toHaveLength(MAX_SEARCH_RESULTS);
  });
});

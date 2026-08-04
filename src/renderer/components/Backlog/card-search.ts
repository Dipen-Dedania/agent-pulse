import { BacklogCard, BacklogProject } from '../../../common/backlog-types';

// Pure ranking for the backlog find-cards palette, kept out of the component so
// the scoring is unit-tested (mirrors board-filters.ts). Matches a query against
// a card's title, project name, and description, best matches first.

export interface CardHit {
  card: BacklogCard;
  score: number;
}

// Match tiers, higher = more relevant. A title prefix beats a title substring
// beats a project-name hit beats a fuzzy title subsequence beats a description
// hit — so typing a card's first word surfaces it above a chance body mention.
const TITLE_PREFIX = 500;
const TITLE_SUBSTR = 400;
const PROJECT_SUBSTR = 300;
const TITLE_SUBSEQ = 200;
const DESC_SUBSTR = 100;

// Bounds the rendered list (and the DOM) on a large board.
export const MAX_SEARCH_RESULTS = 50;

// True when every char of `q` appears in order within `s` (fuzzy subsequence),
// so "flgn" still finds "fix login". `q` and `s` must already be lower-cased.
function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) i++;
  }
  return i === q.length;
}

/**
 * Rank cards against a search query. An empty/blank query returns every card,
 * most-recently-updated first, so the palette opens as a browsable list rather
 * than blank. Non-matching cards are dropped.
 */
export function searchCards(
  cards: BacklogCard[],
  projectsById: Map<string, BacklogProject>,
  query: string,
): CardHit[] {
  const q = query.trim().toLowerCase();

  if (q === '') {
    return [...cards]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SEARCH_RESULTS)
      .map((card) => ({ card, score: 0 }));
  }

  const hits: CardHit[] = [];
  for (const card of cards) {
    const title = card.title.toLowerCase();
    const project = (projectsById.get(card.projectId)?.name ?? '').toLowerCase();
    const desc = card.description.toLowerCase();

    let score: number;
    if (title.startsWith(q)) score = TITLE_PREFIX;
    else if (title.includes(q)) score = TITLE_SUBSTR;
    else if (project.includes(q)) score = PROJECT_SUBSTR;
    else if (isSubsequence(q, title)) score = TITLE_SUBSEQ;
    else if (desc.includes(q)) score = DESC_SUBSTR;
    else continue;

    hits.push({ card, score });
  }

  return hits
    .sort((a, b) => b.score - a.score || b.card.updatedAt - a.card.updatedAt)
    .slice(0, MAX_SEARCH_RESULTS);
}

/**
 * Lightweight registry of the standalone SEO pages (slug + label only).
 *
 * The home page's NavBar/Footer import this to link the pages, so it must stay
 * free of page content — the full copy lives in ./content and only ships in
 * the pages bundle. Add an entry here AND a content file when adding a page;
 * scripts/prerender.mjs fails the build if the two disagree.
 */

export type PageGroup = 'use-case' | 'compare' | 'guide';

export interface PageLink {
  slug: string;
  /** Short label for footer / related-page links */
  label: string;
  group: PageGroup;
}

export const HOME_URL = import.meta.env.BASE_URL;

/** Absolute (base-prefixed) URL of a standalone page, with trailing slash. */
export const pageUrl = (slug: string) => `${HOME_URL}${slug}/`;

/** Link back to a home-page section, e.g. homeAnchor('download'). */
export const homeAnchor = (id: string) => `${HOME_URL}#${id}`;

export const pageLinks: PageLink[] = [
  {
    slug: 'claude-code-usage-tracker-windows',
    label: 'Claude Code usage tracker for Windows',
    group: 'use-case',
  },
  {
    slug: 'claude-code-notification-when-done',
    label: 'Get notified when Claude Code needs you',
    group: 'use-case',
  },
  {
    slug: 'tokens-4-breakfast-alternative',
    label: 'Tokens 4 Breakfast alternative',
    group: 'compare',
  },
  {
    slug: 'claude-code-5-hour-limit-reset',
    label: 'When does the Claude Code limit reset?',
    group: 'guide',
  },
];

export const GROUP_LABELS: Record<PageGroup, string> = {
  'use-case': 'Use cases',
  compare: 'Compare',
  guide: 'Guides',
};

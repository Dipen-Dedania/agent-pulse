import type { SeoPage } from './types';
import usageTrackerWindows from './content/claude-code-usage-tracker-windows';
import notificationWhenDone from './content/claude-code-notification-when-done';
import tokens4BreakfastAlternative from './content/tokens-4-breakfast-alternative';
import limitReset from './content/claude-code-5-hour-limit-reset';

/** Every standalone page, in the same order as pageLinks in ./links. */
export const seoPages: SeoPage[] = [
  usageTrackerWindows,
  notificationWhenDone,
  tokens4BreakfastAlternative,
  limitReset,
];

export function findPage(slug: string): SeoPage | undefined {
  return seoPages.find((p) => p.slug === slug);
}

import type { StarMilestoneKind, StarVoice } from './star-types';

// All user-facing copy for the GitHub star nudge, keyed by voice then
// placement, so each surface reads one row and tests can assert both voices.
// "Him" is the bubble mascot — the first-run tour already calls him that.
export interface StarCopy {
  /** Tooltip on the title-bar star icon. */
  titleBar: string;
  /** Sentence under the Updates tab's "Up to date" status. */
  upToDate: string;
  /** One-time milestone toast body, per trigger. */
  toast: Record<StarMilestoneKind, string>;
  /** Primary button label (every placement). */
  star: string;
  /** Secondary toast button. */
  later: string;
}

export const STAR_COPY: Record<StarVoice, StarCopy> = {
  earnest: {
    titleBar: 'Star Agent Pulse on GitHub',
    upToDate:
      'Nothing to install. Agent Pulse is free and open source, and a star is the cheapest way to say thanks.',
    toast: {
      week:
        "You've run with Agent Pulse for a week. If it has earned its spot on your desktop, a star tells other devs it's worth a look.",
      backlog:
        'Your first backlog card shipped while you were away. A star helps the next developer find this.',
    },
    star: 'Star on GitHub',
    later: 'Not now',
  },
  playful: {
    titleBar: 'Give the bubble a star',
    upToDate:
      'All caught up. The bubble has been working all night. A star on GitHub is how you tip him.',
    toast: {
      week: 'One week of bubbles. He works all night and asks for nothing. Except maybe a star.',
      backlog:
        'Your first backlog card is done and nobody was watching. A star keeps the night shift going.',
    },
    star: 'Star on GitHub ★',
    later: 'Maybe later',
  },
};

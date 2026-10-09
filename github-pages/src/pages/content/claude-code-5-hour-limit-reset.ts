import type { SeoPage } from '../types';
import { homeAnchor, pageUrl } from '../links';

// General limit mechanics as publicly described by Anthropic, October 2026.
// The Agent Pulse specifics (scheduler, nudge, gate) are checked against
// src/main/scheduler and the DEFAULTS in src/main/user-config.ts.
const page: SeoPage = {
  slug: 'claude-code-5-hour-limit-reset',
  group: 'guide',
  title: 'When Does the Claude Code 5-Hour Limit Reset? | Agent Pulse',
  description:
    'How Claude Code’s 5-hour window and weekly limit work, when each resets, how to check where you stand, and how to make a fresh window line up with your day.',
  eyebrow: 'GUIDE',
  h1: 'When does the Claude Code 5-hour limit reset?',
  lede:
    'Short answer: five hours after the first message of the window, not at a fixed time of day. A separate weekly limit sits on top of it. Here’s how both work, and how to plan around them.',
  updated: '2026-10-09',
  sections: [
    {
      heading: 'The 5-hour window starts with your first message',
      paragraphs: [
        'On a Claude subscription (Pro, Max, Team and similar), usage is counted in windows. A window opens when you send your first message after the last one ended. It lasts five hours, and when it ends your usage resets to zero.',
        'So if you start at 9:10, that window resets at 14:10. If you don’t send anything until 16:00, the next window runs from 16:00 to 21:00. The clock only starts once you use Claude.',
        'Claude Code, the claude.ai website and the desktop apps all draw from the same limit. A long chat in the browser uses up the same window as your coding session.',
      ],
    },
    {
      heading: 'The weekly limit is separate',
      paragraphs: [
        'On top of the 5-hour windows there is a 7-day limit, and some plans have extra weekly caps for specific models. You can still have room in your 5-hour window and be stopped by the weekly limit, or the other way round. The weekly limit resets on its own 7-day cycle, not at the end of a 5-hour window.',
        'If your plan has **extra usage** turned on, you can keep working after a limit at pay-as-you-go rates instead of waiting for the reset.',
      ],
    },
    {
      heading: 'How to check where you stand',
      bullets: [
        'In Claude Code, run `/usage`. It shows how much of the current window and the week you’ve used, and when each resets.',
        'On claude.ai, open your settings and look at the usage page.',
        `Or keep it on screen: [Agent Pulse](${homeAnchor('usage-meters')}) shows both windows and their reset times on a floating bubble, and warns you when you drop to 20% remaining.`,
      ],
    },
    {
      heading: 'Make the reset land when you need it',
      paragraphs: [
        'Because a window starts with your first message, you can choose when it starts. Say you begin work at 9:00 and usually run out by noon. If a window had opened at 7:00, it would reset at 12:00, right when you need a fresh one.',
        'The Agent Pulse **scheduler** does this for you. It sends a tiny message to Claude at the times you choose (or picks the times for you), so a window is already running before you sit down and resets partway through your day. The message is so small it uses almost none of the window.',
      ],
    },
    {
      heading: 'Don’t waste a window',
      paragraphs: [
        'Anything left in a window when it resets is gone. Agent Pulse can remind you 30 minutes before a reset if you still have a lot left. If you keep a [backlog](' +
          homeAnchor('backlog') +
          ') of tasks for agents to run on their own, they can use that spare capacity. They stop picking up new tasks once the window is 95% used, so you’re not left without room.',
      ],
    },
  ],
  faq: [
    {
      question: 'Does the 5-hour limit reset at midnight?',
      answer:
        'No. It resets five hours after the window started, and the window starts with your first message. There is no fixed daily reset time.',
    },
    {
      question: 'Do claude.ai chats count against my Claude Code limit?',
      answer:
        'Yes. On a subscription, claude.ai, the desktop apps and Claude Code share the same limits.',
    },
    {
      question: 'I have room in my 5-hour window but I’m still blocked. Why?',
      answer:
        'You’ve probably hit the weekly limit or a model-specific weekly cap. `/usage` in Claude Code shows which one.',
    },
    {
      question: 'Does any of this apply if I use an API key?',
      answer:
        'No. With an API key you pay per token, and API rate limits work differently. The 5-hour window only applies to subscription plans.',
    },
    {
      question: 'Is there a tracker for Windows?',
      answer: `Yes. Agent Pulse runs on Windows, macOS and Linux. See [Claude Code usage tracker for Windows](${pageUrl('claude-code-usage-tracker-windows')}).`,
    },
  ],
};

export default page;

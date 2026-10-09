import type { SeoPage } from '../types';
import { pageUrl } from '../links';

// Facts below are checked against src/main/bridge/server.ts (event → state
// mapping), src/main/attention/engine.ts, the attention DEFAULTS in
// src/main/user-config.ts and the waiting chime in Bubble.tsx.
const page: SeoPage = {
  slug: 'claude-code-notification-when-done',
  group: 'use-case',
  title: 'Get Notified When Claude Code Needs You | Agent Pulse',
  description:
    'Stop checking the terminal. Agent Pulse shows when Claude Code finishes or waits for permission, with a sound, a screen-edge glow, OS and Slack alerts.',
  eyebrow: 'NEVER MISS A PROMPT',
  h1: 'Know the moment Claude Code needs you',
  lede:
    'You start a long task and switch to email. A minute later Claude stops to ask for permission, and it waits there for twenty minutes until you look back. Agent Pulse makes that wait impossible to miss.',
  updated: '2026-10-09',
  screenshot: { file: 'bubbles.png', alt: 'Agent Pulse status bubbles showing working, waiting and idle agents' },
  sections: [
    {
      heading: 'What you see',
      bullets: [
        '**Claude asks for permission or a question**: the bubble turns blue with a badge, a short sound plays, and a thin blue glow lights the edge of every screen until you answer.',
        '**Claude finishes its turn**: the bubble switches from green (working) to amber, meaning it’s ready for your next prompt.',
        '**Still waiting after 30 seconds** (you can change this): the bubble gets more insistent, and Agent Pulse can also send an OS notification and a Discord or Slack message with the task summary.',
        '**Something fails**: the bubble turns red and shakes.',
      ],
    },
    {
      heading: 'How it works',
      paragraphs: [
        'Claude Code has lifecycle hooks: small commands it runs when a turn starts, a tool runs, permission is needed or a turn ends. Agent Pulse installs these with one click. They send each event to the app on your own machine (`localhost:4242`), and the app turns the events into the bubble’s state.',
        'The installer only edits Claude Code’s documented settings file (`~/.claude/settings.json`) and backs it up first. Uninstalling the hooks puts it back the way it was.',
      ],
    },
    {
      heading: 'Not just Claude Code',
      paragraphs: [
        'The same bubbles and alerts work for Cursor, GitHub Copilot in VS Code, OpenAI Codex, Kiro, Antigravity, Grok, OpenCode and Muse Code. Each tool gets its own bubble, so you can tell at a glance which agent is blocked.',
      ],
    },
    {
      heading: 'Why not write my own hook script?',
      paragraphs: [
        'You can. A Claude Code `Notification` hook that plays a sound or shows a toast is a few lines, and that’s fine for one tool on one machine.',
        'Agent Pulse is for when that grows: several agents at once, a visible state you can glance at instead of a sound you might miss, escalation when you ignore it, and the same setup on Windows, macOS and Linux.',
      ],
    },
  ],
  faq: [
    {
      question: 'Will it get noisy?',
      answer:
        'Each wait escalates once. OS notifications are off by default, and you can turn off the sound or the screen-edge glow separately.',
    },
    {
      question: 'Does it work when I’m away from my desk?',
      answer:
        'Add a Discord or Slack webhook in Settings and escalations reach your phone through those apps. Nothing else leaves your machine.',
    },
    {
      question: 'Does it slow Claude Code down?',
      answer:
        'No. Each hook is a local HTTP request that takes a fraction of a second. If Agent Pulse isn’t running, Claude Code carries on as normal.',
    },
    {
      question: 'Can I see usage limits too?',
      answer: `Yes. The Claude bubble also shows your 5-hour and weekly usage. See [the usage tracker page](${pageUrl('claude-code-usage-tracker-windows')}).`,
    },
  ],
};

export default page;

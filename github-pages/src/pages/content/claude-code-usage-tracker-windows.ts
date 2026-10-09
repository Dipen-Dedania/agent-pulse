import type { SeoPage } from '../types';
import { homeAnchor } from '../links';

// Facts below are checked against src/main/usage/{poller,credentials}.ts and
// the DEFAULTS in src/main/user-config.ts. Re-check them when those change.
const page: SeoPage = {
  slug: 'claude-code-usage-tracker-windows',
  group: 'use-case',
  title: 'Claude Code Usage Tracker for Windows (Free) | Agent Pulse',
  description:
    'See your Claude Code 5-hour and weekly limits live on Windows. Free, open-source desktop app with cap warnings, reset reminders and Codex & Cursor meters.',
  eyebrow: 'WINDOWS · MACOS · LINUX',
  h1: 'A Claude Code usage tracker that runs on Windows',
  lede:
    "Most Claude usage trackers are Mac menu-bar apps. Agent Pulse shows your 5-hour and weekly Claude Code limits on Windows, macOS and Linux, in a floating bubble and the Settings window. It's free and open source, and everything stays on your machine.",
  updated: '2026-10-09',
  screenshot: { file: 'usage.png', alt: 'Agent Pulse usage meters for Claude Code 5-hour and 7-day windows' },
  sections: [
    {
      heading: 'Why most trackers skip Windows',
      paragraphs: [
        'Many popular usage trackers, such as CodexBar and Tokens 4 Breakfast, are built as macOS menu-bar apps. Windows has no menu bar, so they don’t run there.',
        'Agent Pulse is a cross-platform desktop app. Your usage shows up on the Claude bubble, which floats on top of every window, and in the **Plans & Limits** tab of Settings. It works the same on Windows, macOS and Linux.',
      ],
    },
    {
      heading: 'What you can see',
      bullets: [
        'The **5-hour window**: how much is used and when it resets.',
        'The **7-day window**, plus per-model weekly caps when your plan has them.',
        'Extra usage spend, when pay-as-you-go credits are turned on for your account.',
        'Meters for the other tools you use too: Codex, Cursor’s billing cycle, GitHub Copilot’s monthly quota and Antigravity’s per-model quotas.',
      ],
    },
    {
      heading: 'Where the numbers come from',
      paragraphs: [
        'Agent Pulse reads the sign-in token that Claude Code already keeps in `%USERPROFILE%\\.claude\\.credentials.json` and asks Anthropic for your account’s usage. These are Anthropic’s own figures, not estimates rebuilt from your logs.',
        'It re-reads the token on every check and never stores a copy. By default it checks every 10 minutes. If you install the Claude Code status line, usage also updates as you work. The usage endpoint is undocumented, so if Anthropic changes it the meter says “unavailable” instead of showing a wrong number.',
      ],
    },
    {
      heading: 'Warnings before you hit the wall',
      bullets: [
        '**Cap warning**: a notification when a window drops to 20% remaining. You can change the threshold.',
        '**Use-it-or-lose-it nudge** (optional): a reminder 30 minutes before a window resets when you still have plenty left.',
        '**Backlog usage gate**: if you queue work for agents to run on their own, Agent Pulse stops starting new tasks once the 5-hour window is 95% used.',
      ],
    },
    {
      heading: 'Set it up in two minutes',
      steps: [
        `Download the Windows installer (\`.exe\`) from the [download section](${homeAnchor('download')}). On Windows, later updates install from inside the app.`,
        'Make sure Claude Code is signed in with your Claude account. If it isn’t, run `claude` and then `/login`.',
        'Open Agent Pulse → Settings → **Plans & Limits**. Your 5-hour and 7-day meters appear there.',
        'Optional: in the **Hooks** tab, install the Claude Code hooks with one click. The bubble will then also show when Claude is working or waiting for you.',
      ],
    },
  ],
  faq: [
    {
      question: 'Which Claude plans does it work with?',
      answer:
        'Any plan where Claude Code signs in with your Claude account, such as Pro, Max or Team. If you use Claude Code with only an API key, you pay per token and there is no 5-hour window to show.',
    },
    {
      question: 'Is it accurate?',
      answer:
        'The meters show the percentages Anthropic reports for your account. They are not estimates. The cost cards elsewhere in the app are different: they estimate what your tokens would cost at public API list prices, and they are labeled as estimates.',
    },
    {
      question: 'The meter says “unavailable”. What do I do?',
      answer:
        'Usually Claude Code’s sign-in token has expired. Run any Claude Code command so it refreshes the token, then click Refresh in Plans & Limits.',
    },
    {
      question: 'Does it send my data anywhere?',
      answer:
        'No. The only network calls are to the vendors’ own usage APIs, using your existing sign-in, and the update check. Agent Pulse never sends your prompts or code anywhere.',
    },
    {
      question: 'Is it free?',
      answer:
        'Yes. Agent Pulse is open source under AGPLv3, with no account and no paid tier. A commercial license is available if your company can’t use AGPL software.',
    },
  ],
};

export default page;

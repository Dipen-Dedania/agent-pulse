import type { SeoPage } from '../types';
import { pageUrl } from '../links';

// Competitor facts are from tokens4breakfast.app and its public GitHub repo
// (onekapisch/Tokens-4-Breakfast), checked 2026-10-09. Re-verify before
// changing `updated`; keep the "pick them instead" section honest.
const page: SeoPage = {
  slug: 'tokens-4-breakfast-alternative',
  group: 'compare',
  title: 'Tokens 4 Breakfast Alternative for Windows & Linux | Agent Pulse',
  description:
    'Looking for a Tokens 4 Breakfast alternative? Agent Pulse is free, open source and runs on Windows, macOS and Linux. An honest side-by-side comparison.',
  eyebrow: 'COMPARE',
  h1: 'Agent Pulse vs Tokens 4 Breakfast',
  lede:
    'Tokens 4 Breakfast is a polished macOS menu-bar app for AI spend and rate limits. Agent Pulse covers some of the same ground, but it’s free, open source and cross-platform, and it also shows what your agents are doing right now. Here’s how they compare and when each one is the better pick.',
  updated: '2026-10-09',
  sections: [
    {
      heading: 'The short version',
      bullets: [
        '**Pick Agent Pulse** if you’re on Windows or Linux, want a free and open-source tool, or care about live agent status (working, waiting for you, failed) as much as usage.',
        '**Pick Tokens 4 Breakfast** if you’re on a Mac and mainly want dollar spend across many API providers, with budgets and limit forecasting.',
      ],
    },
  ],
  comparison: {
    competitor: 'Tokens 4 Breakfast',
    rows: [
      { feature: 'Price', agentPulse: 'Free', them: 'Free for 1 provider; Pro $14.99 one-time' },
      { feature: 'Platforms', agentPulse: 'Windows, macOS, Linux', them: 'macOS 14.6+ only' },
      { feature: 'Source code', agentPulse: 'Open (AGPLv3)', them: 'Not published' },
      { feature: 'Live agent status (working / waiting / failed)', agentPulse: true, them: false },
      { feature: 'Alerts when an agent waits for you', agentPulse: 'Sound, screen glow, OS, Discord/Slack', them: false },
      { feature: 'Claude Code 5-hour & weekly limits', agentPulse: true, them: true },
      { feature: 'Codex, Cursor, Copilot usage', agentPulse: true, them: true },
      { feature: 'API-key providers (OpenAI, Anthropic API, OpenRouter, DeepSeek, Mistral)', agentPulse: false, them: true },
      { feature: 'Limit forecast (“when will I run out?”)', agentPulse: 'Threshold warnings only', them: 'Velocity-based forecast' },
      { feature: 'Dollar budgets & subscription tracker', agentPulse: false, them: true },
      { feature: 'Estimated API-price cost', agentPulse: true, them: true },
      { feature: 'Command guardrails & secret-file protection', agentPulse: true, them: false },
      { feature: 'Self-running task backlog', agentPulse: true, them: false },
      { feature: 'Shareable stat cards', agentPulse: false, them: true },
      { feature: 'Runs locally, no account', agentPulse: true, them: true },
    ],
    source:
      'Tokens 4 Breakfast details are from tokens4breakfast.app and its public GitHub repo as of October 2026. Spot something out of date? Open a GitHub issue.',
  },
  afterSections: [
    {
      heading: 'When Tokens 4 Breakfast is the better pick',
      paragraphs: [
        'If you spend real money through API keys (the OpenAI and Anthropic APIs, OpenRouter, DeepSeek, Mistral), Tokens 4 Breakfast tracks those and Agent Pulse doesn’t. Its velocity-based forecast, which estimates when you’ll hit a limit, and its dollar budgets are also features we don’t have yet.',
        'It’s a native Swift app of about 10 MB. Agent Pulse is built on Electron, so it’s larger. If you only use a Mac and want the lightest menu-bar tool, that counts.',
      ],
    },
    {
      heading: 'When Agent Pulse is the better pick',
      bullets: [
        'You work on **Windows or Linux**, where Tokens 4 Breakfast doesn’t run. See [the Windows usage tracker page](' +
          pageUrl('claude-code-usage-tracker-windows') +
          ').',
        'You want to **see your agents, not just your bill**: a floating bubble per agent that shows when it’s working, done or blocked on you. See [notifications when Claude Code needs you](' +
          pageUrl('claude-code-notification-when-done') +
          ').',
        'You run agents unattended and want **guardrails** that block risky shell commands, plus a **backlog** that runs tasks during your scheduled windows.',
        'You want **every feature free**, and source code you can read and change.',
      ],
    },
  ],
  faq: [
    {
      question: 'Can I use both?',
      answer:
        'Yes. They don’t conflict. Tokens 4 Breakfast reads usage data, and Agent Pulse reads the same usage data and adds its own hooks for agent status.',
    },
    {
      question: 'Is Agent Pulse really free?',
      answer:
        'Yes. Every feature is free and open source under AGPLv3, with no paid tier. Companies that can’t use AGPL software can buy a commercial license.',
    },
    {
      question: 'Does Agent Pulse have a Mac menu-bar icon?',
      answer:
        'It has a tray icon on every platform, but its main display is the floating status bubbles. They sit on top of your other windows and you can drag them anywhere.',
    },
  ],
};

export default page;

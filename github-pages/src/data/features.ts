export type BubbleState = 'working' | 'waiting' | 'idle-active' | 'idle' | 'error';

export interface FeatureBullet {
  state: BubbleState;
  title: string;
  description: string;
}

export interface FeatureSectionData {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets?: FeatureBullet[];
  screenshot: string;
  screenshotAlt: string;
  caption?: string;
  imageSide: 'left' | 'right';
  blobColors: [string, string];
}

const screenshot = (file: string) => `${import.meta.env.BASE_URL}screenshots/${file}`;

export const featureSections: FeatureSectionData[] = [
  {
    id: 'ambient-bubbles',
    eyebrow: 'AMBIENT STATUS',
    title: 'Stop tab-hopping to check on your agents',
    body: "Each agent gets its own always-on-top, draggable bubble with a frosted-glass look. A green pulsing glow means it's working. A blue ring and a badge mean it's waiting on you. A red shake means something died. Park them anywhere — the layout survives restarts.",
    bullets: [
      {
        state: 'working',
        title: 'Working',
        description: 'actively using tools, reading files, running commands — green glow with orbiting particles',
      },
      {
        state: 'waiting',
        title: 'Waiting',
        description: 'needs permission or a response to continue; the bubble tells you before Slack does',
      },
      {
        state: 'idle-active',
        title: 'Idle (active)',
        description: 'last turn finished — ready for your next prompt',
      },
      {
        state: 'idle',
        title: 'Idle',
        description: 'no activity yet; calm breathing effect',
      },
      {
        state: 'error',
        title: 'Error / Dead',
        description: "agent stopped unexpectedly or a tool call failed — a red shake you can't miss",
      },
    ],
    screenshot: screenshot('bubbles.png'),
    screenshotAlt: 'Agent Pulse status bubbles floating on a desktop',
    imageSide: 'right',
    blobColors: ['#0099ff', '#8247f5'],
  },
  {
    id: 'usage-meters',
    eyebrow: 'SUBSCRIPTION USAGE',
    title: 'Know your limits before you hit them',
    body: "Live meters for Claude Code's 5-hour and 7-day windows, Codex, Cursor's billing cycle, and Antigravity's per-model quotas. Get a warning when you're about to hit a cap — and a nudge when a window is about to reset unused.",
    screenshot: screenshot('usage.png'),
    screenshotAlt: 'Agent Pulse usage meters for subscription limits',
    imageSide: 'left',
    blobColors: ['#ffa600', '#e55cff'],
  },
  {
    id: 'pulse-timeline',
    eyebrow: 'ANALYTICS',
    title: 'Your agent work, on the record',
    body: 'A local SQLite timeline turns hook events into a daily digest, a GitHub-style activity heatmap, hour-of-day rhythm, tool mix, model usage, and per-project breakdowns. Cost cards show estimated API list prices — clearly labeled estimates, never your real bill.',
    caption: 'Stored in a local database. Privacy toggle redacts task summaries.',
    screenshot: screenshot('timeline.png'),
    screenshotAlt: 'Agent Pulse analytics timeline with activity heatmap',
    imageSide: 'right',
    blobColors: ['#8247f5', '#0099ff'],
  },
  {
    id: 'guardrails',
    eyebrow: 'GUARDRAILS',
    title: 'A seatbelt for autonomous agents',
    body: 'Block or warn on risky shell commands before they reach an agent — `rm -rf /`, force-pushes to protected branches, or anything you define with your own validated regex rules. Every trigger is logged.',
    screenshot: screenshot('guardrails.png'),
    screenshotAlt: 'Agent Pulse command guardrails with a triggered rule',
    imageSide: 'left',
    blobColors: ['#e55cff', '#ffa600'],
  },
];

export type GridIcon =
  | 'statusline'
  | 'alerts'
  | 'scheduler'
  | 'updates'
  | 'tray'
  | 'opensource';

export interface GridCard {
  icon: GridIcon;
  title: string;
  body: string;
}

export const gridCards: GridCard[] = [
  {
    icon: 'statusline',
    title: 'Claude Code status line',
    body: 'Model, context bar, git branch, session cost and more at the bottom of every turn. One-click install; backs up what’s already there.',
  },
  {
    icon: 'alerts',
    title: 'Discord & Slack alerts',
    body: 'When an agent waits past your threshold, get pinged where you actually are.',
  },
  {
    icon: 'scheduler',
    title: 'Cowork scheduler',
    body: "Keeps Claude's 5-hour window warm with scheduled micro-pings, so a fresh window is ready when you sit down.",
  },
  {
    icon: 'updates',
    title: 'Quiet auto-updates',
    body: 'Checks in the background; you choose when to download and restart. Never silent installs.',
  },
  {
    icon: 'tray',
    title: 'Lives in the tray',
    body: 'Single instance, optional launch-on-startup, closes to tray instead of dying.',
  },
  {
    icon: 'opensource',
    title: 'AGPLv3 open source',
    body: 'Read the code, file issues, send PRs. Commercial licensing available.',
  },
];

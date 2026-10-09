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
  /** Optional in-page call to action under the body. */
  link?: { label: string; href: string };
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
    body: "Live meters for Claude Code's 5-hour and 7-day windows, Codex, Cursor's billing cycle, GitHub Copilot's monthly quotas, and Antigravity's per-model quotas. Get a warning when you're about to hit a cap — and a nudge when a window is about to reset unused.",
    link: { label: 'Watch the quota ring drain', href: '#demo-usage' },
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
    id: 'backlog',
    eyebrow: 'BACKLOG',
    title: 'Queue it tonight, review it in the morning',
    body: 'A Kanban board of tasks your agents run themselves — Claude Code or Codex, headless, inside the scheduler windows you set. Only low-risk cards autorun, a usage gate stops claiming work before your 5-hour window runs dry, and a forecast shows what the queue will cost. Finished cards land in review and ping Discord or Slack.',
    link: { label: 'See a night shift play out', href: '#demo-night-shift' },
    screenshot: screenshot('backlog.webp'),
    screenshotAlt: 'Agent Pulse backlog board with Refinement, Todo, In progress, Blocked and Done columns',
    caption: 'Add cards by hand, from GitLab, Jira or Linear issues, or from a Claude Code chat via MCP.',
    imageSide: 'left',
    blobColors: ['#0099ff', '#e55cff'],
  },
  {
    id: 'guardrails',
    eyebrow: 'GUARDRAILS',
    title: 'A seatbelt for autonomous agents',
    body: 'Block or warn on risky shell commands before they reach an agent — `rm -rf /`, force-pushes to protected branches, or anything you define with your own validated regex rules. Secret-file protection keeps agents away from `.env` files, keys and credentials. Every trigger is logged.',
    link: { label: 'See a guardrail catch a command', href: '#demo-guardrails' },
    screenshot: screenshot('guardrails.png'),
    screenshotAlt: 'Agent Pulse command guardrails with a triggered rule',
    imageSide: 'right',
    blobColors: ['#e55cff', '#ffa600'],
  },
];

export type GridIcon =
  | 'statusline'
  | 'alerts'
  | 'mcp'
  | 'scheduler'
  | 'theme'
  | 'setup'
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
    title: 'Status lines for Claude & Codex',
    body: 'Model, context bar, git branch, session cost and more at the bottom of every turn. One-click install; backs up what’s already there.',
  },
  {
    icon: 'alerts',
    title: '“Needs you” escalation',
    body: 'When an agent waits past your threshold, the screen edge glows, an OS notification fires, and Discord or Slack gets pinged.',
  },
  {
    icon: 'mcp',
    title: 'Backlog from your chat',
    body: 'The bundled MCP server lets Claude Code drop work on your board — just say “add that to my backlog”.',
  },
  {
    icon: 'scheduler',
    title: 'Cowork scheduler',
    body: "Keeps Claude's 5-hour window warm with scheduled micro-pings, so a fresh window is ready when you sit down.",
  },
  {
    icon: 'theme',
    title: 'Light & dark',
    body: 'Bubbles and Settings follow your OS theme live — or pin light or dark yourself.',
  },
  {
    icon: 'setup',
    title: 'Guided setup',
    body: 'A first-run tour and a checklist that ticks off from real state: hooks installed, bubbles live, first event received.',
  },
  {
    icon: 'updates',
    title: 'Quiet updates',
    body: 'Checks in the background; you choose when to download and restart. Never silent installs. macOS shows a download banner for now.',
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

export interface Tool {
  name: string;
  logo: string;
  /** URL-slug used as an in-page anchor id (e.g. #claude-code) */
  id: string;
  /** One-line description of how Agent Pulse watches this tool */
  blurb: string;
}

const asset = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;

export const LOGO_URL = asset('logo-transparent.png');

export const tools: Tool[] = [
  {
    name: 'Claude Code',
    logo: asset('claude.png'),
    id: 'claude-code',
    blurb: 'Lifecycle hooks, live 5-hour & 7-day usage, status line and session cost.',
  },
  {
    name: 'Cursor',
    logo: asset('cursor.png'),
    id: 'cursor',
    blurb: 'Agent state plus billing-cycle usage from your Cursor account.',
  },
  {
    name: 'GitHub Copilot',
    logo: asset('githubcopilot.png'),
    id: 'github-copilot',
    blurb: 'VS Code lifecycle state and quota, surfaced as a status bubble.',
  },
  {
    name: 'OpenAI Codex',
    logo: asset('codex.png'),
    id: 'openai-codex',
    blurb: 'Working/idle state and token usage from the Codex rollout.',
  },
  {
    name: 'Kiro',
    logo: asset('kiro.png'),
    id: 'kiro',
    blurb: 'Ambient status bubble driven by Kiro lifecycle events.',
  },
  {
    name: 'Antigravity',
    logo: asset('antigravity.png'),
    id: 'antigravity',
    blurb: 'CLI + IDE state with per-model quota meters.',
  },
];

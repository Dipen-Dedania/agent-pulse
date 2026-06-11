export interface Tool {
  name: string;
  logo: string;
}

const asset = (file: string) => `${import.meta.env.BASE_URL}assets/${file}`;

export const LOGO_URL = asset('logo-transparent.png');

export const tools: Tool[] = [
  { name: 'Claude Code', logo: asset('claude.png') },
  { name: 'Cursor', logo: asset('cursor.png') },
  { name: 'GitHub Copilot', logo: asset('githubcopilot.png') },
  { name: 'OpenAI Codex', logo: asset('codex.png') },
  { name: 'Kiro', logo: asset('kiro.png') },
  { name: 'Antigravity', logo: asset('antigravity.png') },
];

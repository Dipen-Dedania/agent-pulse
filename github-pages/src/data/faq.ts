export interface FaqItem {
  question: string;
  answer: string;
}

export const faqItems: FaqItem[] = [
  {
    question: 'Is it free?',
    answer:
      'Yes. Agent Pulse is open source under AGPLv3. If you want to use it commercially without AGPL obligations, a paid license is available — email dipen27891@gmail.com.',
  },
  {
    question: 'Does it send my data anywhere?',
    answer:
      "No. Events flow from local hooks to a local bridge to a local database. The only network calls are the vendors' own usage APIs (with your existing credentials) and the update check.",
  },
  {
    question: 'Which tools does it support?',
    answer:
      'Claude Code, Cursor, GitHub Copilot (VS Code), OpenAI Codex, Kiro, and Antigravity (CLI + IDE). Hooks install and uninstall with one click each.',
  },
  {
    question: 'How does it know what my agents are doing?',
    answer:
      'Each tool exposes lifecycle hooks. Agent Pulse writes a small hook config that POSTs events to localhost:4242, and normalizes them into a single state model.',
  },
  {
    question: 'Are the cost numbers my real bill?',
    answer:
      "No — they're estimates at public API list prices (via a daily-refreshed LiteLLM table), useful for relative comparison. Your subscription bills differently.",
  },
  {
    question: 'Does it modify my tools?',
    answer:
      'Only their documented hook config files (e.g. ~/.claude/settings.json), and it backs up anything it replaces. Uninstalling a hook restores a clean state.',
  },
  {
    question: 'Windows / macOS / Linux?',
    answer:
      'All three. Windows gets full auto-update; macOS is manual-update for now; Linux ships as an AppImage.',
  },
];

export interface FaqItem {
  question: string;
  answer: string;
  /** Anchor id so other sections can deep-link (and auto-open) this item. */
  id?: string;
  /** Optional numbered steps rendered under the answer. */
  steps?: string[];
  /** Optional copyable terminal command rendered after the steps. */
  command?: { intro: string; text: string };
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
  {
    id: 'mac-not-opened',
    question: 'macOS says “Agent Pulse” Not Opened — Apple could not verify it?',
    answer:
      "That's Gatekeeper. Agent Pulse is open source but not yet signed with a paid Apple Developer ID, so macOS blocks it on first launch. The app is safe — you just need to allow it once. Don't click “Move to Bin”; click “Done”, then:",
    steps: [
      'Make sure Agent Pulse.app is in your Applications folder (drag it out of the .dmg first).',
      'Open System Settings → Privacy & Security and scroll to the Security section.',
      'Next to “Agent Pulse” was blocked to protect your Mac, click Open Anyway and confirm with your password or Touch ID.',
      'Launch Agent Pulse again and click Open. macOS remembers the choice from then on.',
    ],
    command: {
      intro:
        'Prefer the terminal? This clears the download quarantine flag in one step (repeat after each manual update):',
      text: 'xattr -dr com.apple.quarantine "/Applications/Agent Pulse.app"',
    },
  },
];

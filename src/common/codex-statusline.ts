// Codex TUI status line: the catalogue of built-in footer items (the
// serializer table extracted from codex-cli 0.160 — Codex has no custom-command
// item, and renders plain text with no per-item icon or colour), sample values
// for the Settings preview, and the TOML array ↔ item-list codec shared by the
// main process (config.toml writer/detector) and the renderer (editor).

import { CODEX_STATUS_LINE_ITEMS, CodexStatusLineConfig, CodexStatusLineItem } from './types';

export const CODEX_ITEM_LABEL: Record<CodexStatusLineItem, string> = {
  'model': 'Model',
  'model-with-reasoning': 'Model + reasoning effort',
  'reasoning': 'Reasoning effort',
  'app-name': 'App name',
  'codex-version': 'Codex version',
  'current-dir': 'Current directory',
  'project-name': 'Project name',
  'hostname': 'Hostname',
  'git-branch': 'Git branch',
  'branch-changes': 'Branch changes (+/−)',
  'pull-request-number': 'Pull request number',
  'thread-title': 'Thread title',
  'thread-name': 'Thread name',
  'thread-id': 'Thread id',
  'workspace-headline': 'Workspace headline',
  'activity': 'Activity',
  'run-state': 'Run state',
  'approval-mode': 'Approval mode',
  'fast-mode': 'Fast mode',
  'raw-output': 'Raw output',
  'task-progress': 'Task progress',
  'context-remaining': 'Context remaining',
  'context-used': 'Context used',
  'context-window-size': 'Context window size',
  'five-hour-limit': '5-hour limit',
  'weekly-limit': 'Weekly limit',
  'daily-limit': 'Daily limit',
  'monthly-limit': 'Monthly limit',
  'annual-limit': 'Annual limit',
  'usage-limit': 'Primary usage limit',
  'secondary-usage-limit': 'Secondary usage limit',
  'used-tokens': 'Used tokens',
  'total-input-tokens': 'Total input tokens',
  'total-output-tokens': 'Total output tokens',
  'thread-credits': 'Thread credits',
  'estimated-thread-cost': 'Estimated thread cost',
};

// Items absent from the 0.139 serializer table; an older Codex may reject a
// config that names them. Shown as a hint in the editor.
export const CODEX_ITEM_SINCE_0_160: ReadonlySet<CodexStatusLineItem> = new Set<CodexStatusLineItem>([
  'hostname', 'branch-changes', 'pull-request-number', 'thread-name', 'workspace-headline',
  'approval-mode', 'raw-output', 'context-window-size', 'daily-limit', 'monthly-limit',
  'annual-limit', 'usage-limit', 'secondary-usage-limit',
]);

// Sample values for the preview. These follow the sample strings Codex's own
// `/statusline` picker ships ("Context 0% left", "primary 0%", "Tasks 0/0",
// "~$1.825", "Fast on", …) with realistic numbers filled in; the limit items'
// exact wording is Codex's and may differ slightly.
export const CODEX_ITEM_MOCK: Record<CodexStatusLineItem, string> = {
  'model': 'gpt-6-astra',
  'model-with-reasoning': 'gpt-6-astra medium',
  'reasoning': 'medium',
  'app-name': 'Codex',
  'codex-version': '0.160.0',
  'current-dir': '~/Github/agent-pulse',
  'project-name': 'agent-pulse',
  'hostname': 'zti-tech-lead',
  'git-branch': 'main',
  'branch-changes': '+12 -3',
  'pull-request-number': 'PR #123',
  'thread-title': 'Fix status line labels',
  'thread-name': 'status-line',
  'thread-id': '01a10b46-9c4f-7183',
  'workspace-headline': 'Workspace headline',
  'activity': 'Working',
  'run-state': 'Working',
  'approval-mode': 'on-request',
  'fast-mode': 'Fast on',
  'raw-output': 'raw output',
  'task-progress': 'Tasks 2/5',
  'context-remaining': 'Context 62% left',
  'context-used': 'Context 38% used',
  'context-window-size': '272k window',
  'five-hour-limit': '5h 10% left',
  'weekly-limit': 'weekly 86% left',
  'daily-limit': 'daily 40% left',
  'monthly-limit': 'monthly 70% left',
  'annual-limit': 'annual 95% left',
  'usage-limit': 'primary 10%',
  'secondary-usage-limit': 'secondary 86%',
  'used-tokens': '16.1k used',
  'total-input-tokens': '16.0k in',
  'total-output-tokens': '5 out',
  'thread-credits': '5.2 credits',
  'estimated-thread-cost': '~$0.11',
};

export function isCodexStatusLineItem(value: unknown): value is CodexStatusLineItem {
  return typeof value === 'string' && (CODEX_STATUS_LINE_ITEMS as readonly string[]).includes(value);
}

/** Plain-text approximation of the footer Codex will draw for this config. */
export function renderCodexStatusLinePreview(cfg: CodexStatusLineConfig): string {
  return cfg.items.map((item) => CODEX_ITEM_MOCK[item]).join(' · ');
}

/** `["model", "git-branch"]` — the TOML value text we write. */
export function formatStatusLineArray(items: readonly string[]): string {
  return `[${items.map((i) => JSON.stringify(i)).join(', ')}]`;
}

/**
 * Parse the value side of a `status_line = …` line into its string items.
 * Tolerates single or double quotes, trailing commas, and newlines inside the
 * brackets. Returns null for anything that isn't a flat array of strings —
 * including the documented `null` (which disables the footer).
 */
export function parseStatusLineArray(valueText: string): string[] | null {
  const text = valueText.trim();
  if (!text.startsWith('[') || !text.endsWith(']')) return null;
  const inner = text.slice(1, -1);
  const items: string[] = [];
  const re = /\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\s*(,|$)/gy;
  let pos = 0;
  while (pos < inner.length) {
    // Skip whitespace / stray newlines between entries.
    const ws = /\s*/y;
    ws.lastIndex = pos;
    ws.exec(inner);
    pos = ws.lastIndex;
    if (pos >= inner.length) break;
    re.lastIndex = pos;
    const m = re.exec(inner);
    if (!m) return null;
    items.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
    pos = re.lastIndex;
  }
  return items;
}

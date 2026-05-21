import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolId } from '../common/types';
import { GuardrailConfig } from '../common/guardrails';
import { logger } from '../common/logger';

// Cap warning fires when REMAINING credit ≤ threshold (i.e. you're about
// to hit the limit). Nudge fires when REMAINING ≥ threshold AND the window
// is within NUDGE_LEAD_MS of resetting — encourages spending unused quota.
export interface UsageNotificationConfig {
  enabled: boolean;
  threshold: number; // 1–99 (% remaining)
}

export interface UsageConfig {
  enabled: boolean;
  intervalMs: number;                  // hard floor 60_000 enforced by poller
  showSevenDayBar: boolean;            // toggles the 7-day bar under the Claude bubble
  capWarning: UsageNotificationConfig; // notify when remaining ≤ threshold
  nudge: UsageNotificationConfig;      // notify when remaining ≥ threshold + reset imminent
}

// Codex tracks a single weekly window (occasionally a secondary one). No
// per-bar visibility toggle — we always render whatever the API returns.
export interface CodexUsageConfig {
  enabled: boolean;
  intervalMs: number;                  // hard floor 600_000 (10m) enforced by poller
  capWarning: UsageNotificationConfig;
  nudge: UsageNotificationConfig;
}

// Antigravity IDE has per-model quotas — the endpoint is local-only (queries
// the IDE's embedded language server) so polling is cheap but only works
// while the IDE is running. Hard floor is 60s, default 5min.
export interface AntigravityUsageConfig {
  enabled: boolean;
  intervalMs: number;                  // hard floor 60_000 (1m) enforced by poller
  capWarning: UsageNotificationConfig;
  nudge: UsageNotificationConfig;
}

export interface UserConfig {
  enabledBubbles: Partial<Record<ToolId, boolean>>;
  usage: UsageConfig;
  codexUsage: CodexUsageConfig;
  antigravityUsage: AntigravityUsageConfig;
  guardrails: GuardrailConfig;
}

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'agent-pulse-config.json');

const DEFAULTS: UserConfig = {
  enabledBubbles: {
    'claude-code': true,
    'cursor': true,
  },
  usage: {
    enabled: true,
    intervalMs: 10 * 60 * 1000,
    showSevenDayBar: true,
    capWarning: { enabled: true, threshold: 20 },
    nudge:      { enabled: false, threshold: 50 },
  },
  codexUsage: {
    enabled: true,
    intervalMs: 15 * 60 * 1000,
    capWarning: { enabled: true, threshold: 20 },
    nudge:      { enabled: false, threshold: 50 },
  },
  antigravityUsage: {
    enabled: true,
    intervalMs: 5 * 60 * 1000,
    capWarning: { enabled: true, threshold: 20 },
    nudge:      { enabled: false, threshold: 50 },
  },
  guardrails: {
    enabled: true,
    disabledRuleIds: [],
    customRules: [],
  },
};

// Map legacy ToolId keys in persisted configs to their current names so a
// rename in code doesn't strand users on a dead bubble entry. The bubble
// renderer crashes when TOOL_META[toolId] is undefined, so leaving an
// unknown key in enabledBubbles produces a broken bubble window.
const LEGACY_BUBBLE_KEY_RENAMES: Record<string, ToolId> = {
  'gemini-cli': 'antigravity-cli',
};

function migrateEnabledBubbles(raw: unknown): Partial<Record<ToolId, boolean>> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<Record<ToolId, boolean>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'boolean') continue;
    const renamed = LEGACY_BUBBLE_KEY_RENAMES[key];
    const finalKey = (renamed ?? key) as ToolId;
    // Don't overwrite an existing modern entry with a stale legacy value.
    if (out[finalKey] === undefined) out[finalKey] = value;
  }
  return out;
}

export function loadConfig(): UserConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const usage = parsed.usage ?? {};
      const codexUsage = parsed.codexUsage ?? {};
      const antigravityUsage = parsed.antigravityUsage ?? {};
      const guardrails = parsed.guardrails ?? {};
      return {
        ...DEFAULTS,
        ...parsed,
        enabledBubbles: migrateEnabledBubbles(parsed.enabledBubbles),
        usage: {
          ...DEFAULTS.usage,
          ...usage,
          capWarning: { ...DEFAULTS.usage.capWarning, ...(usage.capWarning ?? {}) },
          nudge:      { ...DEFAULTS.usage.nudge,      ...(usage.nudge ?? {}) },
        },
        codexUsage: {
          ...DEFAULTS.codexUsage,
          ...codexUsage,
          capWarning: { ...DEFAULTS.codexUsage.capWarning, ...(codexUsage.capWarning ?? {}) },
          nudge:      { ...DEFAULTS.codexUsage.nudge,      ...(codexUsage.nudge ?? {}) },
        },
        antigravityUsage: {
          ...DEFAULTS.antigravityUsage,
          ...antigravityUsage,
          capWarning: { ...DEFAULTS.antigravityUsage.capWarning, ...(antigravityUsage.capWarning ?? {}) },
          nudge:      { ...DEFAULTS.antigravityUsage.nudge,      ...(antigravityUsage.nudge ?? {}) },
        },
        guardrails: {
          enabled:         guardrails.enabled ?? DEFAULTS.guardrails.enabled,
          disabledRuleIds: Array.isArray(guardrails.disabledRuleIds) ? guardrails.disabledRuleIds : [],
          customRules:     Array.isArray(guardrails.customRules)     ? guardrails.customRules     : [],
        },
      };
    }
  } catch {
    // Corrupt config — fall back to defaults
  }
  return {
    ...DEFAULTS,
    usage: {
      ...DEFAULTS.usage,
      capWarning: { ...DEFAULTS.usage.capWarning },
      nudge:      { ...DEFAULTS.usage.nudge },
    },
    codexUsage: {
      ...DEFAULTS.codexUsage,
      capWarning: { ...DEFAULTS.codexUsage.capWarning },
      nudge:      { ...DEFAULTS.codexUsage.nudge },
    },
    antigravityUsage: {
      ...DEFAULTS.antigravityUsage,
      capWarning: { ...DEFAULTS.antigravityUsage.capWarning },
      nudge:      { ...DEFAULTS.antigravityUsage.nudge },
    },
    guardrails: {
      ...DEFAULTS.guardrails,
      disabledRuleIds: [...DEFAULTS.guardrails.disabledRuleIds],
      customRules:     [...DEFAULTS.guardrails.customRules],
    },
  };
}

export function saveConfig(config: UserConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    logger.error('Failed to save user config:', e);
  }
}

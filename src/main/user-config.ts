import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolId } from '../common/types';
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

export interface UserConfig {
  enabledBubbles: Partial<Record<ToolId, boolean>>;
  usage: UsageConfig;
  codexUsage: CodexUsageConfig;
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
};

export function loadConfig(): UserConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(raw);
      const usage = parsed.usage ?? {};
      const codexUsage = parsed.codexUsage ?? {};
      return {
        ...DEFAULTS,
        ...parsed,
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
  };
}

export function saveConfig(config: UserConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    logger.error('Failed to save user config:', e);
  }
}

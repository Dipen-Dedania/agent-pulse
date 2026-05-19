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
  capWarning: UsageNotificationConfig; // notify when remaining ≤ threshold
  nudge: UsageNotificationConfig;      // notify when remaining ≥ threshold + reset imminent
}

export interface UserConfig {
  enabledBubbles: Partial<Record<ToolId, boolean>>;
  usage: UsageConfig;
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
      return {
        ...DEFAULTS,
        ...parsed,
        usage: {
          ...DEFAULTS.usage,
          ...usage,
          capWarning: { ...DEFAULTS.usage.capWarning, ...(usage.capWarning ?? {}) },
          nudge:      { ...DEFAULTS.usage.nudge,      ...(usage.nudge ?? {}) },
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
  };
}

export function saveConfig(config: UserConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    logger.error('Failed to save user config:', e);
  }
}

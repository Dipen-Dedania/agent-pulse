import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolId } from '../common/types';

export interface UserConfig {
  enabledBubbles: Partial<Record<ToolId, boolean>>;
}

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'agent-pulse-config.json');

const DEFAULTS: UserConfig = {
  enabledBubbles: {
    'claude-code': true,
    'cursor': true,
  },
};

export function loadConfig(): UserConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupt config — fall back to defaults
  }
  return { ...DEFAULTS };
}

export function saveConfig(config: UserConfig): void {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save user config:', e);
  }
}

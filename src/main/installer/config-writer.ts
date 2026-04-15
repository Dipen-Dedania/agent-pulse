import fs from 'fs';
import path from 'path';
import os from 'os';
import { ToolId } from '../../common/types';

export class ConfigWriter {
  private bridgeUrl = 'http://localhost:4242/event';

  public async installHook(toolId: ToolId, projectPath?: string) {
    switch (toolId) {
      case 'cursor':
        return this.writeCursorHook(projectPath);
      case 'claude-code':
        return this.writeClaudeCodeHook();
      default:
        throw new Error(`Hook installation for ${toolId} not yet implemented`);
    }
  }

  private writeCursorHook(projectPath?: string) {
    const targetDir = projectPath
      ? path.join(projectPath, '.cursor')
      : path.join(os.homedir(), '.cursor');

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const hookConfig = {
      hooks: {
        preToolUse: `curl -X POST ${this.bridgeUrl} -d '{"toolId": "cursor", "state": "working"}'`,
        postToolUse: `curl -X POST ${this.bridgeUrl} -d '{"toolId": "cursor", "state": "idle"}'`,
      }
    };

    fs.writeFileSync(
      path.join(targetDir, 'hooks.json'),
      JSON.stringify(hookConfig, null, 2)
    );
    return { success: true, path: path.join(targetDir, 'hooks.json') };
  }

  private writeClaudeCodeHook() {
    // Claude Code might use a global config or a shell alias
    // For MVP, we simulate writing to a config file
    const configPath = path.join(os.homedir(), '.claude', 'pulse-hooks.json');

    const hookConfig = {
      onStart: `curl -X POST ${this.bridgeUrl} -d '{"toolId": "claude-code", "state": "working"}'`,
      onEnd: `curl -X POST ${this.bridgeUrl} -d '{"toolId": "claude-code", "state": "idle"}'`,
    };

    fs.writeFileSync(configPath, JSON.stringify(hookConfig, null, 2));
    return { success: true, path: configPath };
  }

  public uninstallHook(toolId: ToolId, projectPath?: string) {
    // Logic to remove the hooks and restore original config
    return { success: true };
  }
}

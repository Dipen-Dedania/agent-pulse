import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

export class ToolDetector {
  public async detectAll() {
    return {
      'claude-code': this.detectClaudeCode(),
      'cursor': this.detectCursor(),
      'vscode-copilot': this.detectVSCodeCopilot(),
      'openai-codex': this.detectOpenAICodex(),
    };
  }

  private detectClaudeCode(): boolean {
    const home = os.homedir();
    const configDir = path.join(home, '.claude');
    if (existsSync(configDir)) return true;

    try {
      execSync('claude --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private detectCursor(): boolean {
    const home = os.homedir();
    const paths = [
      path.join(home, 'AppData', 'Local', 'Programs', 'cursor'), // Windows
      path.join(home, 'Applications', 'Cursor.app'),             // macOS
      '/usr/local/bin/cursor',                                   // Linux
    ];
    return paths.some(p => existsSync(p));
  }

  private detectVSCodeCopilot(): boolean {
    const home = os.homedir();
    const extensionsDir = path.join(home, '.vscode', 'extensions');
    if (!existsSync(extensionsDir)) return false;

    // This is a simplified check; in a real app we'd list the directory
    // and look for the Copilot extension ID
    return true;
  }

  private detectOpenAICodex(): boolean {
    // Codex usually operates via API or specific IDE plugins
    // For MVP, we check for a generic Codex config or environment variable
    return process.env.OPENAI_API_KEY !== undefined;
  }
}

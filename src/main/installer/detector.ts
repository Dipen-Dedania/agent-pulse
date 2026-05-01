import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { ToolId } from '../../common/types';

export interface ToolDetection {
  installed: boolean;
  hookInstalled?: boolean;
  location?: string;
}

export type DetectionResult = Record<ToolId, ToolDetection>;

export class ToolDetector {
  public async detectAll(): Promise<DetectionResult> {
    return {
      'claude-code': this.detectClaudeCode(),
      'cursor': this.detectCursor(),
      'vscode-copilot': this.detectVSCodeCopilot(),
      'openai-codex': this.detectOpenAICodex(),
      'kiro': this.detectKiro(),
      'gemini-cli': this.detectGeminiCli(),
    };
  }

  private firstExisting(paths: string[]): string | undefined {
    return paths.find((p) => existsSync(p));
  }

  private whichCommand(cmd: string): string | undefined {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    try {
      const out = execSync(`${lookup} ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim()
        .split(/\r?\n/)[0];
      return out || undefined;
    } catch {
      return undefined;
    }
  }

  private detectClaudeCode(): ToolDetection {
    const home = os.homedir();
    const configDir = path.join(home, '.claude');
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const cliPath = this.whichCommand('claude');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private detectCursor(): ToolDetection {
    const home = os.homedir();
    const candidates =
      process.platform === 'win32'
        ? this.windowsCursorCandidates(home)
        : process.platform === 'darwin'
          ? ['/Applications/Cursor.app', path.join(home, 'Applications', 'Cursor.app')]
          : ['/usr/local/bin/cursor', '/usr/bin/cursor', '/opt/cursor'];

    const found = this.firstExisting(candidates);
    if (found) return { installed: true, location: found };

    const cliPath = this.whichCommand('cursor');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private windowsCursorCandidates(home: string): string[] {
    // Resolve Program Files dynamically — hard-coding `C:\Program Files` misses
    // localized installs (some Windows SKUs use a translated folder name) and
    // 32-bit installs under `Program Files (x86)`. Both env vars are populated
    // by Windows itself.
    const programFiles    = process.env['ProgramFiles']      ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    return [
      path.join(home, 'AppData', 'Local', 'Programs', 'cursor'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Cursor'),
      path.join(programFiles, 'Cursor'),
      path.join(programFilesX86, 'Cursor'),
    ];
  }

  private detectVSCodeCopilot(): ToolDetection {
    const home = os.homedir();
    const extensionsDir = path.join(home, '.vscode', 'extensions');
    if (!existsSync(extensionsDir)) return { installed: false };

    try {
      const { readdirSync } = require('fs');
      const entries: string[] = readdirSync(extensionsDir);
      const match = entries.find((e) => e.startsWith('github.copilot'));
      if (match) return { installed: true, location: path.join(extensionsDir, match) };
    } catch {
      // fall through
    }
    return { installed: false };
  }

  private detectOpenAICodex(): ToolDetection {
    const home = os.homedir();
    const configDir = path.join(home, '.codex');
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const cliPath = this.whichCommand('codex');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private detectKiro(): ToolDetection {
    const home = os.homedir();
    const candidates =
      process.platform === 'win32'
        ? [path.join(home, 'AppData', 'Local', 'Programs', 'Kiro'), path.join(home, '.kiro')]
        : process.platform === 'darwin'
          ? ['/Applications/Kiro.app', path.join(home, 'Applications', 'Kiro.app'), path.join(home, '.kiro')]
          : ['/usr/local/bin/kiro', '/usr/bin/kiro', path.join(home, '.kiro')];

    const found = this.firstExisting(candidates);
    if (found) return { installed: true, location: found };

    const cliPath = this.whichCommand('kiro');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private detectGeminiCli(): ToolDetection {
    const home = os.homedir();
    const configDir = path.join(home, '.gemini');
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const cliPath = this.whichCommand('gemini');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }
}

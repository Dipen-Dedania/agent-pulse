import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { ToolId, StatusLineRuntime } from '../../common/types';
import { resolveAugmentedPath } from '../shell-path';

export interface ToolDetection {
  installed: boolean;
  hookInstalled?: boolean;
  location?: string;
}

export interface StatusLineRuntimeDetection {
  runtime: StatusLineRuntime;
  binPath: string; // absolute path to the interpreter, written into the command
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
      'antigravity-cli': this.detectAntigravityCli(),
      'grok': this.detectGrok(),
    };
  }

  private firstExisting(paths: string[]): string | undefined {
    return paths.find((p) => existsSync(p));
  }

  private whichCommand(cmd: string): string | undefined {
    // execFile (not exec) so `cmd` is never spliced into a shell command line —
    // keeps us safe if a future caller ever passes user input here. Look up
    // against the augmented login-shell PATH: a GUI-launched app's PATH omits
    // ~/.local/bin, Homebrew, nvm, etc. where these CLIs are usually installed.
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    const env = { ...process.env, PATH: resolveAugmentedPath() };
    try {
      const out = execFileSync(lookup, [cmd], { stdio: ['ignore', 'pipe', 'ignore'], env })
        .toString()
        .trim()
        .split(/\r?\n/)[0];
      return out || undefined;
    } catch {
      return undefined;
    }
  }

  // Find the best script runtime for the Claude Code status line. Claude Code
  // spawns the status-line command as its own process, so we write the resolved
  // ABSOLUTE interpreter path into the command (not a bare `node`) to dodge the
  // PATH-resolution gap between a GUI-launched app and the terminal. Probe in
  // preference order: node (matches our stack) → python3/python → powershell
  // (Windows-only fallback, always present there).
  public detectStatusLineRuntime(): StatusLineRuntimeDetection | null {
    const node = this.whichCommand('node');
    if (node) return { runtime: 'node', binPath: node };

    const py3 = this.whichCommand('python3');
    if (py3) return { runtime: 'python', binPath: py3 };
    const py = this.whichCommand('python');
    if (py) return { runtime: 'python', binPath: py };

    if (process.platform === 'win32') {
      const pwsh = this.whichCommand('powershell');
      if (pwsh) return { runtime: 'powershell', binPath: pwsh };
    }
    return null;
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
    const installDirs = [
      path.join(home, 'AppData', 'Local', 'Programs', 'cursor'),
      path.join(home, 'AppData', 'Local', 'Programs', 'Cursor'),
      path.join(programFiles, 'Cursor'),
      path.join(programFilesX86, 'Cursor'),
    ];
    // Probe the actual executable, not just the install folder. An uninstall
    // (or a half-finished install) can leave an empty `cursor` directory behind,
    // and a bare-directory check would read that as "Cursor installed" — the
    // false positive that seeds a phantom Cursor bubble on machines without it.
    return installDirs.map((d) => path.join(d, 'Cursor.exe'));
  }

  private detectVSCodeCopilot(): ToolDetection {
    // GitHub Copilot lives in three possible places depending on VS Code version:
    //   1. Legacy: `~/.vscode/extensions/github.copilot*` (older marketplace installs)
    //   2. Built-in: VS Code globalStorage holds `github.copilot-chat` data even when
    //      no extension folder exists — Copilot Chat ships integrated in recent builds.
    //   3. CLI-only: `~/.copilot/` from `copilot` CLI installs.
    // Probe all of them so the card doesn't read "Not installed" when the user has it.
    const home = os.homedir();
    const { readdirSync } = require('fs');

    // 1. Legacy marketplace install (VS Code + Insiders)
    const extensionDirs = [
      path.join(home, '.vscode', 'extensions'),
      path.join(home, '.vscode-insiders', 'extensions'),
    ];
    for (const extensionsDir of extensionDirs) {
      if (!existsSync(extensionsDir)) continue;
      try {
        const entries: string[] = readdirSync(extensionsDir);
        const match = entries.find((e) => e.startsWith('github.copilot'));
        if (match) return { installed: true, location: path.join(extensionsDir, match) };
      } catch {
        // fall through
      }
    }

    // 2. globalStorage (built-in / integrated Copilot Chat)
    const globalStorageRoots = this.vsCodeGlobalStorageRoots(home);
    for (const root of globalStorageRoots) {
      const copilotData = path.join(root, 'github.copilot-chat');
      if (existsSync(copilotData)) return { installed: true, location: copilotData };
      const copilotLegacy = path.join(root, 'github.copilot');
      if (existsSync(copilotLegacy)) return { installed: true, location: copilotLegacy };
    }

    // 3. Copilot CLI
    const cliConfig = path.join(home, '.copilot');
    if (existsSync(cliConfig)) return { installed: true, location: cliConfig };
    const cliPath = this.whichCommand('copilot');
    if (cliPath) return { installed: true, location: cliPath };

    return { installed: false };
  }

  private vsCodeGlobalStorageRoots(home: string): string[] {
    if (process.platform === 'win32') {
      const appData = process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');
      return [
        path.join(appData, 'Code', 'User', 'globalStorage'),
        path.join(appData, 'Code - Insiders', 'User', 'globalStorage'),
      ];
    }
    if (process.platform === 'darwin') {
      return [
        path.join(home, 'Library', 'Application Support', 'Code', 'User', 'globalStorage'),
        path.join(home, 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage'),
      ];
    }
    return [
      path.join(home, '.config', 'Code', 'User', 'globalStorage'),
      path.join(home, '.config', 'Code - Insiders', 'User', 'globalStorage'),
    ];
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

  private detectGrok(): ToolDetection {
    // Grok stores its config under ~/.grok (overridable via GROK_HOME). Prefer
    // that dir; fall back to a `grok` binary on PATH for CLI-only installs.
    const home = os.homedir();
    const configDir = process.env['GROK_HOME'] || path.join(home, '.grok');
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const cliPath = this.whichCommand('grok');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private detectAntigravityCli(): ToolDetection {
    // Antigravity CLI (agy) nests its config dir inside the legacy `.gemini`
    // directory at `~/.gemini/antigravity-cli/` rather than its own top-level
    // dot dir. Probe that first, then fall back to PATH lookup for the binary.
    const home = os.homedir();
    const configDir = path.join(home, '.gemini', 'antigravity-cli');
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const cliPath = this.whichCommand('agy');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }
}

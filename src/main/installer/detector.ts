import { existsSync, readdirSync } from 'fs';
import path from 'path';
import os from 'os';
import { ToolId, StatusLineRuntime } from '../../common/types';
import { whichAsync } from './which';
import { opencodeConfigDir, opencodeDataDirs } from './opencode-paths';
import { museConfigDir, museWindowsInstallDir } from './muse-paths';

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

/**
 * Finds which AI coding tools are installed. Each probe tries cheap filesystem
 * checks first and only falls back to a `where`/`which` lookup when those miss.
 *
 * Detection is fully asynchronous: the PATH lookups run as child processes in
 * parallel and never block the main thread (they used to run back to back via
 * execFileSync inside the `ready` handler). Concurrent callers share a single
 * in-flight run, and the result is kept until `invalidate()` so the launch
 * path, the Hooks tab and secret-file sync don't each spawn their own set.
 */
export class ToolDetector {
  private inflight: Promise<DetectionResult> | null = null;
  private last: DetectionResult | null = null;

  public detectAll(): Promise<DetectionResult> {
    if (this.last) return Promise.resolve(this.last);
    if (this.inflight) return this.inflight;
    this.inflight = this.runDetectAll()
      .then((result) => {
        this.last = result;
        return result;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  /** Forget the cached result so the next `detectAll()` probes again. */
  public invalidate(): void {
    this.last = null;
  }

  /** The most recent completed result, if any (never triggers a run). */
  public lastResult(): DetectionResult | null {
    return this.last;
  }

  private async runDetectAll(): Promise<DetectionResult> {
    const [claudeCode, cursor, vscodeCopilot, openaiCodex, kiro, antigravityCli, grok, opencode, museCode] =
      await Promise.all([
        this.detectClaudeCode(),
        this.detectCursor(),
        this.detectVSCodeCopilot(),
        this.detectOpenAICodex(),
        this.detectKiro(),
        this.detectAntigravityCli(),
        this.detectGrok(),
        this.detectOpencode(),
        this.detectMuseCode(),
      ]);
    return {
      'claude-code': claudeCode,
      'cursor': cursor,
      'vscode-copilot': vscodeCopilot,
      'openai-codex': openaiCodex,
      'kiro': kiro,
      'antigravity-cli': antigravityCli,
      'grok': grok,
      'opencode': opencode,
      'muse-code': museCode,
    };
  }

  private firstExisting(paths: string[]): string | undefined {
    return paths.find((p) => existsSync(p));
  }

  // `which`/`where` against the augmented login-shell PATH: a GUI-launched
  // app's PATH omits ~/.local/bin, Homebrew, nvm, etc. where these CLIs are
  // usually installed. Async so a miss (which is the common case for tools the
  // user doesn't have) never stalls the main thread.
  private whichCommand(cmd: string): Promise<string | undefined> {
    return whichAsync(cmd);
  }

  // Find the best script runtime for the Claude Code status line. Claude Code
  // spawns the status-line command as its own process, so we write the resolved
  // ABSOLUTE interpreter path into the command (not a bare `node`) to dodge the
  // PATH-resolution gap between a GUI-launched app and the terminal. Probe in
  // preference order: node (matches our stack) → python3/python → powershell
  // (Windows-only fallback, always present there).
  public async detectStatusLineRuntime(): Promise<StatusLineRuntimeDetection | null> {
    const node = await this.whichCommand('node');
    if (node) return { runtime: 'node', binPath: node };

    const py3 = await this.whichCommand('python3');
    if (py3) return { runtime: 'python', binPath: py3 };
    const py = await this.whichCommand('python');
    if (py) return { runtime: 'python', binPath: py };

    if (process.platform === 'win32') {
      const pwsh = await this.whichCommand('powershell');
      if (pwsh) return { runtime: 'powershell', binPath: pwsh };
    }
    return null;
  }

  private async detectClaudeCode(): Promise<ToolDetection> {
    const home = os.homedir();
    const configDir = path.join(home, '.claude');
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const cliPath = await this.whichCommand('claude');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private async detectCursor(): Promise<ToolDetection> {
    const home = os.homedir();
    const candidates =
      process.platform === 'win32'
        ? this.windowsCursorCandidates(home)
        : process.platform === 'darwin'
          ? ['/Applications/Cursor.app', path.join(home, 'Applications', 'Cursor.app')]
          : ['/usr/local/bin/cursor', '/usr/bin/cursor', '/opt/cursor'];

    const found = this.firstExisting(candidates);
    if (found) return { installed: true, location: found };

    const cliPath = await this.whichCommand('cursor');
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

  private async detectVSCodeCopilot(): Promise<ToolDetection> {
    // GitHub Copilot lives in three possible places depending on VS Code version:
    //   1. Legacy: `~/.vscode/extensions/github.copilot*` (older marketplace installs)
    //   2. Built-in: VS Code globalStorage holds `github.copilot-chat` data even when
    //      no extension folder exists — Copilot Chat ships integrated in recent builds.
    //   3. CLI-only: `~/.copilot/` from `copilot` CLI installs.
    // Probe all of them so the card doesn't read "Not installed" when the user has it.
    const home = os.homedir();

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
    const cliPath = await this.whichCommand('copilot');
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

  private async detectOpenAICodex(): Promise<ToolDetection> {
    const home = os.homedir();
    const configDir = path.join(home, '.codex');
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const cliPath = await this.whichCommand('codex');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private async detectKiro(): Promise<ToolDetection> {
    const home = os.homedir();
    const candidates =
      process.platform === 'win32'
        ? [path.join(home, 'AppData', 'Local', 'Programs', 'Kiro'), path.join(home, '.kiro')]
        : process.platform === 'darwin'
          ? ['/Applications/Kiro.app', path.join(home, 'Applications', 'Kiro.app'), path.join(home, '.kiro')]
          : ['/usr/local/bin/kiro', '/usr/bin/kiro', path.join(home, '.kiro')];

    const found = this.firstExisting(candidates);
    if (found) return { installed: true, location: found };

    const cliPath = await this.whichCommand('kiro');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private async detectGrok(): Promise<ToolDetection> {
    // Grok stores its config under ~/.grok (overridable via GROK_HOME). Prefer
    // that dir; fall back to a `grok` binary on PATH for CLI-only installs.
    const home = os.homedir();
    const configDir = process.env['GROK_HOME'] || path.join(home, '.grok');
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const cliPath = await this.whichCommand('grok');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private async detectOpencode(): Promise<ToolDetection> {
    // OpenCode keeps CONFIG under ~/.config/opencode and DATA under
    // ~/.local/share/opencode — on every platform including Windows (verified
    // on 1.18.18; it does not use %APPDATA%). OPENCODE_CONFIG may point the
    // config dir elsewhere, so honour it first.
    //
    // Probe the data dir too: a user who has run OpenCode but never written a
    // config file still has ~/.local/share/opencode/opencode.db. Checking only
    // the config dir would read as "not installed" for them.
    const configDir = opencodeConfigDir();
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const dataDir = this.firstExisting(opencodeDataDirs());
    if (dataDir) return { installed: true, location: dataDir };

    const cliPath = await this.whichCommand('opencode');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private async detectMuseCode(): Promise<ToolDetection> {
    // Muse Code keeps its config under $XDG_CONFIG_HOME/muse or ~/.config/muse
    // on every platform (verified on 1.4.1 — no %APPDATA%). A fresh native
    // Windows install has no config dir until first login, so also probe the
    // installer's fixed location (%LOCALAPPDATA%/Programs/muse, holding a
    // muse.cmd launcher) before falling back to a `muse` binary on PATH.
    // A WSL-only install is deliberately not detected: its hooks would run
    // inside the Linux VM and never reach this side's bridge.
    const configDir = museConfigDir();
    if (existsSync(configDir)) return { installed: true, location: configDir };

    if (process.platform === 'win32') {
      const launcher = path.join(museWindowsInstallDir(), 'muse.cmd');
      if (existsSync(launcher)) return { installed: true, location: launcher };
    }

    const cliPath = await this.whichCommand('muse');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }

  private async detectAntigravityCli(): Promise<ToolDetection> {
    // Antigravity CLI (agy) nests its config dir inside the legacy `.gemini`
    // directory at `~/.gemini/antigravity-cli/` rather than its own top-level
    // dot dir. Probe that first, then fall back to PATH lookup for the binary.
    const home = os.homedir();
    const configDir = path.join(home, '.gemini', 'antigravity-cli');
    if (existsSync(configDir)) return { installed: true, location: configDir };

    const cliPath = await this.whichCommand('agy');
    if (cliPath) return { installed: true, location: cliPath };
    return { installed: false };
  }
}

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
      case 'vscode-copilot':
        return this.writeCopilotHook(projectPath);
      case 'openai-codex':
        return this.writeCodexHook(projectPath);
      case 'kiro':
        return this.writeKiroHook(projectPath);
      default:
        throw new Error(`Hook installation for ${toolId} not yet implemented`);
    }
  }

  private writeCursorHook(projectPath?: string) {
    // Cursor supports native shell hooks via hooks.json.
    // We install hook scripts and register them in ~/.cursor/hooks.json (user-level)
    // or <project>/.cursor/hooks.json (project-level).
    const cursorDir = projectPath
      ? path.join(projectPath, '.cursor')
      : path.join(os.homedir(), '.cursor');
    const hooksScriptDir = path.join(cursorDir, 'hooks');

    if (!fs.existsSync(hooksScriptDir)) {
      fs.mkdirSync(hooksScriptDir, { recursive: true });
    }

    // Write hook scripts
    const shScript = this.buildShellScript();
    const ps1Script = this.buildPowerShellScript();
    const shPath  = path.join(hooksScriptDir, 'agent-pulse.sh');
    const ps1Path = path.join(hooksScriptDir, 'agent-pulse.ps1');

    fs.writeFileSync(shPath, shScript, { mode: 0o755 });
    fs.writeFileSync(ps1Path, ps1Script);

    // Pick command based on current platform; the hooks.json will use the right one
    const isWindows = process.platform === 'win32';
    const hookCommand = isWindows
      ? `powershell -ExecutionPolicy Bypass -File "${ps1Path.replace(/\\/g, '/')}"`
      : `"${shPath}"`;

    // Write hooks.json
    const hooksConfigPath = path.join(cursorDir, 'hooks.json');
    let existing: any = { version: 1, hooks: {} };
    if (fs.existsSync(hooksConfigPath)) {
      try { existing = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8')); } catch { /* start fresh */ }
    }
    existing.version = 1;
    existing.hooks = existing.hooks ?? {};

    const hook = { command: hookCommand, timeout: 5 };
    const events = ['preToolUse', 'postToolUse', 'postToolUseFailure', 'sessionStart', 'sessionEnd', 'stop'];
    for (const event of events) {
      const arr: any[] = existing.hooks[event] ?? [];
      // Replace any previous Agent Pulse entry; preserve other hooks.
      const filtered = arr.filter((h: any) => !h.command?.includes('agent-pulse'));
      filtered.push(hook);
      existing.hooks[event] = filtered;
    }

    fs.writeFileSync(hooksConfigPath, JSON.stringify(existing, null, 2));
    return { success: true, path: hooksConfigPath };
  }

  /** Bash script: reads stdin JSON, POSTs to the bridge, exits 0 (success / allow). */
  private buildShellScript(): string {
    return `#!/usr/bin/env bash
# Agent Pulse — hook script (bash)
# Reads the event JSON from stdin and forwards it to the bridge.
BODY=$(cat)
curl -s -o /dev/null -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.bridgeUrl}" || true
exit 0
`;
  }

  /** PowerShell script: reads stdin JSON, POSTs to the bridge, exits 0 (success / allow). */
  private buildPowerShellScript(): string {
    return `# Agent Pulse — hook script (PowerShell)
# Reads the event JSON from stdin and forwards it to the bridge.
# Use StreamReader with explicit UTF-8 (no BOM) to avoid prepending a BOM to the body.
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
$body = $reader.ReadToEnd()
$reader.Close()
try {
  Invoke-WebRequest -Uri "${this.bridgeUrl}" \`
    -Method POST \`
    -ContentType "application/json" \`
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) \`
    -UseBasicParsing | Out-Null
} catch { }
exit 0
`;
  }

  private writeCopilotHook(projectPath?: string) {
    // VS Code Copilot hooks live in .github/hooks/*.json (workspace) or
    // a user-level path configured via chat.hookFilesLocations.
    // We write to the workspace .github/hooks/ directory when a project path
    // is given, otherwise fall back to a global location the user can reference.
    const hooksDir = projectPath
      ? path.join(projectPath, '.github', 'hooks')
      : path.join(os.homedir(), '.copilot', 'hooks');

    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    // Write hook scripts (same shell/PS1 scripts — reads stdin JSON and POSTs to bridge)
    const shScript  = this.buildShellScript();
    const ps1Script = this.buildPowerShellScript();
    const shPath    = path.join(hooksDir, 'agent-pulse.sh');
    const ps1Path   = path.join(hooksDir, 'agent-pulse.ps1');

    fs.writeFileSync(shPath, shScript, { mode: 0o755 });
    fs.writeFileSync(ps1Path, ps1Script);

    // Build a cross-platform hook entry per the Copilot docs:
    // `command` is the unix default, `windows` is the OS-specific override.
    // For workspace installs use relative paths (portable across clones);
    // for global installs use absolute paths.
    let hook: Record<string, unknown>;
    if (projectPath) {
      hook = {
        type: 'command',
        command: './.github/hooks/agent-pulse.sh',
        windows: `powershell -ExecutionPolicy Bypass -File ".github\\hooks\\agent-pulse.ps1"`,
        timeout: 5,
      };
    } else {
      hook = {
        type: 'command',
        command: `"${shPath.replace(/\\/g, '/')}"`,
        windows: `powershell -ExecutionPolicy Bypass -File "${ps1Path.replace(/\\/g, '/')}"`,
        timeout: 5,
      };
    }

    // Write hooks.json — VS Code Copilot format uses PascalCase event names.
    // Register all lifecycle events so the bubble tracks the full agent lifecycle.
    const hooksConfigPath = path.join(hooksDir, 'agent-pulse-hooks.json');
    const config = {
      hooks: {
        SessionStart:     [hook],
        UserPromptSubmit: [hook],
        PreToolUse:       [hook],
        PostToolUse:      [hook],
        PreCompact:       [hook],
        SubagentStart:    [hook],
        SubagentStop:     [hook],
        Stop:             [hook],
      },
    };

    fs.writeFileSync(hooksConfigPath, JSON.stringify(config, null, 2));
    return { success: true, path: hooksConfigPath };
  }

  private writeCodexHook(projectPath?: string) {
    const codexDir = projectPath
      ? path.join(projectPath, '.codex')
      : path.join(os.homedir(), '.codex');
    const hooksScriptDir = path.join(codexDir, 'hooks');

    if (!fs.existsSync(hooksScriptDir)) {
      fs.mkdirSync(hooksScriptDir, { recursive: true });
    }

    // Write bash hook script (Codex Windows support is disabled upstream)
    const shPath = path.join(hooksScriptDir, 'agent-pulse.sh');
    fs.writeFileSync(shPath, this.buildShellScript(), { mode: 0o755 });

    // Write hooks.json — Codex uses the same nested matcher-group structure as Claude Code
    const hooksConfigPath = path.join(codexDir, 'hooks.json');
    let existing: any = { hooks: {} };
    if (fs.existsSync(hooksConfigPath)) {
      try { existing = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8')); } catch { /* start fresh */ }
    }
    existing.hooks = existing.hooks ?? {};

    const group = { matcher: '*', hooks: [{ type: 'command', command: shPath, timeout: 10 }] };
    existing.hooks.SessionStart      = [group];
    existing.hooks.UserPromptSubmit  = [group];
    existing.hooks.PreToolUse        = [group];
    existing.hooks.PostToolUse       = [group];
    existing.hooks.Stop              = [group];

    fs.writeFileSync(hooksConfigPath, JSON.stringify(existing, null, 2));

    // Enable the codex_hooks feature flag in config.toml
    this.enableCodexHooksFlag(codexDir);

    return { success: true, path: hooksConfigPath };
  }

  /** Ensures `[features]\ncodex_hooks = true` is present in ~/.codex/config.toml. */
  private enableCodexHooksFlag(codexDir: string) {
    const tomlPath = path.join(codexDir, 'config.toml');
    let content = '';
    if (fs.existsSync(tomlPath)) {
      content = fs.readFileSync(tomlPath, 'utf8');
    }

    // Already enabled — nothing to do
    if (content.includes('codex_hooks')) return;

    // Append (or create) the [features] block
    const addition = content.length > 0 && !content.endsWith('\n')
      ? '\n\n[features]\ncodex_hooks = true\n'
      : '\n[features]\ncodex_hooks = true\n';

    fs.writeFileSync(tomlPath, content + addition);
  }

  private writeKiroHook(projectPath?: string) {
    // Kiro hooks are stored as individual *.kiro.hook files in .kiro/hooks/.
    // Each file is a JSON object with a "hooks" key containing event arrays.
    // We write a single agent-pulse.kiro.hook at the project or home level.
    const kiroDir = projectPath
      ? path.join(projectPath, '.kiro', 'hooks')
      : path.join(os.homedir(), '.kiro', 'hooks');
    const hooksScriptDir = path.join(path.dirname(kiroDir), 'hooks-scripts');

    if (!fs.existsSync(kiroDir)) {
      fs.mkdirSync(kiroDir, { recursive: true });
    }
    if (!fs.existsSync(hooksScriptDir)) {
      fs.mkdirSync(hooksScriptDir, { recursive: true });
    }

    // Write hook scripts
    const shScript  = this.buildShellScript();
    const ps1Script = this.buildPowerShellScript();
    const shPath    = path.join(hooksScriptDir, 'agent-pulse.sh');
    const ps1Path   = path.join(hooksScriptDir, 'agent-pulse.ps1');

    fs.writeFileSync(shPath, shScript, { mode: 0o755 });
    fs.writeFileSync(ps1Path, ps1Script);

    const isWindows = process.platform === 'win32';
    const hookCommand = isWindows
      ? `powershell -ExecutionPolicy Bypass -File "${ps1Path.replace(/\\/g, '/')}"`
      : `"${shPath}"`;

    // Write agent-pulse.kiro.hook
    const hookFilePath = path.join(kiroDir, 'agent-pulse.kiro.hook');
    const hookConfig = {
      hooks: {
        agentSpawn:       [{ command: hookCommand }],
        userPromptSubmit: [{ command: hookCommand }],
        preToolUse:       [{ command: hookCommand }],
        postToolUse:      [{ command: hookCommand }],
      },
    };

    fs.writeFileSync(hookFilePath, JSON.stringify(hookConfig, null, 2));
    return { success: true, path: hookFilePath };
  }

  private writeClaudeCodeHook() {
    const claudeDir = path.join(os.homedir(), '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    const settingsPath = path.join(claudeDir, 'settings.json');

    // Read existing settings so we don't clobber them
    let settings: any = {};
    if (fs.existsSync(settingsPath)) {
      try {
        settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      } catch {
        // Unreadable — start fresh
      }
    }

    // Use the native http hook type — Claude Code POSTs the event JSON directly
    // to the URL with no shell involved (no curl, no quoting, cross-platform safe).
    const httpHook = { type: 'http', url: this.bridgeUrl, timeout: 5 };

    settings.hooks = {
      ...(settings.hooks || {}),
      PreToolUse:  [{ matcher: '*', hooks: [httpHook] }],
      Stop:        [{ hooks: [httpHook] }],
      StopFailure: [{ hooks: [httpHook] }],
    };

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return { success: true, path: settingsPath };
  }

  public uninstallHook(toolId: ToolId, projectPath?: string) {
    if (toolId === 'claude-code') {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      if (!fs.existsSync(settingsPath)) return { success: true };
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        delete settings.hooks?.PreToolUse;
        delete settings.hooks?.Stop;
        delete settings.hooks?.StopFailure;
        if (settings.hooks && Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      } catch {
        // ignore
      }
      return { success: true };
    }

    if (toolId === 'cursor') {
      const cursorDir = projectPath
        ? path.join(projectPath, '.cursor')
        : path.join(os.homedir(), '.cursor');
      const hooksConfigPath = path.join(cursorDir, 'hooks.json');
      if (fs.existsSync(hooksConfigPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8'));
          for (const event of ['preToolUse', 'postToolUse', 'postToolUseFailure', 'sessionStart', 'sessionEnd', 'stop']) {
            delete config.hooks?.[event];
          }
          if (config.hooks && Object.keys(config.hooks).length === 0) delete config.hooks;
          fs.writeFileSync(hooksConfigPath, JSON.stringify(config, null, 2));
        } catch { /* ignore */ }
      }
      // Remove hook scripts
      const shPath  = path.join(cursorDir, 'hooks', 'agent-pulse.sh');
      const ps1Path = path.join(cursorDir, 'hooks', 'agent-pulse.ps1');
      if (fs.existsSync(shPath))  fs.unlinkSync(shPath);
      if (fs.existsSync(ps1Path)) fs.unlinkSync(ps1Path);
      return { success: true };
    }

    if (toolId === 'vscode-copilot') {
      const hooksDir = projectPath
        ? path.join(projectPath, '.github', 'hooks')
        : path.join(os.homedir(), '.copilot', 'hooks');
      const hooksConfigPath = path.join(hooksDir, 'agent-pulse-hooks.json');
      if (fs.existsSync(hooksConfigPath)) fs.unlinkSync(hooksConfigPath);
      const shPath  = path.join(hooksDir, 'agent-pulse.sh');
      const ps1Path = path.join(hooksDir, 'agent-pulse.ps1');
      if (fs.existsSync(shPath))  fs.unlinkSync(shPath);
      if (fs.existsSync(ps1Path)) fs.unlinkSync(ps1Path);
      return { success: true };
    }

    if (toolId === 'openai-codex') {
      const codexDir = projectPath
        ? path.join(projectPath, '.codex')
        : path.join(os.homedir(), '.codex');
      const hooksConfigPath = path.join(codexDir, 'hooks.json');
      if (fs.existsSync(hooksConfigPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8'));
          for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) {
            delete config.hooks?.[event];
          }
          if (config.hooks && Object.keys(config.hooks).length === 0) delete config.hooks;
          fs.writeFileSync(hooksConfigPath, JSON.stringify(config, null, 2));
        } catch { /* ignore */ }
      }
      const shPath = path.join(codexDir, 'hooks', 'agent-pulse.sh');
      if (fs.existsSync(shPath)) fs.unlinkSync(shPath);
      return { success: true };
    }

    if (toolId === 'kiro') {
      const kiroDir = projectPath
        ? path.join(projectPath, '.kiro', 'hooks')
        : path.join(os.homedir(), '.kiro', 'hooks');
      const hookFilePath = path.join(kiroDir, 'agent-pulse.kiro.hook');
      if (fs.existsSync(hookFilePath)) fs.unlinkSync(hookFilePath);

      const hooksScriptDir = path.join(path.dirname(kiroDir), 'hooks-scripts');
      const shPath  = path.join(hooksScriptDir, 'agent-pulse.sh');
      const ps1Path = path.join(hooksScriptDir, 'agent-pulse.ps1');
      if (fs.existsSync(shPath))  fs.unlinkSync(shPath);
      if (fs.existsSync(ps1Path)) fs.unlinkSync(ps1Path);
      return { success: true };
    }

    return { success: true };
  }
}

import fs from 'fs';
import path from 'path';
import os from 'os';
import { BRIDGE_URL } from '../bridge/config';
import { ToolId } from '../../common/types';

export class ConfigWriter {
  private bridgeUrl = BRIDGE_URL;

  public isHookInstalled(toolId: ToolId, projectPath?: string): boolean {
    switch (toolId) {
      case 'claude-code':
        return this.isClaudeCodeHookInstalled();
      case 'cursor':
        return this.isCursorHookInstalled(projectPath);
      case 'vscode-copilot':
        return this.isCopilotHookInstalled(projectPath);
      case 'openai-codex':
        return this.isCodexHookInstalled(projectPath);
      case 'kiro':
        return this.isKiroHookInstalled(projectPath);
      case 'gemini-cli':
        return this.isGeminiCliHookInstalled(projectPath);
      default:
        return false;
    }
  }

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
      case 'gemini-cli':
        return this.writeGeminiCliHook(projectPath);
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

  private readJson(filePath: string): any | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return null;
    }
  }

  private hasAllFiles(paths: string[]): boolean {
    return paths.every((filePath) => fs.existsSync(filePath));
  }

  private hasAgentPulseCommand(entry: any): boolean {
    const command = `${entry?.command ?? ''} ${entry?.windows ?? ''}`;
    return command.includes('agent-pulse');
  }

  private hookArrayHasAgentPulseCommand(entries: any): boolean {
    if (!Array.isArray(entries)) return false;
    return entries.some((entry) =>
      this.hasAgentPulseCommand(entry) ||
      (Array.isArray(entry?.hooks) && entry.hooks.some((hook: any) => this.hasAgentPulseCommand(hook))),
    );
  }

  private hookArrayHasAgentPulseHttp(entries: any): boolean {
    if (!Array.isArray(entries)) return false;
    return entries.some((entry) =>
      Array.isArray(entry?.hooks) &&
      entry.hooks.some((hook: any) => hook?.type === 'http' && hook?.url === this.bridgeUrl),
    );
  }

  private hookArrayHasNamedAgentPulse(entries: any): boolean {
    if (!Array.isArray(entries)) return false;
    return entries.some((entry) =>
      Array.isArray(entry?.hooks) &&
      entry.hooks.some((hook: any) => hook?.name === 'agent-pulse' && this.hasAgentPulseCommand(hook)),
    );
  }

  private isClaudeCodeHookInstalled(): boolean {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const settings = this.readJson(settingsPath);
    if (!settings?.hooks) return false;

    return ['PreToolUse', 'Stop', 'StopFailure'].every((event) =>
      this.hookArrayHasAgentPulseHttp(settings.hooks[event]),
    );
  }

  private isCursorHookInstalled(projectPath?: string): boolean {
    const cursorDir = projectPath
      ? path.join(projectPath, '.cursor')
      : path.join(os.homedir(), '.cursor');
    const hooksConfigPath = path.join(cursorDir, 'hooks.json');
    const config = this.readJson(hooksConfigPath);
    if (!config?.hooks) return false;

    const scriptsExist = this.hasAllFiles([
      path.join(cursorDir, 'hooks', 'agent-pulse.sh'),
      path.join(cursorDir, 'hooks', 'agent-pulse.ps1'),
    ]);
    if (!scriptsExist) return false;

    return ['preToolUse', 'postToolUse', 'postToolUseFailure', 'sessionStart', 'sessionEnd', 'stop'].every((event) =>
      this.hookArrayHasAgentPulseCommand(config.hooks[event]),
    );
  }

  private isCopilotHookInstalled(projectPath?: string): boolean {
    const hooksDir = projectPath
      ? path.join(projectPath, '.github', 'hooks')
      : path.join(os.homedir(), '.copilot', 'hooks');
    const hookFile = path.join(hooksDir, 'agent-pulse-hooks.json');
    const config = this.readJson(hookFile);
    if (!config?.hooks) return false;

    const scriptsExist = this.hasAllFiles([
      path.join(hooksDir, 'agent-pulse.sh'),
      path.join(hooksDir, 'agent-pulse.ps1'),
    ]);
    if (!scriptsExist) return false;

    return [
      'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
      'PreCompact', 'SubagentStart', 'SubagentStop', 'Stop',
    ].every((event) => this.hookArrayHasAgentPulseCommand(config.hooks[event]));
  }

  private isCodexHookInstalled(projectPath?: string): boolean {
    const codexDir = projectPath
      ? path.join(projectPath, '.codex')
      : path.join(os.homedir(), '.codex');
    const hooksConfigPath = path.join(codexDir, 'hooks.json');
    const config = this.readJson(hooksConfigPath);
    if (!config?.hooks) return false;

    const scriptsExist = this.hasAllFiles([
      path.join(codexDir, 'hooks', 'agent-pulse.sh'),
      path.join(codexDir, 'hooks', 'agent-pulse.ps1'),
    ]);
    if (!scriptsExist) return false;

    const tomlPath = path.join(codexDir, 'config.toml');
    const hooksFlagEnabled = fs.existsSync(tomlPath) && fs.readFileSync(tomlPath, 'utf8').includes('codex_hooks = true');
    if (!hooksFlagEnabled) return false;

    return ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest'].every((event) =>
      this.hookArrayHasAgentPulseCommand(config.hooks[event]),
    );
  }

  private isKiroHookInstalled(projectPath?: string): boolean {
    const kiroDir = projectPath
      ? path.join(projectPath, '.kiro', 'hooks')
      : path.join(os.homedir(), '.kiro', 'hooks');
    const hookFilePath = path.join(kiroDir, 'agent-pulse.kiro.hook');
    const config = this.readJson(hookFilePath);
    if (!config?.hooks) return false;

    const scriptsDir = path.join(path.dirname(kiroDir), 'hooks-scripts');
    const scriptsExist = this.hasAllFiles([
      path.join(scriptsDir, 'agent-pulse.sh'),
      path.join(scriptsDir, 'agent-pulse.ps1'),
    ]);
    if (!scriptsExist) return false;

    return ['agentSpawn', 'userPromptSubmit', 'preToolUse', 'postToolUse'].every((event) =>
      this.hookArrayHasAgentPulseCommand(config.hooks[event]),
    );
  }

  private isGeminiCliHookInstalled(projectPath?: string): boolean {
    const geminiDir = projectPath
      ? path.join(projectPath, '.gemini')
      : path.join(os.homedir(), '.gemini');
    const settingsPath = path.join(geminiDir, 'settings.json');
    const settings = this.readJson(settingsPath);
    if (!settings?.hooks) return false;

    const scriptsExist = this.hasAllFiles([
      path.join(geminiDir, 'hooks', 'agent-pulse.sh'),
      path.join(geminiDir, 'hooks', 'agent-pulse.ps1'),
    ]);
    if (!scriptsExist) return false;

    return ['SessionStart', 'SessionEnd', 'BeforeAgent', 'AfterAgent', 'BeforeTool', 'AfterTool', 'Notification'].every((event) =>
      this.hookArrayHasNamedAgentPulse(settings.hooks[event]),
    );
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

    // Write hook scripts. Both scripts inject `_ap_tool: "openai-codex"` so the
    // bridge can identify Codex payloads even for events like SessionStart that
    // don't carry a `turn_id`.
    const shPath  = path.join(hooksScriptDir, 'agent-pulse.sh');
    const ps1Path = path.join(hooksScriptDir, 'agent-pulse.ps1');
    fs.writeFileSync(shPath, this.buildCodexShellScript(), { mode: 0o755 });
    fs.writeFileSync(ps1Path, this.buildCodexPowerShellScript());

    // On Windows, Codex spawns hooks via `cmd.exe /C <command>`, which can't
    // execute a bare `.sh` file — it opens the "Open with…" dialog. Point at
    // the PowerShell wrapper instead.
    const isWindows = process.platform === 'win32';
    const hookCommand = isWindows
      ? `powershell -ExecutionPolicy Bypass -File "${ps1Path}"`
      : shPath;

    // Write hooks.json — Codex uses the same nested matcher-group structure as Claude Code
    const hooksConfigPath = path.join(codexDir, 'hooks.json');
    let existing: any = { hooks: {} };
    if (fs.existsSync(hooksConfigPath)) {
      try { existing = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8')); } catch { /* start fresh */ }
    }
    existing.hooks = existing.hooks ?? {};

    const group = { matcher: '*', hooks: [{ type: 'command', command: hookCommand, timeout: 10 }] };
    existing.hooks.SessionStart      = [group];
    existing.hooks.UserPromptSubmit  = [group];
    existing.hooks.PreToolUse        = [group];
    existing.hooks.PostToolUse       = [group];
    existing.hooks.Stop              = [group];
    existing.hooks.PermissionRequest = [group];

    fs.writeFileSync(hooksConfigPath, JSON.stringify(existing, null, 2));

    // Enable the codex_hooks feature flag in config.toml
    this.enableCodexHooksFlag(codexDir);

    return { success: true, path: hooksConfigPath };
  }

  /** Bash script for Codex: injects tool identifier before forwarding to bridge. */
  private buildCodexShellScript(): string {
    return `#!/usr/bin/env bash
# Agent Pulse — Codex hook script (bash)
# Reads event JSON from stdin, injects a tool identifier, and forwards to bridge.
BODY=$(cat)
BODY=$(echo "$BODY" | sed 's/^{/{"_ap_tool":"openai-codex",/')
curl -s -o /dev/null -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.bridgeUrl}" || true
exit 0
`;
  }

  /** PowerShell script for Codex: injects tool identifier before forwarding to bridge. */
  private buildCodexPowerShellScript(): string {
    return `# Agent Pulse — Codex hook script (PowerShell)
# Reads event JSON from stdin, injects a tool identifier, and forwards to bridge.
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
$body = $reader.ReadToEnd()
$reader.Close()
$body = $body -replace '^\\{', '{"_ap_tool":"openai-codex",'
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

  private writeGeminiCliHook(projectPath?: string) {
    const geminiDir = projectPath
      ? path.join(projectPath, '.gemini')
      : path.join(os.homedir(), '.gemini');
    const hooksScriptDir = path.join(geminiDir, 'hooks');

    if (!fs.existsSync(hooksScriptDir)) {
      fs.mkdirSync(hooksScriptDir, { recursive: true });
    }

    // Write hook scripts — these inject "source":"gemini-cli" into the JSON
    // so the bridge can reliably identify Gemini CLI payloads.
    const shPath  = path.join(hooksScriptDir, 'agent-pulse.sh');
    const ps1Path = path.join(hooksScriptDir, 'agent-pulse.ps1');

    fs.writeFileSync(shPath, this.buildGeminiShellScript(), { mode: 0o755 });
    fs.writeFileSync(ps1Path, this.buildGeminiPowerShellScript());

    const isWindows = process.platform === 'win32';
    const hookCommand = isWindows
      ? `powershell -ExecutionPolicy Bypass -File "${ps1Path.replace(/\\/g, '/')}"`
      : `"${shPath}"`;

    // Write settings.json — Gemini CLI uses event-keyed arrays of matcher groups
    const settingsPath = path.join(geminiDir, 'settings.json');
    let settings: any = {};
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* start fresh */ }
    }
    settings.hooks = settings.hooks ?? {};

    const hookEntry = { name: 'agent-pulse', type: 'command', command: hookCommand, timeout: 5000 };
    const group = { matcher: '*', hooks: [hookEntry] };
    const events = ['SessionStart', 'SessionEnd', 'BeforeAgent', 'AfterAgent', 'BeforeTool', 'AfterTool', 'Notification'];

    for (const event of events) {
      const arr: any[] = settings.hooks[event] ?? [];
      // Remove any existing agent-pulse entries for idempotency
      const filtered = arr.filter((g: any) =>
        !g.hooks?.some((h: any) => h.name === 'agent-pulse')
      );
      filtered.push(group);
      settings.hooks[event] = filtered;
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return { success: true, path: settingsPath };
  }

  /** Bash script for Gemini CLI: injects tool identifier before forwarding to bridge. */
  private buildGeminiShellScript(): string {
    return `#!/usr/bin/env bash
# Agent Pulse — Gemini CLI hook script (bash)
# Reads event JSON from stdin, injects a tool identifier, and forwards to bridge.
BODY=$(cat)
BODY=$(echo "$BODY" | sed 's/^{/{"_ap_tool":"gemini-cli",/')
curl -s -o /dev/null -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.bridgeUrl}" || true
echo '{}'
exit 0
`;
  }

  /** PowerShell script for Gemini CLI: injects tool identifier before forwarding to bridge. */
  private buildGeminiPowerShellScript(): string {
    return `# Agent Pulse — Gemini CLI hook script (PowerShell)
# Reads event JSON from stdin, injects a tool identifier, and forwards to bridge.
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
$body = $reader.ReadToEnd()
$reader.Close()
$body = $body -replace '^\\{', '{"_ap_tool":"gemini-cli",'
try {
  Invoke-WebRequest -Uri "${this.bridgeUrl}" \`
    -Method POST \`
    -ContentType "application/json" \`
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) \`
    -UseBasicParsing | Out-Null
} catch { }
Write-Output '{}'
exit 0
`;
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
      PreToolUse:        [{ matcher: '*', hooks: [httpHook] }],
      Stop:              [{ hooks: [httpHook] }],
      StopFailure:       [{ hooks: [httpHook] }],
      PermissionRequest: [{ hooks: [httpHook] }],
      Elicitation:       [{ hooks: [httpHook] }],
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
        delete settings.hooks?.PermissionRequest;
        delete settings.hooks?.Elicitation;
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
          for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'PermissionRequest']) {
            delete config.hooks?.[event];
          }
          if (config.hooks && Object.keys(config.hooks).length === 0) delete config.hooks;
          fs.writeFileSync(hooksConfigPath, JSON.stringify(config, null, 2));
        } catch { /* ignore */ }
      }
      const shPath  = path.join(codexDir, 'hooks', 'agent-pulse.sh');
      const ps1Path = path.join(codexDir, 'hooks', 'agent-pulse.ps1');
      if (fs.existsSync(shPath))  fs.unlinkSync(shPath);
      if (fs.existsSync(ps1Path)) fs.unlinkSync(ps1Path);
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

    if (toolId === 'gemini-cli') {
      const geminiDir = projectPath
        ? path.join(projectPath, '.gemini')
        : path.join(os.homedir(), '.gemini');
      const settingsPath = path.join(geminiDir, 'settings.json');
      if (fs.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          const events = ['SessionStart', 'SessionEnd', 'BeforeAgent', 'AfterAgent', 'BeforeTool', 'AfterTool', 'Notification'];
          for (const event of events) {
            if (settings.hooks?.[event]) {
              settings.hooks[event] = settings.hooks[event].filter((g: any) =>
                !g.hooks?.some((h: any) => h.name === 'agent-pulse')
              );
              if (settings.hooks[event].length === 0) delete settings.hooks[event];
            }
          }
          if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
        } catch { /* ignore */ }
      }
      // Remove hook scripts
      const shPath  = path.join(geminiDir, 'hooks', 'agent-pulse.sh');
      const ps1Path = path.join(geminiDir, 'hooks', 'agent-pulse.ps1');
      if (fs.existsSync(shPath))  fs.unlinkSync(shPath);
      if (fs.existsSync(ps1Path)) fs.unlinkSync(ps1Path);
      return { success: true };
    }

    return { success: true };
  }
}

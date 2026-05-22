import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
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
      case 'antigravity-cli':
        return this.isAntigravityCliHookInstalled(projectPath);
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
      case 'antigravity-cli':
        return this.writeAntigravityCliHook(projectPath);
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
    // Lowercase + match either the long-name "agent-pulse" or its 8.3 short
    // form "agent-~". The Antigravity installer rewrites the script path to
    // 8.3 on Windows to dodge cmd.exe quoting issues with spaces in usernames,
    // and that rewrite mangles "agent-pulse" → "AGENT-~1".
    const command = `${entry?.command ?? ''} ${entry?.windows ?? ''}`.toLowerCase();
    return command.includes('agent-pulse') || command.includes('agent-~');
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

  private isAntigravityCliHookInstalled(projectPath?: string): boolean {
    // Antigravity reads hooks from a dedicated hooks.json. Per docs, the global
    // location is ~/.gemini/config/hooks.json and workspace is .agents/hooks.json.
    // (Despite being CLI-related, hooks.json sits in `config/` — not under
    // `antigravity-cli/`, which is reserved for runtime state like conversations.)
    const { hooksJsonPath, scriptDir } = this.antigravityCliPaths(projectPath);
    const config = this.readJson(hooksJsonPath);
    const group = config?.['agent-pulse'];
    if (!group) return false;

    const scriptsExist = this.hasAllFiles([
      path.join(scriptDir, 'agent-pulse.sh'),
      path.join(scriptDir, 'agent-pulse.ps1'),
    ]);
    if (!scriptsExist) return false;

    // PreToolUse / PostToolUse use the matcher-wrapped shape:
    //   [{ matcher: '*', hooks: [{ type, command, ... }] }]
    const matcherOk = ['PreToolUse', 'PostToolUse'].every((event) =>
      this.hookArrayHasAgentPulseCommand(group[event]),
    );
    // PreInvocation / PostInvocation / Stop have no matcher target — handler
    // objects sit directly in the array: [{ type, command, ... }]
    const flatOk = ['PreInvocation', 'PostInvocation', 'Stop'].every((event) =>
      Array.isArray(group[event]) && group[event].some((h: any) => this.hasAgentPulseCommand(h)),
    );

    return matcherOk && flatOk;
  }

  /**
   * Resolves a Windows path to its 8.3 short-name form (e.g. `C:\Users\Long
   * Name\file.ps1` → `C:\Users\LONGNA~1\file.ps1`). Used to dodge cmd.exe's
   * quote-mangling when a hook command's path contains spaces. The file must
   * already exist on disk (the Win32 API needs to query the filesystem).
   * Falls back to the original path if resolution fails or 8.3 generation
   * is disabled on the volume.
   */
  private toWindowsShortPath(longPath: string): string {
    if (process.platform !== 'win32') return longPath;
    try {
      const out = execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command',
          `(New-Object -ComObject Scripting.FileSystemObject).GetFile('${longPath.replace(/'/g, "''")}').ShortPath`],
        { encoding: 'utf8', windowsHide: true },
      ).trim();
      // If the volume has 8.3 disabled, ShortPath returns the long path unchanged
      // — in that case there's nothing better we can do; the install will likely
      // still fail at runtime, but at least we haven't made it worse.
      return out && !out.includes(' ') ? out : longPath;
    } catch {
      return longPath;
    }
  }

  private antigravityCliPaths(projectPath?: string) {
    // Workspace install puts everything under .agents/. Global install splits
    // hooks.json (under ~/.gemini/config/) from our scripts (in a sibling
    // agent-pulse/ folder so we don't pollute config/) for cleanliness.
    if (projectPath) {
      const agentsDir = path.join(projectPath, '.agents');
      return {
        hooksJsonPath: path.join(agentsDir, 'hooks.json'),
        scriptDir:     path.join(agentsDir, 'agent-pulse'),
      };
    }
    const configDir = path.join(os.homedir(), '.gemini', 'config');
    return {
      hooksJsonPath: path.join(configDir, 'hooks.json'),
      scriptDir:     path.join(configDir, 'agent-pulse'),
    };
  }

  /**
   * Bash script: reads stdin JSON, injects cwd + agent_pid so the timeline can
   * associate the event with a project + agent process, then forwards to the
   * bridge. Injection uses sed at the top-level object boundary (after the
   * opening `{`) so we don't have to parse JSON in bash.
   */
  private buildShellScript(): string {
    return `#!/usr/bin/env bash
# Agent Pulse — hook script (bash)
# Reads the event JSON from stdin, injects cwd + agent_pid for the timeline,
# and forwards to the bridge.
BODY=$(cat)
CWD_ESCAPED=$(printf '%s' "$PWD" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
INJECT='"cwd":"'"$CWD_ESCAPED"'","agent_pid":'"$PPID"','
BODY=$(printf '%s' "$BODY" | sed "s/^{/{$INJECT/")
curl -s -o /dev/null -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.bridgeUrl}" || true
exit 0
`;
  }

  /**
   * PowerShell counterpart of the bash script. Injects cwd + agent_pid the
   * same way (top-level object regex), uses ConvertTo-Json for proper string
   * escaping on the cwd, and forwards UTF-8 (no BOM) to the bridge.
   */
  private buildPowerShellScript(): string {
    return `# Agent Pulse — hook script (PowerShell)
# Reads the event JSON from stdin, injects cwd + agent_pid for the timeline,
# and forwards to the bridge using UTF-8 without BOM.
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
$body = $reader.ReadToEnd()
$reader.Close()
$cwdJson = ($PWD.Path | ConvertTo-Json -Compress)
$inject = '"cwd":' + $cwdJson + ',"agent_pid":' + $PID + ','
$body = $body -replace '^\\{', ('{' + $inject)
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

  /**
   * Bash script for Codex: injects tool identifier + cwd + agent_pid before
   * forwarding to bridge.
   */
  private buildCodexShellScript(): string {
    return `#!/usr/bin/env bash
# Agent Pulse — Codex hook script (bash)
# Reads event JSON from stdin, injects identifier + cwd + agent_pid, and forwards to bridge.
BODY=$(cat)
CWD_ESCAPED=$(printf '%s' "$PWD" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
INJECT='"_ap_tool":"openai-codex","cwd":"'"$CWD_ESCAPED"'","agent_pid":'"$PPID"','
BODY=$(printf '%s' "$BODY" | sed "s/^{/{$INJECT/")
curl -s -o /dev/null -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.bridgeUrl}" || true
exit 0
`;
  }

  /**
   * PowerShell script for Codex: injects identifier + cwd + agent_pid before
   * forwarding to bridge.
   */
  private buildCodexPowerShellScript(): string {
    return `# Agent Pulse — Codex hook script (PowerShell)
# Reads event JSON from stdin, injects identifier + cwd + agent_pid, and forwards to bridge.
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
$body = $reader.ReadToEnd()
$reader.Close()
$cwdJson = ($PWD.Path | ConvertTo-Json -Compress)
$inject = '"_ap_tool":"openai-codex","cwd":' + $cwdJson + ',"agent_pid":' + $PID + ','
$body = $body -replace '^\\{', ('{' + $inject)
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

  private writeAntigravityCliHook(projectPath?: string) {
    const { hooksJsonPath, scriptDir } = this.antigravityCliPaths(projectPath);

    if (!fs.existsSync(scriptDir)) {
      fs.mkdirSync(scriptDir, { recursive: true });
    }

    const shPath  = path.join(scriptDir, 'agent-pulse.sh');
    const ps1Path = path.join(scriptDir, 'agent-pulse.ps1');

    fs.writeFileSync(shPath, this.buildAntigravityShellScript(), { mode: 0o755 });
    fs.writeFileSync(ps1Path, this.buildAntigravityPowerShellScript());

    // The hook command needs to include the event name as an argument so the
    // script can tag the payload (Antigravity does not include the event name
    // in stdin, unlike Gemini's `hook_event_name`). PowerShell's -File form
    // accepts positional args after the script path.
    const isWindows = process.platform === 'win32';
    // Windows: Antigravity spawns hook commands through cmd.exe, whose quote-
    // stripping breaks a quoted path containing spaces (e.g. usernames like
    // "ZTI Tech Lead"). PowerShell then sees a truncated -File arg, exits
    // non-zero, and Antigravity reports "Agent execution terminated due to
    // error". The 8.3 short path has no spaces, so no quoting is needed.
    const ps1Arg = isWindows ? this.toWindowsShortPath(ps1Path) : shPath;
    const cmdFor = (event: string): string =>
      isWindows
        ? `powershell -ExecutionPolicy Bypass -File ${ps1Arg} ${event}`
        : `"${shPath}" ${event}`;
    // Timeout = 10s: PowerShell cold start on Windows can take 2-3s before the
    // script even reaches our HTTP POST. 5s left no margin.
    const handlerFor = (event: string) => ({ type: 'command', command: cmdFor(event), timeout: 10 });

    let config: any = {};
    if (fs.existsSync(hooksJsonPath)) {
      try { config = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8')); } catch { /* start fresh */ }
    }

    // Hook-group names sit at the top level of hooks.json (no `hooks` wrapper).
    // PreToolUse/PostToolUse use the matcher-wrapped shape; the other three
    // events are a flat list of handler objects (matcher N/A per docs).
    config['agent-pulse'] = {
      PreInvocation:  [handlerFor('PreInvocation')],
      PreToolUse:     [{ matcher: '*', hooks: [handlerFor('PreToolUse')] }],
      PostToolUse:    [{ matcher: '*', hooks: [handlerFor('PostToolUse')] }],
      PostInvocation: [handlerFor('PostInvocation')],
      Stop:           [handlerFor('Stop')],
    };

    if (!fs.existsSync(path.dirname(hooksJsonPath))) {
      fs.mkdirSync(path.dirname(hooksJsonPath), { recursive: true });
    }
    fs.writeFileSync(hooksJsonPath, JSON.stringify(config, null, 2));
    return { success: true, path: hooksJsonPath };
  }

  /**
   * Bash script for Antigravity CLI. argv[1] is the event name (passed by
   * hooks.json) since Antigravity does not include it in the stdin payload.
   * The script injects `_ap_tool` + `hook_event_name` into the JSON body and
   * forwards it to the bridge. PreToolUse must emit `{"decision":"allow"}`
   * (required field per docs); all other events emit `{}`.
   */
  private buildAntigravityShellScript(): string {
    // Single-quote-close / interpolate $EVENT / single-quote-reopen avoids
    // escaping every `"` inside the injected JSON fragment.
    // PreToolUse needs decision:allow per docs (required field, otherwise agy
    // may block). Stop's decision is also required — any value other than
    // "continue" allows the stop, so we emit "allow" to be explicit.
    return `#!/usr/bin/env bash
# Agent Pulse — Antigravity CLI hook script (bash)
EVENT="\${1:-}"
BODY=$(cat)
CWD_ESCAPED=$(printf '%s' "$PWD" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
INJECT='"_ap_tool":"antigravity-cli","hook_event_name":"'"$EVENT"'","cwd":"'"$CWD_ESCAPED"'","agent_pid":'"$PPID"','
BODY=$(printf '%s' "$BODY" | sed "s/^{/{$INJECT/")
curl -s --max-time 3 -o /dev/null -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.bridgeUrl}" 2>/dev/null || true
case "$EVENT" in
  PreToolUse|Stop) printf '{"decision":"allow"}' ;;
  *)               printf '{}' ;;
esac
exit 0
`;
  }

  /**
   * PowerShell counterpart of the bash script. Hardened against the usual
   * Windows pitfalls that pollute stdout (which would corrupt the JSON agy
   * parses):
   *   - $ProgressPreference silences Invoke-WebRequest's progress bar
   *   - $ErrorActionPreference + try/catch silence transient HTTP errors
   *   - [Console]::Out.Write avoids the trailing CRLF Write-Output adds
   *   - -TimeoutSec 3 caps the bridge round-trip well under agy's timeout
   */
  private buildAntigravityPowerShellScript(): string {
    return `# Agent Pulse — Antigravity CLI hook script (PowerShell)
param([string]$Event = '')
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
$body = $reader.ReadToEnd()
$reader.Close()
$cwdJson = ($PWD.Path | ConvertTo-Json -Compress)
$inject = '"_ap_tool":"antigravity-cli","hook_event_name":"' + $Event + '","cwd":' + $cwdJson + ',"agent_pid":' + $PID + ','
$body = $body -replace '^\\{', ('{' + $inject)
try {
  Invoke-WebRequest -Uri "${this.bridgeUrl}" \`
    -Method POST \`
    -ContentType "application/json" \`
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) \`
    -UseBasicParsing -TimeoutSec 3 | Out-Null
} catch { }

if ($Event -eq 'PreToolUse' -or $Event -eq 'Stop') {
  [Console]::Out.Write('{"decision":"allow"}')
} else {
  [Console]::Out.Write('{}')
}
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
      PermissionRequest: [{ matcher: '*', hooks: [httpHook] }],
      Elicitation:       [{ matcher: '*', hooks: [httpHook] }],
      Notification:      [{ matcher: '*', hooks: [httpHook] }],
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
        delete settings.hooks?.Notification;
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

    if (toolId === 'antigravity-cli') {
      const { hooksJsonPath, scriptDir } = this.antigravityCliPaths(projectPath);
      if (fs.existsSync(hooksJsonPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
          delete config['agent-pulse'];
          fs.writeFileSync(hooksJsonPath, JSON.stringify(config, null, 2));
        } catch { /* ignore */ }
      }
      const shPath  = path.join(scriptDir, 'agent-pulse.sh');
      const ps1Path = path.join(scriptDir, 'agent-pulse.ps1');
      if (fs.existsSync(shPath))  fs.unlinkSync(shPath);
      if (fs.existsSync(ps1Path)) fs.unlinkSync(ps1Path);
      return { success: true };
    }

    return { success: true };
  }
}

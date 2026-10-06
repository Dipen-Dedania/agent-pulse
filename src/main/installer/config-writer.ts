import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { BRIDGE_URL, STATUSLINE_INGEST_URL } from '../bridge/config';
import { readConnectionFile } from '../mcp/connection';
import { ToolId, StatusLineConfig, StatusLineRuntime, StatusLineState } from '../../common/types';
import { CodexStatusLineConfig, CodexStatusLineState } from '../../common/types';
import { formatStatusLineArray, parseStatusLineArray } from '../../common/codex-statusline';
import {
  CODEX_MANAGED_MARK,
  findKeyInTable,
  hasInlineTableConflict,
  removeKeyFromTable,
  splitLines,
  upsertKeyInTable,
} from './codex-toml';
import {
  OPENCODE_PLUGIN_FILENAME,
  opencodeConfigDir,
  opencodePluginDirs,
  opencodePluginPath,
} from './opencode-paths';
import {
  museHooksDir,
  museHookPs1Path,
  museHookShPath,
  museSettingsPath,
} from './muse-paths';

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
      case 'grok':
        return this.isGrokHookInstalled();
      case 'opencode':
        return this.isOpencodeHookInstalled();
      case 'muse-code':
        return this.isMuseCodeHookInstalled();
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
      case 'grok':
        return this.writeGrokHook();
      case 'opencode':
        return this.writeOpencodeHook();
      case 'muse-code':
        return this.writeMuseCodeHook();
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

  // Lenient ownership test used for REMOVAL: any localhost http hook posting
  // to /event is ours, whatever the port, so legacy installs written under a
  // different AGENT_PULSE_PORT are still cleaned up. Detection
  // (hookArrayHasAgentPulseHttp above) deliberately stays exact against
  // bridgeUrl — a hook pointing at a stale port must read as "not installed"
  // so install/upgrade rewrites it to the current URL.
  private static isAgentPulseHttpHook(h: any): boolean {
    if (h?.type !== 'http' || typeof h?.url !== 'string') return false;
    try {
      const u = new URL(h.url);
      return /^https?:$/.test(u.protocol) &&
        ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname.toLowerCase()) &&
        u.pathname === '/event';
    } catch {
      return false;
    }
  }

  // Strip our http hooks out of a Claude-Code-shaped entry array, preserving
  // foreign entries AND foreign hooks living inside a mixed entry (possible
  // after the old clobbering write, when users hand-edited our entry).
  private stripAgentPulseHttpEntries(entries: any): any[] {
    if (!Array.isArray(entries)) return [];
    return entries
      .map((e) => Array.isArray(e?.hooks)
        ? { ...e, hooks: e.hooks.filter((h: any) => !ConfigWriter.isAgentPulseHttpHook(h)) }
        : e)
      .filter((e) => !Array.isArray(e?.hooks) || e.hooks.length > 0);
  }

  private isClaudeCodeHookInstalled(): boolean {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const settings = this.readJson(settingsPath);
    if (!settings?.hooks) return false;

    return ['PreToolUse', 'Stop', 'StopFailure'].every((event) =>
      this.hookArrayHasAgentPulseHttp(settings.hooks[event]),
    );
  }

  // True when the Claude Code hook is ours (installed) but was written by an
  // older app version that registered fewer events. Foreign or absent hooks
  // are never considered upgradable — we only rewrite what we own.
  public claudeCodeHookNeedsUpgrade(): boolean {
    if (!this.isClaudeCodeHookInstalled()) return false;
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
    const settings = this.readJson(settingsPath);
    if (!settings?.hooks) return false;
    return ConfigWriter.allClaudeCodeHookEvents().some(
      (event) => !this.hookArrayHasAgentPulseHttp(settings.hooks[event]),
    );
  }

  public upgradeClaudeCodeHook(): { success: boolean } {
    const result = this.writeClaudeCodeHook();
    return { success: result.success };
  }

  // Grok home dir, honoring the documented GROK_HOME override (falls back to
  // ~/.grok). Grok hooks are installed globally so no project trust is needed.
  private grokHome(): string {
    return process.env['GROK_HOME'] || path.join(os.homedir(), '.grok');
  }

  private grokHookPath(): string {
    return path.join(this.grokHome(), 'hooks', 'agent-pulse.json');
  }

  private isGrokHookInstalled(): boolean {
    const config = this.readJson(this.grokHookPath());
    if (!config?.hooks) return false;

    // Grok uses COMMAND hooks (its SSRF protection blocks our http:// bridge),
    // so the scripts must also exist for the hook to actually fire.
    const hooksDir = path.join(this.grokHome(), 'hooks');
    const scriptsExist = this.hasAllFiles([
      path.join(hooksDir, 'agent-pulse.sh'),
      path.join(hooksDir, 'agent-pulse.ps1'),
    ]);
    if (!scriptsExist) return false;

    // Require the core lifecycle events so a half-written file doesn't read as
    // installed. Grok merges this global file with any project/compat hooks.
    return ['SessionStart', 'PreToolUse', 'Stop', 'StopFailure'].every((event) =>
      this.hookArrayHasAgentPulseCommand(config.hooks[event]),
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
    // Accept the current `hooks` key and the deprecated `codex_hooks` key
    const hooksFlagEnabled = fs.existsSync(tomlPath)
      && /^\s*(?:codex_)?hooks\s*=\s*true\b/m.test(fs.readFileSync(tomlPath, 'utf8'));
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
# Walk up the parent chain (up to 7 levels). Hook PIDs can be short-lived,
# so we ship the whole ancestor list and let the focus path try each.
CHAIN_PIDS="$PPID"
_CUR=$PPID
for _i in 1 2 3 4 5 6 7; do
  _PARENT=$(ps -o ppid= -p "$_CUR" 2>/dev/null | tr -d ' ')
  if [ -z "$_PARENT" ] || [ "$_PARENT" -le 1 ] 2>/dev/null; then break; fi
  CHAIN_PIDS="$CHAIN_PIDS,$_PARENT"
  _CUR=$_PARENT
done
INJECT='"cwd":"'"$CWD_ESCAPED"'","agent_pid":'"$PPID"',"agent_pid_chain":['"$CHAIN_PIDS"'],'
# Use '|' as the sed delimiter: cwd values almost always contain '/' on Unix,
# which would terminate the default s/.../.../ form early and drop the injection.
BODY=$(printf '%s' "$BODY" | sed "s|^{|{$INJECT|")
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
# Capture the full ancestor PID chain (up to 8 levels). The immediate parent
# is often a short-lived shim (cmd.exe /C, transient launcher) that exits
# the moment the hook returns; the rest of the chain holds the long-lived
# agent / terminal we can focus on later. We ship the whole list so the
# focus path can try each entry until one is still alive.
$chainPids = New-Object System.Collections.ArrayList
[void]$chainPids.Add($PID)
try {
  $cur = $PID
  for ($i = 0; $i -lt 7; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction Stop
    if (-not $p) { break }
    $next = [int]$p.ParentProcessId
    if ($next -le 0) { break }
    [void]$chainPids.Add($next)
    $cur = $next
  }
} catch { }
$chainJson = '[' + ($chainPids -join ',') + ']'
$agentPid = if ($chainPids.Count -ge 2) { $chainPids[1] } else { $PID }
$inject = '"cwd":' + $cwdJson + ',"agent_pid":' + $agentPid + ',"agent_pid_chain":' + $chainJson + ','
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

    // Enable the hooks feature flag in config.toml
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
# Reads event JSON from stdin, injects identifier + cwd + agent_pid, forwards to
# the bridge, and relays a guardrail deny verdict back to Codex via stdout.
# Fail-open: any bridge error/timeout leaves the command allowed.
BODY=$(cat)
CWD_ESCAPED=$(printf '%s' "$PWD" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
CHAIN_PIDS="$PPID"
_CUR=$PPID
for _i in 1 2 3 4 5 6 7; do
  _PARENT=$(ps -o ppid= -p "$_CUR" 2>/dev/null | tr -d ' ')
  if [ -z "$_PARENT" ] || [ "$_PARENT" -le 1 ] 2>/dev/null; then break; fi
  CHAIN_PIDS="$CHAIN_PIDS,$_PARENT"
  _CUR=$_PARENT
done
INJECT='"_ap_tool":"openai-codex","cwd":"'"$CWD_ESCAPED"'","agent_pid":'"$PPID"',"agent_pid_chain":['"$CHAIN_PIDS"'],'
# '|' delimiter: see buildShellScript for the / vs | rationale.
BODY=$(printf '%s' "$BODY" | sed "s|^{|{$INJECT|")
RESP=$(curl -s --max-time 3 -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.bridgeUrl}" 2>/dev/null || true)
# Relay a deny verdict to Codex. The bridge's block body carries
# hookSpecificOutput.permissionDecision:"deny" (Codex's documented PreToolUse
# deny shape). Only act on an explicit block marker so a down/slow bridge
# fails open and the command is allowed.
case "$RESP" in
  *'"status":"blocked"'*) printf '%s' "$RESP" ;;
esac
exit 0
`;
  }

  /**
   * PowerShell script for Codex: injects identifier + cwd + agent_pid before
   * forwarding to bridge.
   */
  private buildCodexPowerShellScript(): string {
    return `# Agent Pulse — Codex hook script (PowerShell)
# Reads event JSON from stdin, injects identifier + cwd + agent_pid, forwards to
# the bridge, and relays a guardrail deny verdict back to Codex via stdout.
# Fail-open: any bridge error/timeout leaves the command allowed.
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
$body = $reader.ReadToEnd()
$reader.Close()
$cwdJson = ($PWD.Path | ConvertTo-Json -Compress)
# Capture the ancestor PID chain — see buildPowerShellScript for rationale.
$chainPids = New-Object System.Collections.ArrayList
[void]$chainPids.Add($PID)
try {
  $cur = $PID
  for ($i = 0; $i -lt 7; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction Stop
    if (-not $p) { break }
    $next = [int]$p.ParentProcessId
    if ($next -le 0) { break }
    [void]$chainPids.Add($next)
    $cur = $next
  }
} catch { }
$chainJson = '[' + ($chainPids -join ',') + ']'
$agentPid = if ($chainPids.Count -ge 2) { $chainPids[1] } else { $PID }
$inject = '"_ap_tool":"openai-codex","cwd":' + $cwdJson + ',"agent_pid":' + $agentPid + ',"agent_pid_chain":' + $chainJson + ','
$body = $body -replace '^\\{', ('{' + $inject)
try {
  $resp = Invoke-WebRequest -Uri "${this.bridgeUrl}" \`
    -Method POST \`
    -ContentType "application/json" \`
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) \`
    -UseBasicParsing -TimeoutSec 3
  # Relay a deny verdict to Codex (stdout JSON with permissionDecision:"deny").
  # Only act on an explicit block marker so a down/slow bridge fails open.
  if ($resp.Content -like '*"status":"blocked"*') {
    [Console]::Out.Write($resp.Content)
  }
} catch { }
exit 0
`;
  }

  /**
   * Ensures `[features]\nhooks = true` is present in ~/.codex/config.toml.
   * Codex deprecated `[features].codex_hooks` in favor of `[features].hooks`;
   * a lingering `codex_hooks` key triggers a deprecation warning, so existing
   * configs are migrated to the new key in place.
   */
  private enableCodexHooksFlag(codexDir: string) {
    const tomlPath = path.join(codexDir, 'config.toml');
    let content = '';
    if (fs.existsSync(tomlPath)) {
      content = fs.readFileSync(tomlPath, 'utf8');
    }

    const original = content;

    // Migrate the deprecated key name, then flip a disabled flag to enabled
    content = content.replace(/^(\s*)codex_hooks(\s*=)/m, '$1hooks$2');
    content = content.replace(/^(\s*hooks\s*=\s*)false\b/m, '$1true');

    if (!/^\s*hooks\s*=\s*true\b/m.test(content)) {
      if (/^\[features\]\s*$/m.test(content)) {
        // [features] section exists without the flag — insert under the header
        // (appending a second [features] table would be invalid TOML)
        content = content.replace(/^\[features\]\s*$/m, '[features]\nhooks = true');
      } else {
        content += content.length > 0 && !content.endsWith('\n')
          ? '\n\n[features]\nhooks = true\n'
          : '\n[features]\nhooks = true\n';
      }
    }

    if (content !== original) {
      fs.writeFileSync(tomlPath, content);
    }
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
CHAIN_PIDS="$PPID"
_CUR=$PPID
for _i in 1 2 3 4 5 6 7; do
  _PARENT=$(ps -o ppid= -p "$_CUR" 2>/dev/null | tr -d ' ')
  if [ -z "$_PARENT" ] || [ "$_PARENT" -le 1 ] 2>/dev/null; then break; fi
  CHAIN_PIDS="$CHAIN_PIDS,$_PARENT"
  _CUR=$_PARENT
done
INJECT='"_ap_tool":"antigravity-cli","hook_event_name":"'"$EVENT"'","cwd":"'"$CWD_ESCAPED"'","agent_pid":'"$PPID"',"agent_pid_chain":['"$CHAIN_PIDS"'],'
# '|' delimiter: see buildShellScript for the / vs | rationale.
BODY=$(printf '%s' "$BODY" | sed "s|^{|{$INJECT|")
RESP=$(curl -s --max-time 3 -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.bridgeUrl}" 2>/dev/null || true)
# A guardrail block returns {"decision":"deny",...}; relay it to Antigravity.
# Otherwise emit the required allow/empty decision. Fail-open: a down/slow
# bridge yields no block marker, so the command is allowed.
case "$RESP" in
  *'"status":"blocked"'*) printf '%s' "$RESP" ;;
  *)
    case "$EVENT" in
      PreToolUse|Stop) printf '{"decision":"allow"}' ;;
      *)               printf '{}' ;;
    esac
    ;;
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
# Capture the ancestor PID chain. Critical for Antigravity: it wraps the
# hook in cmd.exe /C, which exits immediately after the hook returns. We
# need higher ancestors in the chain to still focus the agent terminal at
# click time.
$chainPids = New-Object System.Collections.ArrayList
[void]$chainPids.Add($PID)
try {
  $cur = $PID
  for ($i = 0; $i -lt 7; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction Stop
    if (-not $p) { break }
    $next = [int]$p.ParentProcessId
    if ($next -le 0) { break }
    [void]$chainPids.Add($next)
    $cur = $next
  }
} catch { }
$chainJson = '[' + ($chainPids -join ',') + ']'
$agentPid = if ($chainPids.Count -ge 2) { $chainPids[1] } else { $PID }
$inject = '"_ap_tool":"antigravity-cli","hook_event_name":"' + $Event + '","cwd":' + $cwdJson + ',"agent_pid":' + $agentPid + ',"agent_pid_chain":' + $chainJson + ','
$body = $body -replace '^\\{', ('{' + $inject)
$verdict = $null
try {
  $resp = Invoke-WebRequest -Uri "${this.bridgeUrl}" \`
    -Method POST \`
    -ContentType "application/json" \`
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) \`
    -UseBasicParsing -TimeoutSec 3
  if ($resp.Content -like '*"status":"blocked"*') { $verdict = $resp.Content }
} catch { }

if ($verdict) {
  # Relay the guardrail deny ({"decision":"deny",...}) to Antigravity.
  [Console]::Out.Write($verdict)
} elseif ($Event -eq 'PreToolUse' -or $Event -eq 'Stop') {
  [Console]::Out.Write('{"decision":"allow"}')
} else {
  [Console]::Out.Write('{}')
}
exit 0
`;
  }

  // Canonical Claude Code hook event set. Single source of truth for write,
  // uninstall, and the staleness check (`claudeCodeHookNeedsUpgrade`).
  // `matcher` events are registered with `matcher: '*'`; `plain` events without.
  // PostToolUse and PreCompact are deliberately absent: PostToolUse would flap
  // working↔idle on every tool call (and inflate derived turn counts), and
  // PreCompact needs shrunk-transcript offset handling first.
  private static readonly CLAUDE_CODE_HOOK_EVENTS = {
    matcher: ['PreToolUse', 'PermissionRequest', 'Elicitation', 'Notification'],
    plain:   ['Stop', 'StopFailure', 'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'SubagentStart', 'SubagentStop'],
  } as const;

  private static allClaudeCodeHookEvents(): string[] {
    return [...ConfigWriter.CLAUDE_CODE_HOOK_EVENTS.matcher, ...ConfigWriter.CLAUDE_CODE_HOOK_EVENTS.plain];
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

    // Merge per event: strip any prior agent-pulse entry (including legacy
    // other-port ones), keep foreign entries, append ours as a separate entry.
    // Strip-then-append makes this idempotent, so the boot-time upgrade can
    // run every launch without duplicating entries or destroying user hooks.
    if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
      settings.hooks = {};
    }
    for (const event of ConfigWriter.CLAUDE_CODE_HOOK_EVENTS.matcher) {
      settings.hooks[event] = [...this.stripAgentPulseHttpEntries(settings.hooks[event]), { matcher: '*', hooks: [httpHook] }];
    }
    for (const event of ConfigWriter.CLAUDE_CODE_HOOK_EVENTS.plain) {
      settings.hooks[event] = [...this.stripAgentPulseHttpEntries(settings.hooks[event]), { hooks: [httpHook] }];
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return { success: true, path: settingsPath };
  }

  private writeGrokHook() {
    // Grok CANNOT use native HTTP hooks against our bridge: its hook runner has
    // SSRF protection that rejects `http://` URLs ("only https:// URLs are
    // allowed for HTTP hooks"), and the bridge only serves plain HTTP on
    // localhost. So we use a COMMAND hook instead — a bash/PowerShell script
    // that POSTs to the bridge via curl/Invoke-WebRequest. No `http://` URL is
    // ever handed to Grok, so SSRF protection never triggers. The script
    // injects `_ap_tool: "grok"`, the definitive marker the bridge keys on.
    //
    // We still write a DEDICATED global file (~/.grok/hooks/agent-pulse.json)
    // rather than merging into ~/.claude/settings.json: global Grok hooks are
    // always trusted, and uninstall then only removes our file/scripts —
    // never touching the user's other Grok plugins/hooks.
    const hooksDir = path.join(this.grokHome(), 'hooks');
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }

    // Write the hook scripts alongside the config (both inject _ap_tool:"grok").
    const shPath  = path.join(hooksDir, 'agent-pulse.sh');
    const ps1Path = path.join(hooksDir, 'agent-pulse.ps1');
    fs.writeFileSync(shPath, this.buildGrokShellScript(), { mode: 0o755 });
    fs.writeFileSync(ps1Path, this.buildGrokPowerShellScript());

    // On Windows a bare `.sh` can't be executed; point at the PowerShell wrapper.
    const isWindows = process.platform === 'win32';
    const command = isWindows
      ? `powershell -ExecutionPolicy Bypass -File "${ps1Path}"`
      : shPath;

    const cmdHook = { type: 'command', command, timeout: 10 };
    // Grok's matcher is a regex (docs), so use '.*' rather than Claude's '*'.
    const matched = [{ matcher: '.*', hooks: [cmdHook] }];
    const flat = [{ hooks: [cmdHook] }];
    const config = {
      hooks: {
        SessionStart:       flat,
        UserPromptSubmit:   flat,
        PreToolUse:         matched,
        PostToolUse:        matched,
        PostToolUseFailure: matched,
        Stop:               flat,
        StopFailure:        flat,
        SessionEnd:         flat,
        Notification:       matched,
      },
    };

    const hookPath = this.grokHookPath();
    fs.writeFileSync(hookPath, JSON.stringify(config, null, 2));
    return { success: true, path: hookPath };
  }

  /**
   * Bash script for Grok: injects `_ap_tool: "grok"` + cwd + agent_pid before
   * forwarding the stdin event JSON to the bridge. Fail-open on any error.
   */
  private buildGrokShellScript(): string {
    return `#!/usr/bin/env bash
# Agent Pulse — Grok hook script (bash)
# Reads event JSON from stdin, injects identifier + cwd + agent_pid, forwards to
# the bridge, and relays a guardrail deny verdict back to Grok via stdout.
# Grok's HTTP hooks are blocked by its SSRF protection (http:// not allowed), so
# we POST from a command hook instead. Fail-open: any bridge error leaves the
# command allowed.
BODY=$(cat)
CWD_ESCAPED=$(printf '%s' "$PWD" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
CHAIN_PIDS="$PPID"
_CUR=$PPID
for _i in 1 2 3 4 5 6 7; do
  _PARENT=$(ps -o ppid= -p "$_CUR" 2>/dev/null | tr -d ' ')
  if [ -z "$_PARENT" ] || [ "$_PARENT" -le 1 ] 2>/dev/null; then break; fi
  CHAIN_PIDS="$CHAIN_PIDS,$_PARENT"
  _CUR=$_PARENT
done
# Token analytics resolve the Grok session dir from sessionId. Grok's stdin
# envelope carries it, but as belt-and-suspenders we also inject session_id from
# the GROK_SESSION_ID env var (snake_case, so a stdin camelCase sessionId still
# wins in normalizePayload). Guarantees the timeline can find updates.jsonl.
SID_INJECT=""
if [ -n "$GROK_SESSION_ID" ]; then SID_INJECT='"session_id":"'"$GROK_SESSION_ID"'",'; fi
INJECT='"_ap_tool":"grok",'"$SID_INJECT"'"cwd":"'"$CWD_ESCAPED"'","agent_pid":'"$PPID"',"agent_pid_chain":['"$CHAIN_PIDS"'],'
BODY=$(printf '%s' "$BODY" | sed "s|^{|{$INJECT|")
RESP=$(curl -s --max-time 3 -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.bridgeUrl}" 2>/dev/null || true)
# Relay an explicit block verdict; a down/slow bridge fails open (command allowed).
case "$RESP" in
  *'"status":"blocked"'*) printf '%s' "$RESP" ;;
esac
exit 0
`;
  }

  /**
   * PowerShell script for Grok: injects `_ap_tool: "grok"` + cwd + agent_pid
   * before forwarding to the bridge. Fail-open on any error.
   */
  private buildGrokPowerShellScript(): string {
    return `# Agent Pulse — Grok hook script (PowerShell)
# Reads event JSON from stdin, injects identifier + cwd + agent_pid, forwards to
# the bridge, and relays a guardrail deny verdict back to Grok via stdout.
# Grok's HTTP hooks are blocked by its SSRF protection (http:// not allowed), so
# we POST from a command hook instead. Fail-open: any bridge error leaves the
# command allowed.
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
$body = $reader.ReadToEnd()
$reader.Close()
$cwdJson = ($PWD.Path | ConvertTo-Json -Compress)
$chainPids = New-Object System.Collections.ArrayList
[void]$chainPids.Add($PID)
try {
  $cur = $PID
  for ($i = 0; $i -lt 7; $i++) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId=$cur" -ErrorAction Stop
    if (-not $p) { break }
    $next = [int]$p.ParentProcessId
    if ($next -le 0) { break }
    [void]$chainPids.Add($next)
    $cur = $next
  }
} catch { }
$chainJson = '[' + ($chainPids -join ',') + ']'
$agentPid = if ($chainPids.Count -ge 2) { $chainPids[1] } else { $PID }
# Belt-and-suspenders sessionId (see the bash script) so token analytics can
# always resolve the Grok session dir. Snake_case so a stdin camelCase sessionId
# still wins in normalizePayload.
$sidInject = if ($env:GROK_SESSION_ID) { '"session_id":"' + $env:GROK_SESSION_ID + '",' } else { '' }
$inject = '"_ap_tool":"grok",' + $sidInject + '"cwd":' + $cwdJson + ',"agent_pid":' + $agentPid + ',"agent_pid_chain":' + $chainJson + ','
$body = $body -replace '^\\{', ('{' + $inject)
try {
  $resp = Invoke-WebRequest -Uri "${this.bridgeUrl}" \`
    -Method POST \`
    -ContentType "application/json" \`
    -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) \`
    -UseBasicParsing -TimeoutSec 3
  if ($resp.Content -like '*"status":"blocked"*') {
    [Console]::Out.Write($resp.Content)
  }
} catch { }
exit 0
`;
  }

  // ─── Muse Code ─────────────────────────────────────────────────────────────
  // Muse implements Claude Code's hook contract (same event names, same stdin
  // JSON, same hookSpecificOutput deny) but ONLY supports command hooks and
  // runs them with a cleared environment. We merge a `hooks` block into the
  // user settings file — hooks there are admitted without a trust prompt in
  // headless runs and with a one-time "Trust all and continue" prompt in the
  // TUI (verified on 1.4.1) — and point every event at a script pair that
  // POSTs the payload to the bridge.
  //
  // Windows quoting: Muse hands `command` to cmd.exe with embedded double
  // quotes backslash-escaped, so ANY quoted path breaks ('"C:\...\powershell.exe"'
  // is not recognized as an internal or external command). We therefore never
  // quote: the Windows form is `powershell.exe -EncodedCommand <base64>`, whose
  // decoded payload (`& '<ps1 path>'`) may contain spaces and quotes freely.
  // `commandWindows` is selected on Windows only and `command` (the .sh path)
  // everywhere else, so one settings entry works on every platform.
  //
  // settings.json rules (verified): a missing file is created with
  // `"schema_version": 1`; an existing file without schema_version gets it
  // added (Muse refuses to start without it); a UTF-8 BOM is equally fatal to
  // Muse, so one is stripped on read and never written; an unparsable file is
  // left untouched and the install fails loudly instead of clobbering it.

  private static readonly MUSE_HOOK_EVENTS = [
    'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest',
    'PostToolUse', 'PostToolUseFailure', 'Notification', 'Stop', 'SessionEnd',
  ];
  private static readonly MUSE_STATUS_MESSAGE = 'Agent Pulse';

  // The bridge listens on 127.0.0.1 only. A `localhost` URL makes .NET try
  // ::1 first and wait for the refusal — measured at ~2.0s per hook in a fresh
  // PowerShell process versus ~0.18s for the literal IPv4 address — and the
  // awaited PreToolUse hook sits on every tool call, so the Muse scripts use
  // the address form.
  private museBridgeUrl(): string {
    return this.bridgeUrl.replace('://localhost:', '://127.0.0.1:');
  }

  private readMuseSettings(): { settings: any; existed: boolean } {
    const settingsPath = museSettingsPath();
    if (!fs.existsSync(settingsPath)) return { settings: {}, existed: false };
    const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    if (raw.trim().length === 0) return { settings: {}, existed: true };
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`Muse settings file is not valid JSON — fix ${settingsPath} by hand, then reinstall the hook.`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Muse settings file must contain a JSON object: ${settingsPath}`);
    }
    return { settings: parsed, existed: true };
  }

  private isMuseAgentPulseHandler(hook: any): boolean {
    return this.hasAgentPulseCommand(hook) || hook?.statusMessage === ConfigWriter.MUSE_STATUS_MESSAGE;
  }

  // Drop our handlers from one Muse hook-event array, keeping every foreign
  // group and handler. A group that mixed ours with foreign handlers keeps the
  // foreign ones; a group left empty is dropped.
  private stripMuseAgentPulseEntries(entries: any): any[] {
    if (!Array.isArray(entries)) return [];
    const kept: any[] = [];
    for (const group of entries) {
      if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) {
        kept.push(group);
        continue;
      }
      const hooks = group.hooks.filter((h: any) => !this.isMuseAgentPulseHandler(h));
      if (hooks.length === 0) continue;
      kept.push(hooks.length === group.hooks.length ? group : { ...group, hooks });
    }
    return kept;
  }

  private isMuseCodeHookInstalled(): boolean {
    let settings: any;
    try {
      settings = this.readMuseSettings().settings;
    } catch {
      return false;
    }
    if (!settings?.hooks || typeof settings.hooks !== 'object') return false;
    // Command hooks: the scripts must exist for the hook to actually fire.
    if (!this.hasAllFiles([museHookShPath(), museHookPs1Path()])) return false;
    return ['SessionStart', 'PreToolUse', 'Stop'].every((event) =>
      Array.isArray(settings.hooks[event]) &&
      settings.hooks[event].some((group: any) =>
        Array.isArray(group?.hooks) && group.hooks.some((h: any) => this.isMuseAgentPulseHandler(h)),
      ),
    );
  }

  // Muse only needs to WAIT for two hooks: PreToolUse (that is where a
  // guardrail deny is relayed) and SessionStart (once per session, so the
  // agent PID chain is latched before any other event and its idle-active
  // can never land after a later working event). Everything else is
  // observation-only and declared `async: true`, which Muse runs in the
  // background without stalling the turn (verified 1.4.1: async hooks fire,
  // are not awaited, and are not audited in the session log).
  private static readonly MUSE_AWAITED_EVENTS = new Set(['PreToolUse', 'SessionStart']);

  private buildMuseHandler(event: string): any {
    const shPath = museHookShPath();
    const ps1Path = museHookPs1Path();
    // POSIX: the command goes through a shell, so single-quote a path with
    // whitespace and leave a plain one bare.
    const command = /\s/.test(shPath) ? `'${shPath.replace(/'/g, `'\\''`)}'` : shPath;
    const systemRoot = process.env['SystemRoot'] || 'C:\\Windows';
    const psExe = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const inner = `& '${ps1Path.replace(/'/g, "''")}'`;
    const encoded = Buffer.from(inner, 'utf16le').toString('base64');
    const commandWindows = `${psExe} -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
    return {
      type: 'command',
      command,
      commandWindows,
      // Seconds (verified: a 1s timeout still let a ~240ms hook complete).
      timeout: 10,
      ...(ConfigWriter.MUSE_AWAITED_EVENTS.has(event) ? {} : { async: true }),
      statusMessage: ConfigWriter.MUSE_STATUS_MESSAGE,
    };
  }

  private writeMuseCodeHook() {
    const { settings } = this.readMuseSettings(); // throws on an unparsable file
    const hooksDir = museHooksDir();
    if (!fs.existsSync(hooksDir)) {
      fs.mkdirSync(hooksDir, { recursive: true });
    }
    fs.writeFileSync(museHookShPath(), this.buildMuseShellScript(), { mode: 0o755 });
    fs.writeFileSync(museHookPs1Path(), this.buildMusePowerShellScript());

    if (typeof settings.schema_version !== 'number') settings.schema_version = 1;
    if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
      settings.hooks = {};
    }
    // Strip-then-append per event, like the Claude Code writer: idempotent and
    // never touches foreign handlers.
    for (const event of ConfigWriter.MUSE_HOOK_EVENTS) {
      settings.hooks[event] = [
        ...this.stripMuseAgentPulseEntries(settings.hooks[event]),
        { hooks: [this.buildMuseHandler(event)] },
      ];
    }

    const settingsPath = museSettingsPath();
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    return { success: true, path: settingsPath };
  }

  /**
   * Bash script for Muse Code: injects `_ap_tool: "muse-code"` + cwd + agent_pid
   * before forwarding the stdin event JSON to the bridge, and relays a deny
   * verdict back via stdout. Muse clears the environment for hooks, so PATH is
   * restored to the usual system locations first. Fail-open on any error.
   */
  private buildMuseShellScript(): string {
    return `#!/usr/bin/env bash
# Agent Pulse — Muse Code hook script (bash)
# Reads event JSON from stdin, injects identifier + cwd + agent_pid, forwards to
# the bridge, and relays a guardrail deny verdict back to Muse via stdout.
# Muse runs hooks with a cleared environment, so restore a sane PATH first.
# Fail-open: any bridge error leaves the tool call allowed.
export PATH="\${PATH:+$PATH:}/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
BODY=$(cat)
CWD_ESCAPED=$(printf '%s' "$PWD" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
CHAIN_PIDS="$PPID"
_CUR=$PPID
for _i in 1 2 3 4 5 6 7; do
  _PARENT=$(ps -o ppid= -p "$_CUR" 2>/dev/null | tr -d ' ')
  if [ -z "$_PARENT" ] || [ "$_PARENT" -le 1 ] 2>/dev/null; then break; fi
  CHAIN_PIDS="$CHAIN_PIDS,$_PARENT"
  _CUR=$_PARENT
done
INJECT='"_ap_tool":"muse-code","cwd":"'"$CWD_ESCAPED"'","agent_pid":'"$PPID"',"agent_pid_chain":['"$CHAIN_PIDS"'],'
BODY=$(printf '%s' "$BODY" | sed "s|^{|{$INJECT|")
RESP=$(curl -s --max-time 3 -X POST \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  "${this.museBridgeUrl()}" 2>/dev/null || true)
# Relay an explicit deny verdict. Muse rejects any non-Claude top-level key, so
# the bridge sends Muse a pure Claude-shaped body (see buildDenyResponse); a
# down/slow bridge fails open (tool call allowed).
case "$RESP" in
  *'"permissionDecision":"deny"'*) printf '%s' "$RESP" ;;
esac
exit 0
`;
  }

  /**
   * PowerShell script for Muse Code: injects `_ap_tool: "muse-code"` + cwd +
   * agent_pid before forwarding to the bridge. Launched via -EncodedCommand
   * (see buildMuseHandler) so the settings entry needs no quoting. Fail-open.
   */
  private buildMusePowerShellScript(): string {
    return `# Agent Pulse — Muse Code hook script (PowerShell)
# Reads event JSON from stdin, injects identifier + cwd + agent_pid, forwards to
# the bridge, and relays a guardrail deny verdict back to Muse via stdout.
# Fail-open: any bridge error leaves the tool call allowed.
$ProgressPreference = 'SilentlyContinue'
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$reader = [System.IO.StreamReader]::new([Console]::OpenStandardInput(), [System.Text.UTF8Encoding]::new($false))
$body = $reader.ReadToEnd()
$reader.Close()
# Manual JSON escaping: the JSON cmdlet would auto-import a module (~1s cold).
$cwdJson = '"' + $PWD.Path.Replace('\\', '\\\\').Replace('"', '\\"') + '"'
# Only SessionStart walks the process tree (any WMI call costs 2-4s in a cold
# process): it is awaited, so the chain is latched before anything else fires,
# and the hosting terminal cannot change for the life of the session. Every
# other hook stays on the ~0.2s fast path — the awaited PreToolUse because it
# sits on every tool call, and the async ones because a slow background hook
# could otherwise land after a later Stop and revive an idle bubble. The
# bridge keeps the latched chain when a payload omits it.
$walk = $body -match '"hook_event_name"\\s*:\\s*"SessionStart"'
$pidInject = ''
if ($walk) {
  $chainPids = New-Object System.Collections.ArrayList
  [void]$chainPids.Add($PID)
  try {
    $parents = @{}
    foreach ($p in (Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId -ErrorAction Stop)) {
      $parents[[int]$p.ProcessId] = [int]$p.ParentProcessId
    }
    $cur = $PID
    for ($i = 0; $i -lt 7; $i++) {
      if (-not $parents.ContainsKey($cur)) { break }
      $next = $parents[$cur]
      if ($next -le 0) { break }
      [void]$chainPids.Add($next)
      $cur = $next
    }
  } catch { }
  $chainJson = '[' + ($chainPids -join ',') + ']'
  $agentPid = if ($chainPids.Count -ge 2) { $chainPids[1] } else { $PID }
  $pidInject = '"agent_pid":' + $agentPid + ',"agent_pid_chain":' + $chainJson + ','
}
$inject = '"_ap_tool":"muse-code","cwd":' + $cwdJson + ',' + $pidInject
$body = $body -replace '^\\{', ('{' + $inject)
try {
  # Raw HttpWebRequest: ~300ms cheaper per call than the web cmdlet in a
  # fresh PowerShell process. Literal 127.0.0.1 (never localhost): the IPv6
  # ::1 attempt against the IPv4-only bridge costs ~2s per call.
  $req = [System.Net.WebRequest]::Create("${this.museBridgeUrl()}")
  $req.Method = 'POST'
  $req.ContentType = 'application/json'
  $req.Timeout = 3000
  # Loopback only — skip system proxy auto-detection (can add 1-2s).
  $req.Proxy = $null
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  $req.ContentLength = $bytes.Length
  $stream = $req.GetRequestStream()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Close()
  $resp = $req.GetResponse()
  $respReader = [System.IO.StreamReader]::new($resp.GetResponseStream(), [System.Text.UTF8Encoding]::new($false))
  $content = $respReader.ReadToEnd()
  $respReader.Close()
  $resp.Close()
  # Muse rejects any non-Claude top-level key in hook output, so the bridge
  # sends a pure Claude-shaped deny; relay it verbatim, nothing otherwise.
  if ($content -like '*"permissionDecision":"deny"*') {
    [Console]::Out.Write($content)
  }
} catch { }
exit 0
`;
  }

  // ─── OpenCode ──────────────────────────────────────────────────────────────
  // OpenCode has NO declarative shell-hook config. The `experimental.hook`
  // block (file_edited / session_completed) documented in various third-party
  // guides is absent from the live schema at opencode.ai/config.json and from
  // the current source — do not build on it. The supported extension point is
  // an in-process JS/TS plugin, so that is what we install.

  private isOpencodeHookInstalled(): boolean {
    // Accept either directory spelling; only OUR file counts as installed.
    return opencodePluginDirs().some((dir) =>
      fs.existsSync(path.join(dir, OPENCODE_PLUGIN_FILENAME)),
    );
  }

  private writeOpencodeHook() {
    const pluginPath = opencodePluginPath();
    const pluginDir = path.dirname(pluginPath);
    if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });

    // Plain .js on purpose. A .ts plugin importing `@opencode-ai/plugin` for
    // its types makes OpenCode shell out to Bun on next boot and install ~49MB
    // of node_modules into the user's config dir — a very visible side effect
    // for zero runtime benefit.
    fs.writeFileSync(pluginPath, this.buildOpencodePlugin(), 'utf8');

    return { success: true, path: pluginPath, configDir: opencodeConfigDir() };
  }

  /**
   * Rewrites an already-installed OpenCode plugin whose content is stale (older
   * template, changed bridge URL). Called on app start: unlike shell-hook tools
   * whose scripts just POST, the OpenCode plugin carries real behavior (the
   * gated block round-trip), so an old copy silently downgrades enforcement.
   * Never installs uninvited — no-op when the plugin isn't present. OpenCode
   * loads plugins at boot, so a rewrite takes effect on the user's next
   * OpenCode session.
   *
   * Returns true when at least one file was rewritten.
   */
  public refreshOpencodePlugin(): boolean {
    if (!this.isOpencodeHookInstalled()) return false;
    const fresh = this.buildOpencodePlugin();
    let rewrote = false;
    // The user may have relocated the file into the legacy `plugin/` dir —
    // refresh it wherever it actually lives rather than only the canonical path.
    for (const dir of opencodePluginDirs()) {
      const file = path.join(dir, OPENCODE_PLUGIN_FILENAME);
      if (!fs.existsSync(file)) continue;
      let existing = '';
      try { existing = fs.readFileSync(file, 'utf8'); } catch { continue; }
      if (existing === fresh) continue;
      fs.writeFileSync(file, fresh, 'utf8');
      rewrote = true;
    }
    return rewrote;
  }

  /**
   * The OpenCode plugin. Runs INSIDE OpenCode (Bun runtime), so unlike every
   * other tool we support there is no shell script, no stdin parsing, and no
   * transcript to tail — the event bus hands us typed state and real token
   * counts directly.
   *
   * Verified event order for one turn on OpenCode 1.18.18:
   *   session.created → session.updated → message.updated → message.part.updated
   *   → session.status{busy} → [session.error] → session.status{idle} → session.idle
   *
   * Two consequences that shape the code below:
   *  1. A FAILED turn still ends with status{idle} + session.idle, so status
   *     alone can never surface an error — we latch the error and swallow the
   *     idle that follows it.
   *  2. Subagents get their own sessions, so status events interleave. We count
   *     busy sessions instead of trusting the latest event.
   */
  private buildOpencodePlugin(): string {
    // NOTE: no backticks / ${} inside the emitted source — this is a TS
    // template literal, so the plugin body uses plain concatenation.
    return `// Agent Pulse — OpenCode plugin (auto-generated; safe to delete)
// Plugin format v2 — gated tool calls (blocking round-trip).
//
// Reports agent state to the Agent Pulse bridge on localhost. Status events are
// fire-and-forget (each POST swallows its own errors), but bash/read/grep/glob
// tool calls await a bounded verdict from the bridge so guardrails and Secret
// Protection can abort a denied call. The wait fails OPEN on timeout, error, or
// missing bridge — Agent Pulse being closed can never stall an OpenCode turn.
//
// Docs: https://opencode.ai/docs/plugins/

const BRIDGE_URL = ${JSON.stringify(this.bridgeUrl)};

// Cap the reported-message set so a very long-lived server can't grow it
// without bound.
const MAX_TRACKED_MESSAGES = 500;

// Upper bound on how long a gated tool call may wait for the bridge's verdict.
// Evaluation is in-memory regex on localhost (single-digit ms); this budget only
// absorbs Electron main-process stalls. When Agent Pulse isn't running the
// fetch fails in a few ms, so this is NOT the no-bridge latency.
const GATE_TIMEOUT_MS = 400;

export const AgentPulse = async ({ directory, worktree }) => {
  const cwd = worktree || directory || undefined;

  // Sessions currently mid-turn. OpenCode gives subagents their own session ids
  // and their status events interleave with the parent's, so "is anything
  // working" is a COUNT, not the last event we saw.
  const busySessions = new Set();

  // Sessions that errored during the current turn. session.status{idle} and
  // session.idle both still fire after a failure; without this latch the red
  // error state would be overwritten by idle-active milliseconds later.
  const erroredSessions = new Set();

  // messageIDs whose tokens we've already reported. message.updated fires
  // repeatedly while a message streams, and the token counts on it are
  // per-message totals — counting every update would multiply usage.
  const countedMessages = new Set();

  let lastModel;

  // On 1.18.18 a turn ends with BOTH session.status{idle} and session.idle, so
  // acting on each would write duplicate timeline events. We prefer
  // session.status and use session.idle only as a fallback for builds that
  // don't emit status at all — feature-detected rather than version-sniffed.
  let sawStatusEvent = false;

  const post = (body) => {
    try {
      const p = fetch(BRIDGE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Agent Pulse not running / no fetch — stay silent.
    }
  };

  // Awaited, bounded POST used only for gated tool calls. Returns the parsed
  // response body, or null on ANY failure (timeout, no bridge, bad JSON) so the
  // caller fails open — a missing Agent Pulse must never stall a turn.
  const postWait = async (body) => {
    try {
      if (typeof fetch !== 'function') return null;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => { ctrl.abort(); }, GATE_TIMEOUT_MS) : null;
      try {
        const res = await fetch(BRIDGE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl ? ctrl.signal : undefined,
        });
        if (!res || typeof res.json !== 'function') return null;
        return await res.json();
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch {
      return null;
    }
  };

  const buildBody = (state, extra) => {
    const payload = {
      cwd,
      agentPid: typeof process !== 'undefined' ? process.pid : undefined,
      activeAgents: busySessions.size,
      model: lastModel,
    };
    const body = { toolId: 'opencode', state, payload };
    if (extra) {
      // Guardrail fields live at the TOP level: the bridge's extractCommand /
      // extractReadPath read the raw body, while payload stays the typed
      // NormalizedEvent shape.
      if (extra.toolName) body.toolName = extra.toolName;
      if (extra.command) body.command = extra.command;
      if (extra.filePath) body.filePath = extra.filePath;
      if (extra.canBlock) body.canBlock = true;
      if (extra.sessionId) payload.sessionId = extra.sessionId;
      if (extra.taskSummary) payload.taskSummary = extra.taskSummary;
      if (extra.errorMessage) payload.errorMessage = extra.errorMessage;
      if (extra.tokens) payload.tokens = extra.tokens;
    }
    return body;
  };

  const send = (state, extra) => {
    post(buildBody(state, extra));
  };

  // The state the session is ACTUALLY in right now, derived from the busy count
  // rather than from whichever event happens to be in hand. Used by the token
  // report, which must never change the visible state: if a completed assistant
  // message arrives after the turn already went idle (or failed), reporting a
  // hardcoded 'working' would resurrect a finished turn or paint over an error.
  const impliedState = (sessionId) => {
    if (busySessions.size > 0) return 'working';
    if (erroredSessions.has(sessionId)) return 'error';
    return 'idle-active';
  };

  // Emit the state implied by the current busy count. Called after every
  // status transition so subagent churn resolves to one coherent state.
  const syncState = (sessionId) => {
    if (busySessions.size > 0) {
      send('working', { sessionId });
      return;
    }
    // Turn boundary. If this session just failed, leave the error standing.
    if (erroredSessions.has(sessionId)) {
      erroredSessions.delete(sessionId);
      return;
    }
    send('idle-active', { sessionId });
  };

  return {
    event: async ({ event }) => {
      const type = event && event.type;
      const props = (event && event.properties) || {};
      const sessionId = props.sessionID;

      switch (type) {
        case 'session.status': {
          sawStatusEvent = true;
          const status = (props.status && props.status.type) || 'idle';
          if (status === 'busy' || status === 'retry') {
            // 'retry' means OpenCode is re-attempting after a provider error —
            // still actively working, not finished.
            if (sessionId) busySessions.add(sessionId);
            send('working', { sessionId });
          } else {
            if (sessionId) busySessions.delete(sessionId);
            syncState(sessionId);
          }
          break;
        }

        case 'session.updated': {
          // Carries the model for the session; remember it so later state
          // events can label the bubble even when no message is in flight.
          const info = props.info || {};
          if (info.model && info.model.id) lastModel = info.model.id;
          break;
        }

        case 'session.error': {
          if (sessionId) {
            erroredSessions.add(sessionId);
            busySessions.delete(sessionId);
          }
          const err = props.error || {};
          const message =
            (err.data && err.data.message) || err.name || 'OpenCode session error';
          send('error', { sessionId, errorMessage: String(message) });
          break;
        }

        case 'permission.asked': {
          // Blocked on the user — this is Agent Pulse's 'waiting', distinct
          // from a finished turn.
          send('waiting', { sessionId });
          break;
        }

        case 'permission.replied': {
          if (sessionId) busySessions.add(sessionId);
          send('working', { sessionId });
          break;
        }

        case 'session.idle': {
          // Fallback only — see sawStatusEvent above.
          if (sawStatusEvent) break;
          if (sessionId) busySessions.delete(sessionId);
          syncState(sessionId);
          break;
        }

        case 'session.deleted': {
          if (sessionId) {
            busySessions.delete(sessionId);
            erroredSessions.delete(sessionId);
          }
          send('idle', { sessionId });
          break;
        }

        case 'message.updated': {
          // Real token counts, straight off the assistant message. Only read
          // COMPLETED messages: a streaming message's counts are still moving.
          const info = props.info || {};
          if (info.role !== 'assistant') break;
          if (!info.time || !info.time.completed) break;
          if (!info.id || countedMessages.has(info.id)) break;

          countedMessages.add(info.id);
          if (countedMessages.size > MAX_TRACKED_MESSAGES) {
            const oldest = countedMessages.values().next().value;
            countedMessages.delete(oldest);
          }

          if (info.modelID) lastModel = info.modelID;
          const t = info.tokens || {};
          const cache = t.cache || {};
          const msgSession = info.sessionID || sessionId;
          send(impliedState(msgSession), {
            sessionId: msgSession,
            tokens: {
              model: info.modelID || lastModel,
              tokensIn: t.input || 0,
              tokensOut: t.output || 0,
              cacheRead: cache.read || 0,
              cacheWrite: cache.write || 0,
            },
          });
          break;
        }

        default:
          break;
      }
    },

    // Surfaces the running command/file so the bubble can show what the agent
    // is doing. bash/read/grep/glob calls are GATED: the POST doubles as the
    // 'working' status event and the bridge's verdict is awaited (bounded by
    // GATE_TIMEOUT_MS, failing open). On a deny the hook THROWS, which makes
    // OpenCode abort the tool call — this is how guardrails and Secret
    // Protection enforce. grep/glob visibility is limited to their optional
    // 'path' arg; content patterns are never forwarded.
    'tool.execute.before': async (input, output) => {
      const toolName = input && input.tool;
      const args = (output && output.args) || {};
      const command = typeof args.command === 'string' ? args.command : undefined;
      const filePath = typeof args.filePath === 'string' ? args.filePath
        : (typeof args.path === 'string' ? args.path : undefined);
      const sessionId = input && input.sessionID;
      const extra = {
        sessionId,
        toolName,
        command,
        filePath,
        taskSummary: toolName ? 'Tool: ' + toolName : undefined,
      };
      if (sessionId) busySessions.add(sessionId);
      const gated = toolName === 'bash' || toolName === 'read'
        || toolName === 'grep' || toolName === 'glob';
      if (!gated) {
        send('working', extra);
        return;
      }
      extra.canBlock = true;
      const resp = await postWait(buildBody('working', extra));
      if (resp && resp.status === 'blocked') {
        // The bridge refused the call and skipped its status update; don't
        // leave this session latched busy — OpenCode's own session.status
        // events re-drive state after the abort.
        if (sessionId) busySessions.delete(sessionId);
        throw new Error('Agent Pulse: ' + (resp.reason || 'blocked by guardrails'));
      }
    },
  };
};
`;
  }

  public uninstallHook(toolId: ToolId, projectPath?: string) {
    if (toolId === 'opencode') {
      // Delete only our plugin file — never the plugins dir itself, which may
      // hold the user's own plugins.
      for (const dir of opencodePluginDirs()) {
        const file = path.join(dir, OPENCODE_PLUGIN_FILENAME);
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      return { success: true };
    }

    if (toolId === 'grok') {
      // Delete only our dedicated config + scripts — leaves any other Grok
      // hooks intact.
      const hookPath = this.grokHookPath();
      if (fs.existsSync(hookPath)) fs.unlinkSync(hookPath);
      const hooksDir = path.join(this.grokHome(), 'hooks');
      const shPath  = path.join(hooksDir, 'agent-pulse.sh');
      const ps1Path = path.join(hooksDir, 'agent-pulse.ps1');
      if (fs.existsSync(shPath))  fs.unlinkSync(shPath);
      if (fs.existsSync(ps1Path)) fs.unlinkSync(ps1Path);
      return { success: true };
    }

    if (toolId === 'muse-code') {
      // Strip only our handlers from the settings file (foreign hooks and every
      // other setting survive), then remove the script pair. An unparsable
      // settings file is left alone — we never rewrite what we can't read.
      try {
        const { settings, existed } = this.readMuseSettings();
        if (existed && settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)) {
          for (const event of Object.keys(settings.hooks)) {
            if (!Array.isArray(settings.hooks[event])) continue;
            const kept = this.stripMuseAgentPulseEntries(settings.hooks[event]);
            if (kept.length === 0) delete settings.hooks[event];
            else settings.hooks[event] = kept;
          }
          if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
          fs.writeFileSync(museSettingsPath(), JSON.stringify(settings, null, 2) + '\n');
        }
      } catch {
        // Unparsable settings — leave the file untouched.
      }
      for (const file of [museHookShPath(), museHookPs1Path()]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
      return { success: true };
    }

    if (toolId === 'claude-code') {
      const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
      if (!fs.existsSync(settingsPath)) return { success: true };
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        // Remove only our own http entries; user-authored hooks sharing the
        // same event keys must survive uninstall.
        if (settings.hooks && typeof settings.hooks === 'object') {
          for (const event of ConfigWriter.allClaudeCodeHookEvents()) {
            if (!(event in settings.hooks)) continue;
            const kept = this.stripAgentPulseHttpEntries(settings.hooks[event]);
            if (kept.length === 0) delete settings.hooks[event];
            else settings.hooks[event] = kept;
          }
        }
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
          // Same filter as writeCursorHook's write-side merge: drop only our
          // own entries, keep user-authored ones.
          for (const event of ['preToolUse', 'postToolUse', 'postToolUseFailure', 'sessionStart', 'sessionEnd', 'stop']) {
            const arr = config.hooks?.[event];
            if (!Array.isArray(arr)) continue;
            const kept = arr.filter((h: any) => !h?.command?.includes('agent-pulse'));
            if (kept.length === 0) delete config.hooks[event];
            else config.hooks[event] = kept;
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

  // ── Claude Code status line ───────────────────────────────────────────────
  // Unlike the hooks (which POST to our bridge), the status line is a command
  // Claude Code spawns to render the bottom bar. We deploy ONE renderer script
  // (in the detected runtime) under ~/.claude/agent-pulse/ that reads a config
  // file projected from UserConfig.statusLine, then merge a `statusLine` key
  // into ~/.claude/settings.json the same non-clobbering way writeClaudeCodeHook
  // merges `hooks`.

  private statusLineDir(): string {
    return path.join(os.homedir(), '.claude', 'agent-pulse');
  }

  public statusLineSettingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  public statusLineConfigPath(): string {
    return path.join(this.statusLineDir(), 'statusline.config.json');
  }

  private statusLineScriptName(runtime: StatusLineRuntime): string {
    return runtime === 'python' ? 'statusline.py' : runtime === 'powershell' ? 'statusline.ps1' : 'statusline.js';
  }

  private statusLineScriptPath(runtime: StatusLineRuntime): string {
    return path.join(this.statusLineDir(), this.statusLineScriptName(runtime));
  }

  // Which runtime's script is currently wired into settings.json (inferred from
  // the script filename in the command), or null if none/foreign/unparseable.
  // Lets a config edit refresh the SAME deployed script without re-detecting.
  public installedStatusLineRuntime(): StatusLineRuntime | null {
    const settings = this.readJson(this.statusLineSettingsPath());
    const command = settings?.statusLine?.command;
    if (typeof command !== 'string') return null;
    const norm = command.replace(/\\/g, '/').toLowerCase();
    if (norm.includes('statusline.ps1')) return 'powershell';
    if (norm.includes('statusline.py')) return 'python';
    if (norm.includes('statusline.js')) return 'node';
    return null;
  }

  // Write (or overwrite) the renderer script for a runtime. Separate from
  // installStatusLine so a config edit can refresh the deployed script to the
  // current app version — otherwise script-level features added after the user
  // first installed (new segments, icon prefixes, …) never reach them.
  public deployStatusLineScript(runtime: StatusLineRuntime): string {
    const dir = this.statusLineDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const scriptPath = this.statusLineScriptPath(runtime);
    if (runtime === 'powershell') {
      // UTF-8 BOM so Windows PowerShell 5.1 decodes the non-ASCII glyphs/emoji.
      fs.writeFileSync(scriptPath, '﻿' + this.buildStatusLinePowerShellScript());
    } else {
      const script = runtime === 'python' ? this.buildStatusLinePythonScript() : this.buildStatusLineNodeScript();
      fs.writeFileSync(scriptPath, script, { mode: 0o755 });
    }
    return scriptPath;
  }

  // Classify the existing statusLine in settings.json: ours (points at our
  // agent-pulse script), foreign (someone else's), or none.
  public statusLineState(): StatusLineState {
    const settings = this.readJson(this.statusLineSettingsPath());
    const command = settings?.statusLine?.command;
    if (!command || typeof command !== 'string') return 'none';
    const norm = command.replace(/\\/g, '/').toLowerCase();
    return norm.includes('/agent-pulse/statusline') ? 'ours' : 'foreign';
  }

  // Write the projected config the deployed script reads at runtime. The
  // projection carries `bridgeStatusUrl` and `pulseToken` (not part of
  // StatusLineConfig — the in-app preview renderer ignores unknown keys) so
  // the script knows where to forward its stdin JSON for quota/cost/cache
  // analytics, and can authenticate: POST /statusline is token-gated. The
  // token is the same shared secret as ~/.agent-pulse/mcp.json, so the file
  // gets the same 0o600 (advisory on Windows).
  public writeStatusLineConfig(cfg: StatusLineConfig): string {
    const dir = this.statusLineDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = this.statusLineConfigPath();
    const token = readConnectionFile()?.token;
    fs.writeFileSync(p, JSON.stringify({
      ...cfg,
      bridgeStatusUrl: STATUSLINE_INGEST_URL,
      ...(token ? { pulseToken: token } : {}),
    }, null, 2), { mode: 0o600 });
    return p;
  }

  // Copy settings.json aside before we replace a foreign statusLine, so the
  // user can recover their hand-crafted line. Returns the backup path.
  private backupSettings(settingsPath: string): string {
    let n = 1;
    let dest = path.join(path.dirname(settingsPath), `settings.backup-${n}.json`);
    while (fs.existsSync(dest) && n < 1000) {
      n += 1;
      dest = path.join(path.dirname(settingsPath), `settings.backup-${n}.json`);
    }
    fs.copyFileSync(settingsPath, dest);
    return dest;
  }

  public installStatusLine(cfg: StatusLineConfig, runtime: StatusLineRuntime, binPath: string): { success: boolean; state: StatusLineState; path: string; backup?: string } {
    const dir = this.statusLineDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // Deploy the renderer script for the chosen runtime + the config projection.
    const scriptPath = this.deployStatusLineScript(runtime);
    this.writeStatusLineConfig(cfg);

    // Build the command with ABSOLUTE interpreter + script paths (quoted for
    // spaces). PowerShell needs the -File invocation form.
    const q = (p: string) => `"${p}"`;
    const command = runtime === 'powershell'
      ? `${q(binPath)} -ExecutionPolicy Bypass -File ${q(scriptPath)}`
      : `${q(binPath)} ${q(scriptPath)}`;

    // Back up a foreign status line before clobbering it.
    const settingsPath = this.statusLineSettingsPath();
    let backup: string | undefined;
    if (this.statusLineState() === 'foreign' && fs.existsSync(settingsPath)) {
      try { backup = this.backupSettings(settingsPath); } catch { /* best effort */ }
    }

    // Merge into settings.json, preserving every other key (hooks, model, …).
    const claudeDir = path.join(os.homedir(), '.claude');
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    const settings = this.readJson(settingsPath) ?? {};
    settings.statusLine = { type: 'command', command };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    return { success: true, state: 'ours', path: settingsPath, backup };
  }

  // Remove only the statusLine key; leave the deployed script/config files
  // (harmless) and every other settings.json key intact.
  public removeStatusLine(): { success: boolean } {
    const settingsPath = this.statusLineSettingsPath();
    const settings = this.readJson(settingsPath);
    if (settings && settings.statusLine) {
      delete settings.statusLine;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }
    return { success: true };
  }

  // ── Codex status line ─────────────────────────────────────────────────────
  // Codex draws its own footer from `[tui] status_line = [...]` in
  // ~/.codex/config.toml, so there is no script to deploy — we upsert one line
  // inside one table (see ./codex-toml.ts) and tag it with a marker comment so
  // we can tell our line from a hand-written one.

  public codexConfigTomlPath(): string {
    return path.join(os.homedir(), '.codex', 'config.toml');
  }

  /** What the file holds right now, before any state judgement. */
  public readCodexStatusLine(): { present: boolean; items: string[] | null; marked: boolean; conflict: boolean } {
    const tomlPath = this.codexConfigTomlPath();
    if (!fs.existsSync(tomlPath)) return { present: false, items: null, marked: false, conflict: false };
    let content: string;
    try { content = fs.readFileSync(tomlPath, 'utf8'); }
    catch { return { present: false, items: null, marked: false, conflict: false }; }
    const conflict = hasInlineTableConflict(content, 'tui', 'status_line');
    const span = findKeyInTable(splitLines(content).lines, 'tui', 'status_line');
    if (!span) return { present: conflict, items: null, marked: false, conflict };
    return {
      present: true,
      items: parseStatusLineArray(span.valueText),
      marked: span.line.includes(CODEX_MANAGED_MARK),
      conflict,
    };
  }

  // 'ours' when the line carries our marker OR its items equal what we would
  // write (a user who stripped the comment keeps their "Installed" state).
  public codexStatusLineState(expected: CodexStatusLineConfig): CodexStatusLineState {
    const cur = this.readCodexStatusLine();
    if (!cur.present) return 'none';
    if (cur.marked) return 'ours';
    if (cur.items && cur.items.length === expected.items.length && cur.items.every((v, i) => v === expected.items[i])) {
      return 'ours';
    }
    return 'foreign';
  }

  private backupCodexConfig(tomlPath: string): string {
    let n = 1;
    let dest = path.join(path.dirname(tomlPath), `config.backup-${n}.toml`);
    while (fs.existsSync(dest) && n < 1000) {
      n += 1;
      dest = path.join(path.dirname(tomlPath), `config.backup-${n}.toml`);
    }
    fs.copyFileSync(tomlPath, dest);
    return dest;
  }

  public installCodexStatusLine(
    cfg: CodexStatusLineConfig,
    opts: { replace?: boolean } = {},
  ): { success: boolean; state: CodexStatusLineState; path: string; backup?: string; reason?: 'needs-confirm' | 'inline-table' | 'empty' } {
    const tomlPath = this.codexConfigTomlPath();
    if (cfg.items.length === 0) {
      return { success: false, state: this.codexStatusLineState(cfg), path: tomlPath, reason: 'empty' };
    }
    const state = this.codexStatusLineState(cfg);
    const cur = this.readCodexStatusLine();
    if (cur.conflict) return { success: false, state: 'foreign', path: tomlPath, reason: 'inline-table' };
    if (state === 'foreign' && !opts.replace) {
      return { success: false, state, path: tomlPath, reason: 'needs-confirm' };
    }

    const codexDir = path.dirname(tomlPath);
    if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });
    const content = fs.existsSync(tomlPath) ? fs.readFileSync(tomlPath, 'utf8') : '';

    let backup: string | undefined;
    if (state === 'foreign' && content) {
      try { backup = this.backupCodexConfig(tomlPath); } catch { /* best effort */ }
    }

    const next = upsertKeyInTable(content, 'tui', 'status_line', formatStatusLineArray(cfg.items));
    if (next !== content) fs.writeFileSync(tomlPath, next);
    return { success: true, state: 'ours', path: tomlPath, backup };
  }

  // Remove only our key (and the [tui] header if we created it); every other
  // line survives byte for byte.
  public removeCodexStatusLine(): { success: boolean } {
    const tomlPath = this.codexConfigTomlPath();
    if (!fs.existsSync(tomlPath)) return { success: true };
    const content = fs.readFileSync(tomlPath, 'utf8');
    const next = removeKeyFromTable(content, 'tui', 'status_line');
    if (next !== content) fs.writeFileSync(tomlPath, next);
    return { success: true };
  }

  // The three renderer scripts below are deliberately written WITHOUT backslash,
  // backtick, or the "${" sequence so they survive being embedded verbatim in
  // these generating template literals. ESC/backslash are produced via char-code
  // helpers at runtime. All three implement the same contract as
  // src/common/statusline-render.ts (preview ≡ Node output).

  private buildStatusLineNodeScript(): string {
    return `#!/usr/bin/env node
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');

var ESC = String.fromCharCode(27);
var BS = String.fromCharCode(92);
var NL = String.fromCharCode(10);
function esc(c){ return ESC + '[' + c + 'm'; }
var ANSI = { white: esc(37), gray: esc(90), red: esc(31), green: esc(32), yellow: esc(33), blue: esc(34), magenta: esc(35), cyan: esc(36) };
var RESET = esc(0);
var DEFAULT_THRESHOLDS = [{ at: 0, color: 'green' }, { at: 50, color: 'yellow' }, { at: 80, color: 'red' }];
var DEFAULT_COLOR = { model: 'white', cwd: 'cyan', projectDir: 'cyan', gitBranch: 'magenta', repo: 'blue', cost: 'gray', duration: 'gray', linesChanged: 'gray', outputStyle: 'gray', effort: 'gray', vimMode: 'gray', pr: 'blue' };

function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
function get(o){ var c = o; for (var i = 1; i < arguments.length; i++){ if (c == null) return undefined; c = c[arguments[i]]; } return c; }
function basename(p){ p = String(p); var i = Math.max(p.lastIndexOf('/'), p.lastIndexOf(BS)); return i >= 0 ? p.slice(i + 1) : p; }
function fmtDur(ms){ var s = Math.floor(ms / 1000); if (s < 60) return s + 's'; var m = Math.floor(s / 60); if (m < 60) return (s % 60) ? (m + 'm ' + (s % 60) + 's') : (m + 'm'); var h = Math.floor(m / 60); return h + 'h ' + (m % 60) + 'm'; }
function colorForValue(pct, th){ var stops = ((th && th.length) ? th : DEFAULT_THRESHOLDS).slice().sort(function(a, b){ return a.at - b.at; }); var c = stops.length ? stops[0].color : 'green'; for (var i = 0; i < stops.length; i++){ if (pct >= stops[i].at) c = stops[i].color; } return c === 'auto' ? 'white' : c; }
function colorize(t, c){ return (ANSI[c] || ANSI.white) + t + RESET; }

function renderSegment(seg, session){
  var base = (seg.color && seg.color !== 'auto') ? seg.color : (DEFAULT_COLOR[seg.type] || 'white');
  var t = seg.type;
  if (t === 'model'){ var mv = get(session, 'model', 'display_name'); return mv ? { text: String(mv), color: base } : null; }
  if (t === 'contextBar'){
    var pct = get(session, 'context_window', 'used_percentage');
    if (pct == null) return null;
    var value = clamp(Math.round(Number(pct)), 0, 100);
    var width = clamp(Math.floor(seg.width == null ? 20 : seg.width), 4, 40);
    var fillChar = seg.fillChar || '█';
    var emptyChar = seg.emptyChar || '░';
    var filled = clamp(Math.round((value / 100) * width), 0, width);
    var bar = '[' + fillChar.repeat(filled) + emptyChar.repeat(width - filled) + ']';
    var text = (seg.showPercent === false) ? bar : (bar + ' ' + value + '%');
    var color = (seg.color && seg.color !== 'auto') ? seg.color : colorForValue(value, seg.thresholds);
    return { text: text, color: color };
  }
  if (t === 'cwd' || t === 'projectDir'){
    var dir = (t === 'cwd') ? (get(session, 'workspace', 'current_dir') == null ? get(session, 'cwd') : get(session, 'workspace', 'current_dir')) : get(session, 'workspace', 'project_dir');
    if (!dir) return null;
    var dtext = (seg.basenameOnly === false) ? String(dir) : basename(String(dir));
    return { text: dtext, color: base };
  }
  if (t === 'gitBranch'){ var gb = get(session, 'workspace', 'git_worktree'); if (gb == null) gb = get(session, 'worktree', 'branch'); return gb ? { text: String(gb), color: base } : null; }
  if (t === 'repo'){ var owner = get(session, 'workspace', 'repo', 'owner'); var name = get(session, 'workspace', 'repo', 'name'); if (!name) return null; return { text: owner ? (owner + '/' + name) : String(name), color: base }; }
  if (t === 'cost'){ var usd = get(session, 'cost', 'total_cost_usd'); if (usd == null) return null; return { text: '$' + Number(usd).toFixed(4), color: base }; }
  if (t === 'duration'){ var ms = get(session, 'cost', 'total_duration_ms'); if (ms == null) return null; return { text: fmtDur(Number(ms)), color: base }; }
  if (t === 'linesChanged'){ var add = get(session, 'cost', 'total_lines_added'); var rem = get(session, 'cost', 'total_lines_removed'); if (add == null && rem == null) return null; return { text: '+' + (add == null ? 0 : add) + ' -' + (rem == null ? 0 : rem), color: base }; }
  if (t === 'rateLimit'){ var win = seg.window || 'five_hour'; var rp = get(session, 'rate_limits', win, 'used_percentage'); if (rp == null) return null; var rv = clamp(Math.round(Number(rp)), 0, 100); var label = (win === 'five_hour') ? '5h' : '7d'; var rc = (seg.color && seg.color !== 'auto') ? seg.color : colorForValue(rv, seg.thresholds); return { text: label + ' ' + rv + '%', color: rc }; }
  if (t === 'outputStyle'){ var ov = get(session, 'output_style', 'name'); return ov ? { text: String(ov), color: base } : null; }
  if (t === 'effort'){ var ev = get(session, 'effort', 'level'); return ev ? { text: 'effort:' + ev, color: base } : null; }
  if (t === 'vimMode'){ var vv = get(session, 'vim', 'mode'); return vv ? { text: String(vv), color: base } : null; }
  if (t === 'pr'){ var num = get(session, 'pr', 'number'); if (num == null) return null; var prs = get(session, 'pr', 'review_state'); return { text: prs ? ('PR #' + num + ' (' + prs + ')') : ('PR #' + num), color: base }; }
  return null;
}

var CONFIG_PATH = path.join(os.homedir(), '.claude', 'agent-pulse', 'statusline.config.json');
var raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (e) { raw = ''; }
var session = {};
try { session = JSON.parse(raw || '{}'); } catch (e) { session = {}; }
var cfg = null;
try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { cfg = null; }
if (!cfg || !Array.isArray(cfg.lines)) {
  cfg = { version: 1, separator: '  ', lines: [{ segments: [{ type: 'model', enabled: true }, { type: 'contextBar', enabled: true, color: 'auto', width: 20, showPercent: true }] }] };
}
var out = [];
var wrapAt = (typeof cfg.maxItemsPerLine === 'number' && cfg.maxItemsPerLine > 0) ? Math.floor(cfg.maxItemsPerLine) : 0;
for (var li = 0; li < cfg.lines.length; li++){
  var row = cfg.lines[li];
  var segs = Array.isArray(row.segments) ? row.segments : [];
  var pieces = [];
  for (var si = 0; si < segs.length; si++){
    if (!segs[si] || !segs[si].enabled) continue;
    var rr = renderSegment(segs[si], session);
    if (rr){
      var ic = segs[si].icon;
      if (ic && typeof ic === 'string' && ic.length) rr.text = ic + ' ' + rr.text;
      pieces.push(colorize(rr.text, rr.color));
    }
  }
  if (pieces.length){
    var sep = (typeof row.separator === 'string') ? row.separator : (typeof cfg.separator === 'string' ? cfg.separator : '  ');
    if (wrapAt > 0 && pieces.length > wrapAt){
      for (var ci = 0; ci < pieces.length; ci += wrapAt){ out.push(pieces.slice(ci, ci + wrapAt).join(sep)); }
    } else {
      out.push(pieces.join(sep));
    }
  }
}
process.stdout.write(out.join(NL));
// Forward the raw session JSON to the Agent Pulse bridge (quota/cost/cache
// analytics). Fire-and-forget on loopback AFTER the line is rendered; every
// failure is swallowed so the status line never breaks when the app is closed.
if (cfg && typeof cfg.bridgeStatusUrl === 'string' && raw) {
  try {
    var url = require('url');
    var u = new url.URL(cfg.bridgeStatusUrl);
    var hdrs = { 'Content-Type': 'application/json' };
    if (typeof cfg.pulseToken === 'string' && cfg.pulseToken) hdrs['x-pulse-token'] = cfg.pulseToken;
    var req = require('http').request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: hdrs });
    req.on('error', function(){});
    req.setTimeout(250, function(){ req.destroy(); });
    req.end(raw);
  } catch (e) {}
}
`;
  }

  private buildStatusLinePythonScript(): string {
    return `#!/usr/bin/env python3
import sys, os, json

ESC = chr(27)
BS = chr(92)
NL = chr(10)
def esc(c): return ESC + '[' + str(c) + 'm'
ANSI = {'white': esc(37), 'gray': esc(90), 'red': esc(31), 'green': esc(32), 'yellow': esc(33), 'blue': esc(34), 'magenta': esc(35), 'cyan': esc(36)}
RESET = esc(0)
DEFAULT_THRESHOLDS = [{'at': 0, 'color': 'green'}, {'at': 50, 'color': 'yellow'}, {'at': 80, 'color': 'red'}]
DEFAULT_COLOR = {'model': 'white', 'cwd': 'cyan', 'projectDir': 'cyan', 'gitBranch': 'magenta', 'repo': 'blue', 'cost': 'gray', 'duration': 'gray', 'linesChanged': 'gray', 'outputStyle': 'gray', 'effort': 'gray', 'vimMode': 'gray', 'pr': 'blue'}

def clamp(n, lo, hi): return max(lo, min(hi, n))

def get(o, *keys):
    c = o
    for k in keys:
        if not isinstance(c, dict):
            return None
        c = c.get(k)
    return c

def basename(p):
    p = str(p)
    i = max(p.rfind('/'), p.rfind(BS))
    return p[i + 1:] if i >= 0 else p

def fmt_dur(ms):
    s = int(ms // 1000)
    if s < 60: return str(s) + 's'
    m = s // 60
    if m < 60:
        return (str(m) + 'm ' + str(s % 60) + 's') if (s % 60) else (str(m) + 'm')
    h = m // 60
    return str(h) + 'h ' + str(m % 60) + 'm'

def color_for_value(pct, th):
    stops = sorted(th if th else DEFAULT_THRESHOLDS, key=lambda x: x['at'])
    c = stops[0]['color'] if stops else 'green'
    for st in stops:
        if pct >= st['at']: c = st['color']
    return 'white' if c == 'auto' else c

def colorize(t, c): return (ANSI.get(c) or ANSI['white']) + t + RESET

def render_segment(seg, session):
    sc = seg.get('color')
    base = sc if (sc and sc != 'auto') else DEFAULT_COLOR.get(seg.get('type'), 'white')
    t = seg.get('type')
    if t == 'model':
        v = get(session, 'model', 'display_name')
        return {'text': str(v), 'color': base} if v else None
    if t == 'contextBar':
        pct = get(session, 'context_window', 'used_percentage')
        if pct is None: return None
        value = clamp(int(round(float(pct))), 0, 100)
        width = clamp(int(seg.get('width') or 20), 4, 40)
        fill = seg.get('fillChar') or '█'
        empty = seg.get('emptyChar') or '░'
        filled = clamp(int(round(value / 100.0 * width)), 0, width)
        bar = '[' + (fill * filled) + (empty * (width - filled)) + ']'
        text = bar if seg.get('showPercent') is False else (bar + ' ' + str(value) + '%')
        color = sc if (sc and sc != 'auto') else color_for_value(value, seg.get('thresholds'))
        return {'text': text, 'color': color}
    if t == 'cwd' or t == 'projectDir':
        if t == 'cwd':
            d = get(session, 'workspace', 'current_dir')
            if d is None: d = get(session, 'cwd')
        else:
            d = get(session, 'workspace', 'project_dir')
        if not d: return None
        text = str(d) if seg.get('basenameOnly') is False else basename(str(d))
        return {'text': text, 'color': base}
    if t == 'gitBranch':
        b = get(session, 'workspace', 'git_worktree')
        if b is None: b = get(session, 'worktree', 'branch')
        return {'text': str(b), 'color': base} if b else None
    if t == 'repo':
        owner = get(session, 'workspace', 'repo', 'owner')
        name = get(session, 'workspace', 'repo', 'name')
        if not name: return None
        return {'text': (str(owner) + '/' + str(name)) if owner else str(name), 'color': base}
    if t == 'cost':
        usd = get(session, 'cost', 'total_cost_usd')
        if usd is None: return None
        return {'text': '$' + format(float(usd), '.4f'), 'color': base}
    if t == 'duration':
        ms = get(session, 'cost', 'total_duration_ms')
        if ms is None: return None
        return {'text': fmt_dur(float(ms)), 'color': base}
    if t == 'linesChanged':
        add = get(session, 'cost', 'total_lines_added')
        rem = get(session, 'cost', 'total_lines_removed')
        if add is None and rem is None: return None
        return {'text': '+' + str(add or 0) + ' -' + str(rem or 0), 'color': base}
    if t == 'rateLimit':
        win = seg.get('window') or 'five_hour'
        rp = get(session, 'rate_limits', win, 'used_percentage')
        if rp is None: return None
        rv = clamp(int(round(float(rp))), 0, 100)
        label = '5h' if win == 'five_hour' else '7d'
        rc = sc if (sc and sc != 'auto') else color_for_value(rv, seg.get('thresholds'))
        return {'text': label + ' ' + str(rv) + '%', 'color': rc}
    if t == 'outputStyle':
        v = get(session, 'output_style', 'name')
        return {'text': str(v), 'color': base} if v else None
    if t == 'effort':
        v = get(session, 'effort', 'level')
        return {'text': 'effort:' + str(v), 'color': base} if v else None
    if t == 'vimMode':
        v = get(session, 'vim', 'mode')
        return {'text': str(v), 'color': base} if v else None
    if t == 'pr':
        num = get(session, 'pr', 'number')
        if num is None: return None
        rs = get(session, 'pr', 'review_state')
        return {'text': ('PR #' + str(num) + ' (' + str(rs) + ')') if rs else ('PR #' + str(num)), 'color': base}
    return None

CONFIG_PATH = os.path.join(os.path.expanduser('~'), '.claude', 'agent-pulse', 'statusline.config.json')
try:
    raw = sys.stdin.read()
except Exception:
    raw = ''
try:
    session = json.loads(raw or '{}')
except Exception:
    session = {}
try:
    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
except Exception:
    cfg = None
if not cfg or not isinstance(cfg.get('lines'), list):
    cfg = {'version': 1, 'separator': '  ', 'lines': [{'segments': [{'type': 'model', 'enabled': True}, {'type': 'contextBar', 'enabled': True, 'color': 'auto', 'width': 20, 'showPercent': True}]}]}
out = []
_mipl = cfg.get('maxItemsPerLine')
wrap_at = int(_mipl) if isinstance(_mipl, (int, float)) and _mipl > 0 else 0
for row in cfg['lines']:
    segs = row.get('segments') if isinstance(row.get('segments'), list) else []
    pieces = []
    for seg in segs:
        if not seg or not seg.get('enabled'): continue
        r = render_segment(seg, session)
        if r:
            ic = seg.get('icon')
            if ic and isinstance(ic, str) and len(ic) > 0:
                r['text'] = ic + ' ' + r['text']
            pieces.append(colorize(r['text'], r['color']))
    if pieces:
        sep = row.get('separator') if isinstance(row.get('separator'), str) else (cfg.get('separator') if isinstance(cfg.get('separator'), str) else '  ')
        if wrap_at > 0 and len(pieces) > wrap_at:
            for ci in range(0, len(pieces), wrap_at):
                out.append(sep.join(pieces[ci:ci + wrap_at]))
        else:
            out.append(sep.join(pieces))
# Write UTF-8 bytes directly: Windows Python defaults stdout to the locale
# codepage (cp1252), which cannot encode the bar glyphs.
sys.stdout.buffer.write(NL.join(out).encode('utf-8'))
sys.stdout.buffer.flush()
# Forward the raw session JSON to the Agent Pulse bridge (quota/cost/cache
# analytics). Runs AFTER the line is flushed; every failure is swallowed so the
# status line never breaks when the app is closed.
try:
    _bsu = cfg.get('bridgeStatusUrl') if cfg else None
    if isinstance(_bsu, str) and raw:
        import urllib.request
        _hdrs = {'Content-Type': 'application/json'}
        _tok = cfg.get('pulseToken') if cfg else None
        if isinstance(_tok, str) and _tok:
            _hdrs['x-pulse-token'] = _tok
        _req = urllib.request.Request(_bsu, data=raw.encode('utf-8'), headers=_hdrs, method='POST')
        urllib.request.urlopen(_req, timeout=0.25).close()
except Exception:
    pass
`;
  }

  private buildStatusLinePowerShellScript(): string {
    return `$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ESC = [char]27
$NL = [char]10
function Esc([int]$c){ return $ESC + '[' + $c + 'm' }
$ANSI = @{ white = (Esc 37); gray = (Esc 90); red = (Esc 31); green = (Esc 32); yellow = (Esc 33); blue = (Esc 34); magenta = (Esc 35); cyan = (Esc 36) }
$RESET = (Esc 0)
$DEFAULT_COLOR = @{ model = 'white'; cwd = 'cyan'; projectDir = 'cyan'; gitBranch = 'magenta'; repo = 'blue'; cost = 'gray'; duration = 'gray'; linesChanged = 'gray'; outputStyle = 'gray'; effort = 'gray'; vimMode = 'gray'; pr = 'blue' }
$DEFAULT_THRESHOLDS = @( @{ at = 0; color = 'green' }, @{ at = 50; color = 'yellow' }, @{ at = 80; color = 'red' } )

function Clamp($n, $lo, $hi){ if ($n -lt $lo){ return $lo }; if ($n -gt $hi){ return $hi }; return $n }

function GetVal($obj, [string[]]$keys){
  $c = $obj
  foreach ($k in $keys){
    if ($null -eq $c){ return $null }
    $prop = $c.PSObject.Properties[$k]
    if ($null -eq $prop){ return $null }
    $c = $prop.Value
  }
  return $c
}

function BaseName($p){
  $p = [string]$p
  $i = [Math]::Max($p.LastIndexOf('/'), $p.LastIndexOf([char]92))
  if ($i -ge 0){ return $p.Substring($i + 1) }
  return $p
}

function FmtDur([double]$ms){
  $s = [int][Math]::Floor($ms / 1000)
  if ($s -lt 60){ return ([string]$s + 's') }
  $m = [int][Math]::Floor($s / 60)
  if ($m -lt 60){ if (($s % 60) -ne 0){ return ([string]$m + 'm ' + [string]($s % 60) + 's') } else { return ([string]$m + 'm') } }
  $h = [int][Math]::Floor($m / 60)
  return ([string]$h + 'h ' + [string]($m % 60) + 'm')
}

function ColorForValue([double]$pct, $th){
  $stops = if ($th){ $th } else { $DEFAULT_THRESHOLDS }
  $stops = $stops | Sort-Object { $_.at }
  $c = 'green'
  if ($stops.Count -gt 0){ $c = $stops[0].color }
  foreach ($s in $stops){ if ($pct -ge $s.at){ $c = $s.color } }
  if ($c -eq 'auto'){ return 'white' }
  return $c
}

function Colorize($t, $c){
  $code = $ANSI[$c]
  if ($null -eq $code){ $code = $ANSI['white'] }
  return $code + $t + $RESET
}

function RenderSegment($seg, $session){
  $base = $seg.color
  if ($null -eq $base -or $base -eq 'auto'){ $base = $DEFAULT_COLOR[$seg.type]; if ($null -eq $base){ $base = 'white' } }
  $t = $seg.type
  if ($t -eq 'model'){ $v = GetVal $session @('model', 'display_name'); if ($v){ return @{ text = [string]$v; color = $base } }; return $null }
  if ($t -eq 'contextBar'){
    $pct = GetVal $session @('context_window', 'used_percentage')
    if ($null -eq $pct){ return $null }
    $value = [int](Clamp ([Math]::Round([double]$pct)) 0 100)
    $w = if ($null -ne $seg.width){ $seg.width } else { 20 }
    $width = [int](Clamp ([Math]::Floor([double]$w)) 4 40)
    $fill = if ($seg.fillChar){ [string]$seg.fillChar } else { '█' }
    $empty = if ($seg.emptyChar){ [string]$seg.emptyChar } else { '░' }
    $filled = [int](Clamp ([Math]::Round($value / 100.0 * $width)) 0 $width)
    $bar = '[' + ($fill * $filled) + ($empty * ($width - $filled)) + ']'
    $text = if ($seg.showPercent -eq $false){ $bar } else { $bar + ' ' + [string]$value + '%' }
    $color = $seg.color
    if ($null -eq $color -or $color -eq 'auto'){ $color = ColorForValue $value $seg.thresholds }
    return @{ text = $text; color = $color }
  }
  if ($t -eq 'cwd' -or $t -eq 'projectDir'){
    if ($t -eq 'cwd'){ $d = GetVal $session @('workspace', 'current_dir'); if ($null -eq $d){ $d = GetVal $session @('cwd') } } else { $d = GetVal $session @('workspace', 'project_dir') }
    if (-not $d){ return $null }
    $text = if ($seg.basenameOnly -eq $false){ [string]$d } else { BaseName $d }
    return @{ text = $text; color = $base }
  }
  if ($t -eq 'gitBranch'){ $b = GetVal $session @('workspace', 'git_worktree'); if ($null -eq $b){ $b = GetVal $session @('worktree', 'branch') }; if ($b){ return @{ text = [string]$b; color = $base } }; return $null }
  if ($t -eq 'repo'){ $owner = GetVal $session @('workspace', 'repo', 'owner'); $name = GetVal $session @('workspace', 'repo', 'name'); if (-not $name){ return $null }; if ($owner){ return @{ text = ([string]$owner + '/' + [string]$name); color = $base } }; return @{ text = [string]$name; color = $base } }
  if ($t -eq 'cost'){ $usd = GetVal $session @('cost', 'total_cost_usd'); if ($null -eq $usd){ return $null }; return @{ text = ('$' + ([double]$usd).ToString('F4')); color = $base } }
  if ($t -eq 'duration'){ $ms = GetVal $session @('cost', 'total_duration_ms'); if ($null -eq $ms){ return $null }; return @{ text = (FmtDur ([double]$ms)); color = $base } }
  if ($t -eq 'linesChanged'){ $add = GetVal $session @('cost', 'total_lines_added'); $rem = GetVal $session @('cost', 'total_lines_removed'); if (($null -eq $add) -and ($null -eq $rem)){ return $null }; $a = if ($null -ne $add){ $add } else { 0 }; $r = if ($null -ne $rem){ $rem } else { 0 }; return @{ text = ('+' + [string]$a + ' -' + [string]$r); color = $base } }
  if ($t -eq 'rateLimit'){ $win = if ($seg.window){ [string]$seg.window } else { 'five_hour' }; $rp = GetVal $session @('rate_limits', $win, 'used_percentage'); if ($null -eq $rp){ return $null }; $rv = [int](Clamp ([Math]::Round([double]$rp)) 0 100); $label = if ($win -eq 'five_hour'){ '5h' } else { '7d' }; $rc = $seg.color; if ($null -eq $rc -or $rc -eq 'auto'){ $rc = ColorForValue $rv $seg.thresholds }; return @{ text = ($label + ' ' + [string]$rv + '%'); color = $rc } }
  if ($t -eq 'outputStyle'){ $v = GetVal $session @('output_style', 'name'); if ($v){ return @{ text = [string]$v; color = $base } }; return $null }
  if ($t -eq 'effort'){ $v = GetVal $session @('effort', 'level'); if ($v){ return @{ text = ('effort:' + [string]$v); color = $base } }; return $null }
  if ($t -eq 'vimMode'){ $v = GetVal $session @('vim', 'mode'); if ($v){ return @{ text = [string]$v; color = $base } }; return $null }
  if ($t -eq 'pr'){ $num = GetVal $session @('pr', 'number'); if ($null -eq $num){ return $null }; $rs = GetVal $session @('pr', 'review_state'); if ($rs){ return @{ text = ('PR #' + [string]$num + ' (' + [string]$rs + ')'); color = $base } }; return @{ text = ('PR #' + [string]$num); color = $base } }
  return $null
}

$CONFIG_PATH = Join-Path (Join-Path (Join-Path $HOME '.claude') 'agent-pulse') 'statusline.config.json'
$raw = [Console]::In.ReadToEnd()
try { $session = $raw | ConvertFrom-Json } catch { $session = $null }
if ($null -eq $session){ $session = (New-Object PSObject) }
$cfg = $null
try { if (Test-Path $CONFIG_PATH){ $cfg = (Get-Content -Raw -Encoding UTF8 -Path $CONFIG_PATH) | ConvertFrom-Json } } catch { $cfg = $null }
if ($null -eq $cfg -or $null -eq $cfg.lines){
  $cfg = ('{"version":1,"separator":"  ","lines":[{"segments":[{"type":"model","enabled":true},{"type":"contextBar","enabled":true,"color":"auto","width":20,"showPercent":true}]}]}' | ConvertFrom-Json)
}
$out = @()
$wrapAt = 0
if ($null -ne $cfg.maxItemsPerLine){ try { $w = [int]$cfg.maxItemsPerLine; if ($w -gt 0){ $wrapAt = $w } } catch { } }
foreach ($row in $cfg.lines){
  $segs = $row.segments
  $pieces = @()
  foreach ($seg in $segs){
    if ($null -eq $seg -or -not $seg.enabled){ continue }
    $r = RenderSegment $seg $session
    if ($null -ne $r){
      $ic = $seg.icon
      if ($ic -and ($ic -is [string]) -and $ic.Length -gt 0){ $r.text = [string]$ic + ' ' + $r.text }
      $pieces += (Colorize $r.text $r.color)
    }
  }
  if ($pieces.Count -gt 0){
    $sep = $row.separator
    if ($null -eq $sep){ $sep = $cfg.separator }
    if ($null -eq $sep){ $sep = '  ' }
    if ($wrapAt -gt 0 -and $pieces.Count -gt $wrapAt){
      for ($ci = 0; $ci -lt $pieces.Count; $ci += $wrapAt){
        $end = [Math]::Min($ci + $wrapAt, $pieces.Count) - 1
        $out += (($pieces[$ci..$end]) -join $sep)
      }
    } else {
      $out += ($pieces -join $sep)
    }
  }
}
[Console]::Out.Write($out -join $NL)
# Forward the raw session JSON to the Agent Pulse bridge (quota/cost/cache
# analytics). Runs AFTER the line is written; every failure is swallowed so the
# status line never breaks when the app is closed. WebRequest (not
# Invoke-RestMethod) so the timeout can sit well under a second.
if ($null -ne $cfg -and $null -ne $cfg.PSObject.Properties['bridgeStatusUrl'] -and $raw){
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($raw)
    $wr = [System.Net.WebRequest]::Create([string]$cfg.bridgeStatusUrl)
    $wr.Method = 'POST'
    $wr.ContentType = 'application/json; charset=utf-8'
    if ($null -ne $cfg.PSObject.Properties['pulseToken']) { $wr.Headers.Add('x-pulse-token', [string]$cfg.pulseToken) }
    $wr.Timeout = 500
    $wr.ReadWriteTimeout = 500
    $rs = $wr.GetRequestStream()
    $rs.Write($bytes, 0, $bytes.Length)
    $rs.Close()
    $wr.GetResponse().Close()
  } catch { }
}
`;
  }
}

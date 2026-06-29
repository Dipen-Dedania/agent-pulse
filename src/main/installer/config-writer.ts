import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { BRIDGE_URL } from '../bridge/config';
import { ToolId, StatusLineConfig, StatusLineRuntime, StatusLineState } from '../../common/types';

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

  // Write the projected config the deployed script reads at runtime.
  public writeStatusLineConfig(cfg: StatusLineConfig): string {
    const dir = this.statusLineDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = this.statusLineConfigPath();
    fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
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
`;
  }
}

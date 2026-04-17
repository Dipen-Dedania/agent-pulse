import { ToolId } from './types';

export interface HookInfo {
  mechanism: string;       // e.g. "HTTP Hook", "MCP Server"
  configFile: string;      // e.g. "~/.claude/settings.json"
  description: string;     // human-readable explanation
  snippet: string;         // JSON / config snippet shown in modal
  troubleshooting: string[]; // steps to try when events aren't reaching the bridge
}

export interface ToolMeta {
  label: string;
  icon: string; // path relative to public/assets
  hookInfo: HookInfo;
}

const COMMON_TROUBLESHOOTING = [
  'Confirm Agent Pulse is running — the status bridge must be listening on localhost:4242.',
  'Check your firewall or VPN — localhost requests should not be blocked.',
  'Reinstall the hook from this Settings screen, then restart the tool.',
];

export const TOOL_META: Record<ToolId, ToolMeta> = {
  'claude-code': {
    label: 'Claude Code',
    icon: './assets/claude.png',
    hookInfo: {
      mechanism: 'HTTP Hook',
      configFile: '~/.claude/settings.json',
      description:
        'Agent Pulse registers HTTP lifecycle hooks in Claude Code\'s global settings file. ' +
        'Claude Code POSTs event JSON directly to the bridge on PreToolUse, Stop, and StopFailure — ' +
        'no shell script or curl required, making it cross-platform safe.',
      snippet: JSON.stringify({
        hooks: {
          PreToolUse:  [{ matcher: '*', hooks: [{ type: 'http', url: 'http://localhost:4242/event', timeout: 5 }] }],
          Stop:        [{ hooks: [{ type: 'http', url: 'http://localhost:4242/event', timeout: 5 }] }],
          StopFailure: [{ hooks: [{ type: 'http', url: 'http://localhost:4242/event', timeout: 5 }] }],
        },
      }, null, 2),
      troubleshooting: [
        'Start a new Claude Code session — hooks are only registered when the CLI starts.',
        'Open ~/.claude/settings.json and confirm the http hook entries under PreToolUse, Stop, and StopFailure are present.',
        ...COMMON_TROUBLESHOOTING,
      ],
    },
  },
  'cursor': {
    label: 'Cursor',
    icon: './assets/cursor.png',
    hookInfo: {
      mechanism: 'Shell Hook',
      configFile: '~/.cursor/hooks.json',
      description:
        'Agent Pulse installs a shell hook script and registers it in ~/.cursor/hooks.json. ' +
        'Cursor spawns the script on sessionStart, preToolUse, postToolUse, stop, and failure events, ' +
        'passing event JSON via stdin. The script forwards it to the bridge, which maps events into ' +
        'Waiting, Working, Idle, and Error states.',
      snippet: JSON.stringify({
        version: 1,
        hooks: {
          preToolUse:        [{ command: '~/.cursor/hooks/agent-pulse.sh', timeout: 5 }],
          postToolUse:       [{ command: '~/.cursor/hooks/agent-pulse.sh', timeout: 5 }],
          postToolUseFailure:[{ command: '~/.cursor/hooks/agent-pulse.sh', timeout: 5 }],
          sessionStart:      [{ command: '~/.cursor/hooks/agent-pulse.sh', timeout: 5 }],
          sessionEnd:        [{ command: '~/.cursor/hooks/agent-pulse.sh', timeout: 5 }],
          stop:              [{ command: '~/.cursor/hooks/agent-pulse.sh', timeout: 5 }],
        },
      }, null, 2),
      troubleshooting: [
        'Fully quit and relaunch Cursor — hook registrations are loaded at startup.',
        'On Windows, ensure Git Bash or WSL is on PATH so the .sh hook can execute.',
        'Verify ~/.cursor/hooks/agent-pulse.sh exists and is executable (chmod +x on macOS/Linux).',
        ...COMMON_TROUBLESHOOTING,
      ],
    },
  },
  'vscode-copilot': {
    label: 'GitHub Copilot',
    icon: './assets/githubcopilot.png',
    hookInfo: {
      mechanism: 'Shell Hook',
      configFile: '.github/hooks/agent-pulse-hooks.json',
      description:
        'Agent Pulse installs a hook script and registers it in .github/hooks/agent-pulse-hooks.json ' +
        'in your workspace. VS Code Copilot spawns the script on all lifecycle events (SessionStart, ' +
        'UserPromptSubmit, PreToolUse, PostToolUse, PreCompact, SubagentStart, SubagentStop, Stop), ' +
        'passing event JSON via stdin. The script forwards it to the bridge and returns ' +
        '{"continue":true} so Copilot proceeds normally.',
      snippet: JSON.stringify({
        hooks: {
          SessionStart:     [{ type: 'command', command: './.github/hooks/agent-pulse.sh', windows: 'powershell -ExecutionPolicy Bypass -File ".github\\hooks\\agent-pulse.ps1"', timeout: 5 }],
          UserPromptSubmit: [{ type: 'command', command: './.github/hooks/agent-pulse.sh', windows: 'powershell -ExecutionPolicy Bypass -File ".github\\hooks\\agent-pulse.ps1"', timeout: 5 }],
          PreToolUse:       [{ type: 'command', command: './.github/hooks/agent-pulse.sh', windows: 'powershell -ExecutionPolicy Bypass -File ".github\\hooks\\agent-pulse.ps1"', timeout: 5 }],
          PostToolUse:      [{ type: 'command', command: './.github/hooks/agent-pulse.sh', windows: 'powershell -ExecutionPolicy Bypass -File ".github\\hooks\\agent-pulse.ps1"', timeout: 5 }],
          PreCompact:       [{ type: 'command', command: './.github/hooks/agent-pulse.sh', windows: 'powershell -ExecutionPolicy Bypass -File ".github\\hooks\\agent-pulse.ps1"', timeout: 5 }],
          SubagentStart:    [{ type: 'command', command: './.github/hooks/agent-pulse.sh', windows: 'powershell -ExecutionPolicy Bypass -File ".github\\hooks\\agent-pulse.ps1"', timeout: 5 }],
          SubagentStop:     [{ type: 'command', command: './.github/hooks/agent-pulse.sh', windows: 'powershell -ExecutionPolicy Bypass -File ".github\\hooks\\agent-pulse.ps1"', timeout: 5 }],
          Stop:             [{ type: 'command', command: './.github/hooks/agent-pulse.sh', windows: 'powershell -ExecutionPolicy Bypass -File ".github\\hooks\\agent-pulse.ps1"', timeout: 5 }],
        },
      }, null, 2),
      troubleshooting: [
        'Reload the VS Code window (Ctrl+Shift+P → "Reload Window") after installing the hook.',
        'Confirm the Copilot Chat extension is enabled for the current workspace.',
        'On Windows, the PowerShell script runs with ExecutionPolicy Bypass — if blocked, allow it for the current user.',
        ...COMMON_TROUBLESHOOTING,
      ],
    },
  },
  'kiro': {
    label: 'Kiro',
    icon: './assets/kiro.png',
    hookInfo: {
      mechanism: 'Shell Hook',
      configFile: '.kiro/hooks/agent-pulse.kiro.hook',
      description:
        'Agent Pulse writes a shell hook script and registers it in .kiro/hooks/agent-pulse.kiro.hook ' +
        'in your project (or ~/.kiro/hooks/ globally). Kiro spawns the script on agentSpawn, ' +
        'userPromptSubmit, preToolUse, and postToolUse events, passing event JSON via stdin. ' +
        'The script forwards it to the bridge, mapping events into Waiting, Working, and Idle states.',
      snippet: JSON.stringify({
        hooks: {
          agentSpawn:       [{ command: '.kiro/hooks-scripts/agent-pulse.sh' }],
          userPromptSubmit: [{ command: '.kiro/hooks-scripts/agent-pulse.sh' }],
          preToolUse:       [{ command: '.kiro/hooks-scripts/agent-pulse.sh' }],
          postToolUse:      [{ command: '.kiro/hooks-scripts/agent-pulse.sh' }],
        },
      }, null, 2),
      troubleshooting: [
        'Restart Kiro after installing the hook for the changes to take effect.',
        'Verify .kiro/hooks-scripts/agent-pulse.sh is executable.',
        'If running project-local, open the workspace where you installed the hook — project hooks do not apply globally.',
        ...COMMON_TROUBLESHOOTING,
      ],
    },
  },
  'gemini-cli': {
    label: 'Gemini CLI',
    icon: './assets/gemini.png',
    hookInfo: {
      mechanism: 'Shell Hook',
      configFile: '~/.gemini/settings.json',
      description:
        'Agent Pulse installs a shell hook script and registers it in ~/.gemini/settings.json. ' +
        'Gemini CLI spawns the script on SessionStart, SessionEnd, BeforeAgent, AfterAgent, BeforeTool, ' +
        'AfterTool, and Notification events, passing event JSON via stdin. ' +
        'The script injects a tool identifier and forwards the payload to the bridge.',
      snippet: JSON.stringify({
        hooks: {
          SessionStart: [{ matcher: '*', hooks: [{ name: 'agent-pulse', type: 'command', command: '~/.gemini/hooks/agent-pulse.sh', timeout: 5000 }] }],
          SessionEnd:   [{ matcher: '*', hooks: [{ name: 'agent-pulse', type: 'command', command: '~/.gemini/hooks/agent-pulse.sh', timeout: 5000 }] }],
          BeforeAgent:  [{ matcher: '*', hooks: [{ name: 'agent-pulse', type: 'command', command: '~/.gemini/hooks/agent-pulse.sh', timeout: 5000 }] }],
          AfterAgent:   [{ matcher: '*', hooks: [{ name: 'agent-pulse', type: 'command', command: '~/.gemini/hooks/agent-pulse.sh', timeout: 5000 }] }],
          BeforeTool:   [{ matcher: '*', hooks: [{ name: 'agent-pulse', type: 'command', command: '~/.gemini/hooks/agent-pulse.sh', timeout: 5000 }] }],
          AfterTool:    [{ matcher: '*', hooks: [{ name: 'agent-pulse', type: 'command', command: '~/.gemini/hooks/agent-pulse.sh', timeout: 5000 }] }],
          Notification: [{ matcher: '*', hooks: [{ name: 'agent-pulse', type: 'command', command: '~/.gemini/hooks/agent-pulse.sh', timeout: 5000 }] }],
        },
      }, null, 2),
      troubleshooting: [
        'Restart the Gemini CLI — existing sessions will not pick up new hook registrations.',
        'Open ~/.gemini/settings.json and confirm the hook entries are present and point to an executable script.',
        'If you use multiple shells, ensure the ~/.gemini/hooks/agent-pulse.sh file has execute permissions.',
        ...COMMON_TROUBLESHOOTING,
      ],
    },
  },
  'openai-codex': {
    label: 'OpenAI Codex',
    icon: './assets/codex.png',
    hookInfo: {
      mechanism: 'Shell Hook',
      configFile: '~/.codex/hooks.json',
      description:
        'Agent Pulse installs a shell hook script and registers it in ~/.codex/hooks.json, then ' +
        'enables the codex_hooks feature flag in ~/.codex/config.toml. Codex spawns the script on ' +
        'SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, and Stop events, passing event ' +
        'JSON via stdin. The script forwards it to the bridge, mapping events into Waiting, Working, and Idle states.',
      snippet: JSON.stringify({
        hooks: {
          SessionStart:     [{ matcher: '*', hooks: [{ type: 'command', command: '~/.codex/hooks/agent-pulse.sh', timeout: 10 }] }],
          UserPromptSubmit: [{ matcher: '*', hooks: [{ type: 'command', command: '~/.codex/hooks/agent-pulse.sh', timeout: 10 }] }],
          PreToolUse:       [{ matcher: '*', hooks: [{ type: 'command', command: '~/.codex/hooks/agent-pulse.sh', timeout: 10 }] }],
          PostToolUse:      [{ matcher: '*', hooks: [{ type: 'command', command: '~/.codex/hooks/agent-pulse.sh', timeout: 10 }] }],
          Stop:             [{ matcher: '*', hooks: [{ type: 'command', command: '~/.codex/hooks/agent-pulse.sh', timeout: 10 }] }],
        },
      }, null, 2),
      troubleshooting: [
        'Restart the Codex CLI after installing the hook.',
        'Confirm codex_hooks = true is set in ~/.codex/config.toml.',
        'Verify ~/.codex/hooks/agent-pulse.sh is executable.',
        ...COMMON_TROUBLESHOOTING,
      ],
    },
  },
};

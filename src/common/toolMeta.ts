import { ToolId } from './types';

export interface HookInfo {
  mechanism: string;       // e.g. "HTTP Hook", "MCP Server"
  configFile: string;      // e.g. "~/.claude/settings.json"
  description: string;     // human-readable explanation
  snippet: string;         // JSON / config snippet shown in modal
}

export interface ToolMeta {
  label: string;
  icon: string; // path relative to public/assets
  hookInfo: HookInfo;
}

export const TOOL_META: Record<ToolId, ToolMeta> = {
  'claude-code': {
    label: 'Claude Code',
    icon: '/assets/claude.png',
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
    },
  },
  'cursor': {
    label: 'Cursor',
    icon: '/assets/cursor.png',
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
    },
  },
  'vscode-copilot': {
    label: 'GitHub Copilot',
    icon: '/assets/githubcopilot.png',
    hookInfo: {
      mechanism: 'Shell Hook',
      configFile: '.github/hooks/agent-pulse-hooks.json',
      description:
        'Agent Pulse installs a hook script and registers it in .github/hooks/agent-pulse-hooks.json ' +
        'in your workspace. VS Code Copilot spawns the script on SessionStart, UserPromptSubmit, ' +
        'PreToolUse, PostToolUse, and Stop events, passing event JSON via stdin. To activate, point ' +
        'VS Code\'s chat.hookFilesLocations setting at that directory, or use the /hooks command in chat.',
      snippet: JSON.stringify({
        hooks: {
          SessionStart:     [{ type: 'command', command: '.github/hooks/agent-pulse.sh', timeout: 5 }],
          UserPromptSubmit: [{ type: 'command', command: '.github/hooks/agent-pulse.sh', timeout: 5 }],
          PreToolUse:       [{ type: 'command', command: '.github/hooks/agent-pulse.sh', timeout: 5 }],
          PostToolUse:      [{ type: 'command', command: '.github/hooks/agent-pulse.sh', timeout: 5 }],
          Stop:             [{ type: 'command', command: '.github/hooks/agent-pulse.sh', timeout: 5 }],
        },
      }, null, 2),
    },
  },
  'kiro': {
    label: 'Kiro',
    icon: '/assets/kiro.png',
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
    },
  },
  'openai-codex': {
    label: 'OpenAI Codex',
    icon: '/assets/codex.png',
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
    },
  },
};

// Extracts the raw shell command string out of a hook's PreToolUse payload.
//
// Each agentic tool ships its bash command in a slightly different field, so
// this module owns the per-tool extraction logic. Returning null is the
// "no command here" signal — the bridge then skips guardrail evaluation.

import { ToolId } from '../../common/types';

// Tool names that we should treat as "this is a shell command" calls.
// Anything else (Read, Write, MCP, etc.) is irrelevant to a shell-command
// guardrail and we return null.
const BASH_TOOL_NAMES = new Set([
  'bash', 'shell', 'terminal', 'run_command', 'run_in_terminal',
  'execute_command', 'bash_command', 'cli',
  // Grok's shell tool.
  'run_terminal_command',
]);

function isShellTool(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  return BASH_TOOL_NAMES.has(name.toLowerCase());
}

// Try a list of "x.y.z" paths against `obj` and return the first string found.
function pickString(obj: any, paths: string[]): string | null {
  for (const path of paths) {
    const segments = path.split('.');
    let cur: any = obj;
    for (const seg of segments) {
      if (cur == null) { cur = undefined; break; }
      cur = cur[seg];
    }
    if (typeof cur === 'string' && cur.length > 0) return cur;
  }
  return null;
}

// Returns the raw command string if the payload is a PreToolUse for a shell
// tool we recognise, otherwise null. Defensive against shape changes — we try
// several known field paths per tool before giving up.
export function extractCommand(toolId: ToolId, data: any): string | null {
  if (!data || typeof data !== 'object') return null;

  switch (toolId) {
    case 'claude-code':
    case 'vscode-copilot':
    case 'openai-codex':
    case 'kiro': {
      // Claude Code & co. all share roughly the same PreToolUse shape:
      //   { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command, description } }
      if (!isShellTool(data.tool_name)) return null;
      return pickString(data, [
        'tool_input.command',
        'toolInput.command',
        'input.command',
        'parameters.command',
      ]);
    }

    case 'grok': {
      // Grok uses camelCase: { toolName: 'run_terminal_command',
      //   toolInput: { command } }. Keep snake_case fallbacks for resilience.
      const toolName = data.toolName ?? data.tool_name;
      if (!isShellTool(toolName)) return null;
      return pickString(data, [
        'toolInput.command',
        'tool_input.command',
        'input.command',
        'parameters.command',
      ]);
    }

    case 'cursor': {
      // Cursor's hook payload (camelCase events) — empirically the bash tool
      // is sent as `tool_name: 'Terminal'` / 'run_terminal_cmd' / similar with
      // command nested under tool_input.
      if (!isShellTool(data.tool_name)) return null;
      return pickString(data, [
        'tool_input.command',
        'tool_input.cmd',
        'toolInput.command',
      ]);
    }

    case 'antigravity-cli': {
      // Antigravity nests its tool info under `toolCall` per the bridge's
      // existing normalizer (server.ts:262). The command lives in toolCall.args
      // or toolCall.arguments depending on the build.
      const toolName = data.toolCall?.name ?? data.tool_name;
      if (!isShellTool(toolName)) return null;
      return pickString(data, [
        'toolCall.args.command',
        'toolCall.arguments.command',
        'toolCall.input.command',
        'tool_input.command',
      ]);
    }
  }

  return null;
}

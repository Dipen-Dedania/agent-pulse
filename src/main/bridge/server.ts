import http from 'http';
import { StatusStateManager } from './state-manager';
import { ToolId, AgentState } from '../../common/types';

// Claude Code hook event names → AgentState
// Stop = agent finished its turn and is waiting for user input (amber)
// SessionEnd = user ended the session entirely (grey/idle)
const CC_WAITING_EVENTS = new Set(['UserPromptSubmit', 'Stop']);
const CC_WORKING_EVENTS = new Set(['PreToolUse', 'SubagentStart']);
const CC_IDLE_EVENTS    = new Set(['PostToolUse', 'SessionEnd', 'TeammateIdle']);
const CC_ERROR_EVENTS   = new Set(['StopFailure', 'PostToolUseFailure']);

// Codex hook event names → AgentState (PascalCase, same as CC but detected via turn_id)
const CODEX_WAITING_EVENTS = new Set(['SessionStart', 'UserPromptSubmit']);
const CODEX_WORKING_EVENTS = new Set(['PreToolUse']);
const CODEX_IDLE_EVENTS    = new Set(['PostToolUse', 'Stop']);

// Cursor hook event names → AgentState (camelCase per Cursor docs)
const CURSOR_WAITING_EVENTS = new Set(['sessionStart']);
const CURSOR_WORKING_EVENTS = new Set(['preToolUse', 'subagentStart']);
const CURSOR_IDLE_EVENTS    = new Set(['postToolUse', 'sessionEnd', 'stop', 'subagentStop']);
const CURSOR_ERROR_EVENTS   = new Set(['postToolUseFailure']);

// VS Code Copilot hook event names → AgentState
// Uses camelCase hookEventName field (distinguishes it from CC/Codex's hook_event_name)
const COPILOT_WAITING_EVENTS = new Set(['SessionStart', 'UserPromptSubmit']);
const COPILOT_WORKING_EVENTS = new Set(['PreToolUse', 'SubagentStart']);
const COPILOT_IDLE_EVENTS    = new Set(['PostToolUse', 'Stop', 'SubagentStop']);

// Kiro hook event names → AgentState (hook_event_name field, has kiro_version or source='kiro')
const KIRO_WAITING_EVENTS = new Set(['agentSpawn', 'userPromptSubmit']);
const KIRO_WORKING_EVENTS = new Set(['preToolUse']);
const KIRO_IDLE_EVENTS    = new Set(['postToolUse']);

const VALID_TOOLS: ToolId[] = ['claude-code', 'cursor', 'vscode-copilot', 'openai-codex', 'kiro'];
const VALID_STATES: AgentState[] = ['working', 'waiting', 'idle', 'error'];

export class StatusBridgeServer {
  private server: http.Server;
  private stateManager: StatusStateManager;
  private port: number = 4242;

  constructor(stateManager: StatusStateManager) {
    this.stateManager = stateManager;
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public start() {
    this.server.listen(this.port, () => {
      console.log(`Status Bridge running on port ${this.port}`);
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'POST' && req.url === '/event') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          console.log(`[Bridge] Raw body received: ${body}`);
          const data = JSON.parse(body);
          const normalized = this.normalizePayload(data);

          if (!normalized) {
            console.warn(`[Bridge] Unrecognized event payload: ${JSON.stringify(data)}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unrecognized event format' }));
            return;
          }

          const { toolId, state, payload } = normalized;
          console.log(`[Bridge] Normalized event: toolId=${toolId} state=${state} payload=${JSON.stringify(payload)}`);
          this.stateManager.updateStatus(toolId, state, payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (e) {
          console.error(`JSON parse error: ${e}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    } else if (req.url === '/mcp') {
      this.handleMcp(req, res);
    } else {
      res.writeHead(404);
      res.end();
    }
  }

  /**
   * Minimal MCP endpoint for Cursor.
   *
   * Cursor connects via HTTP+JSON-RPC (not SSE for simple tool servers).
   * We expose one tool — `ping` — whose sole purpose is to let Cursor signal
   * that the agent is active. Cursor calls it at the start and end of agent
   * turns, so we map the call direction to working/idle state.
   */
  private handleMcp(req: http.IncomingMessage, res: http.ServerResponse) {
    if (req.method === 'GET') {
      // MCP discovery — return a minimal server manifest
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'agent-pulse',
        version: '1.0.0',
        tools: [
          {
            name: 'agent_working',
            description: 'Call at the start of an agent turn to signal the agent is working.',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
          {
            name: 'agent_idle',
            description: 'Call at the end of an agent turn to signal the agent is idle.',
            inputSchema: { type: 'object', properties: {}, required: [] },
          },
        ],
      }));
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const rpc = JSON.parse(body);
          console.log(`[Bridge/MCP] JSON-RPC call: ${JSON.stringify(rpc)}`);
          const toolName: string = rpc?.params?.name ?? rpc?.method ?? '';

          if (toolName === 'agent_working') {
            this.stateManager.updateStatus('cursor', 'working', {});
          } else if (toolName === 'agent_idle') {
            this.stateManager.updateStatus('cursor', 'idle', {});
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: { content: [{ type: 'text', text: 'ok' }] } }));
        } catch (e) {
          console.error(`[Bridge/MCP] parse error: ${e}`);
          res.writeHead(400);
          res.end();
        }
      });
      return;
    }

    res.writeHead(405);
    res.end();
  }

  /**
   * Accepts six formats:
   *
   * 1. Our own format (curl tests):
   *    { toolId: 'claude-code', state: 'working', payload?: {...} }
   *
   * 2. Claude Code's native hook payload (PascalCase event names, has session_id, no turn_id):
   *    { hook_event_name: 'PreToolUse', session_id: '...', tool_name: '...', ... }
   *
   * 3. Codex native hook payload (PascalCase event names, has turn_id):
   *    { hook_event_name: 'PreToolUse', session_id: '...', turn_id: '...', cwd: '...', ... }
   *    Distinguished from Claude Code by presence of turn_id.
   *
   * 4. Cursor's native hook payload (camelCase event names, has cursor_version or conversation_id):
   *    { hook_event_name: 'preToolUse', conversation_id: '...', cursor_version: '...', ... }
   *
   * 5. VS Code Copilot hook payload (camelCase field name hookEventName, not hook_event_name):
   *    { hookEventName: 'PreToolUse', sessionId: '...', cwd: '...', timestamp: '...', ... }
   *
   * 6. Kiro hook payload (camelCase event names, has kiro_version or agentSpawn is unique to Kiro):
   *    { hook_event_name: 'agentSpawn', session_id: '...', cwd: '...', ... }
   *    Distinguished from Cursor by kiro_version field or agentSpawn event name.
   */
  private normalizePayload(data: any): { toolId: ToolId; state: AgentState; payload: any } | null {
    // Format 1 — explicit toolId + state
    if (data.toolId && data.state) {
      if (VALID_TOOLS.includes(data.toolId) && VALID_STATES.includes(data.state)) {
        return { toolId: data.toolId, state: data.state, payload: data.payload ?? {} };
      }
      return null;
    }

    // Format 5 — VS Code Copilot (uses camelCase hookEventName, not hook_event_name)
    if (data.hookEventName) {
      const eventName: string = data.hookEventName;
      let state: AgentState;
      if (COPILOT_WAITING_EVENTS.has(eventName))      state = 'waiting';
      else if (COPILOT_WORKING_EVENTS.has(eventName)) state = 'working';
      else if (COPILOT_IDLE_EVENTS.has(eventName))    state = 'idle';
      else {
        console.log(`Ignoring unmapped Copilot event: ${eventName}`);
        return null;
      }
      return {
        toolId: 'vscode-copilot',
        state,
        payload: {
          sessionId:   data.sessionId,
          taskSummary: data.tool_name ? `Tool: ${data.tool_name}` : undefined,
        },
      };
    }

    if (data.hook_event_name) {
      const eventName: string = data.hook_event_name;

      // Format 6 — Kiro native hook (has kiro_version, or camelCase event unique to Kiro like agentSpawn)
      if (data.kiro_version !== undefined || eventName === 'agentSpawn') {
        let state: AgentState;
        if (KIRO_WAITING_EVENTS.has(eventName))      state = 'waiting';
        else if (KIRO_WORKING_EVENTS.has(eventName)) state = 'working';
        else if (KIRO_IDLE_EVENTS.has(eventName))    state = 'idle';
        else {
          console.log(`Ignoring unmapped Kiro event: ${eventName}`);
          return null;
        }
        return {
          toolId: 'kiro',
          state,
          payload: {
            sessionId:   data.session_id,
            taskSummary: data.tool_name ? `Tool: ${data.tool_name}` : undefined,
          },
        };
      }

      // Format 4 — Cursor native hook (camelCase event name or has cursor_version/conversation_id)
      if (data.cursor_version !== undefined || (data.conversation_id && data.session_id === undefined)) {
        let state: AgentState;
        if (CURSOR_WAITING_EVENTS.has(eventName))      state = 'waiting';
        else if (CURSOR_WORKING_EVENTS.has(eventName)) state = 'working';
        else if (CURSOR_IDLE_EVENTS.has(eventName))    state = 'idle';
        else if (CURSOR_ERROR_EVENTS.has(eventName))   state = 'error';
        else {
          console.log(`Ignoring unmapped Cursor event: ${eventName}`);
          return null;
        }
        return {
          toolId: 'cursor',
          state,
          payload: {
            sessionId:    data.conversation_id,
            taskSummary:  data.tool_name ? `Tool: ${data.tool_name}` : undefined,
            errorMessage: data.error_message,
          },
        };
      }

      // Format 3 — Codex native hook (has turn_id)
      if (data.turn_id !== undefined) {
        let state: AgentState;
        if (CODEX_WAITING_EVENTS.has(eventName))      state = 'waiting';
        else if (CODEX_WORKING_EVENTS.has(eventName)) state = 'working';
        else if (CODEX_IDLE_EVENTS.has(eventName))    state = 'idle';
        else {
          console.log(`Ignoring unmapped Codex event: ${eventName}`);
          return null;
        }
        return {
          toolId: 'openai-codex',
          state,
          payload: {
            sessionId:   data.session_id,
            taskSummary: data.tool_name ? `Tool: ${data.tool_name}` : undefined,
          },
        };
      }

      // Format 2 — Claude Code native hook payload (has session_id, no turn_id)
      let state: AgentState;
      if (CC_WAITING_EVENTS.has(eventName))      state = 'waiting';
      else if (CC_WORKING_EVENTS.has(eventName)) state = 'working';
      else if (CC_IDLE_EVENTS.has(eventName))    state = 'idle';
      else if (CC_ERROR_EVENTS.has(eventName))   state = 'error';
      else {
        console.log(`Ignoring unmapped Claude Code event: ${eventName}`);
        return null;
      }

      return {
        toolId: 'claude-code',
        state,
        payload: {
          sessionId:    data.session_id,
          taskSummary:  data.tool_name ? `Tool: ${data.tool_name}` : undefined,
          errorMessage: data.error,
        },
      };
    }

    return null;
  }
}

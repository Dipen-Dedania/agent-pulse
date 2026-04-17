import http from 'http';
import { StatusStateManager } from './state-manager';
import { ToolId, AgentState } from '../../common/types';

// Claude Code hook event names → AgentState
// Stop = agent finished its turn and is waiting for user input / permission (amber)
// SessionEnd = user ended the session entirely (grey/idle)
const CC_WAITING_EVENTS = new Set(['Stop']);
const CC_WORKING_EVENTS = new Set(['UserPromptSubmit', 'PreToolUse', 'SubagentStart']);
const CC_IDLE_EVENTS    = new Set(['PostToolUse', 'SessionEnd', 'TeammateIdle']);
const CC_ERROR_EVENTS   = new Set(['StopFailure', 'PostToolUseFailure']);

// Codex hook event names → AgentState (PascalCase, same as CC but detected via turn_id)
const CODEX_WAITING_EVENTS = new Set(['Stop']);
const CODEX_WORKING_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse']);
const CODEX_IDLE_EVENTS    = new Set(['PostToolUse']);

// Cursor hook event names → AgentState (camelCase per Cursor docs)
const CURSOR_WAITING_EVENTS = new Set(['stop']);
const CURSOR_WORKING_EVENTS = new Set(['sessionStart', 'preToolUse', 'subagentStart']);
const CURSOR_IDLE_EVENTS    = new Set(['postToolUse', 'sessionEnd', 'subagentStop']);
const CURSOR_ERROR_EVENTS   = new Set(['postToolUseFailure']);

// VS Code Copilot hook event names → AgentState
// Uses camelCase hookEventName field (distinguishes it from CC/Codex's hook_event_name)
const COPILOT_WAITING_EVENTS = new Set(['Stop']);
const COPILOT_WORKING_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PreToolUse', 'SubagentStart']);
const COPILOT_IDLE_EVENTS    = new Set(['PostToolUse', 'SubagentStop']);

// Kiro hook event names → AgentState (hook_event_name field, has kiro_version or source='kiro')
const KIRO_WAITING_EVENTS = new Set<string>([]);
const KIRO_WORKING_EVENTS = new Set(['agentSpawn', 'userPromptSubmit', 'preToolUse']);
const KIRO_IDLE_EVENTS    = new Set(['postToolUse']);

// Gemini CLI hook event names → AgentState (detected via _ap_tool: 'gemini-cli' injected by our hook script)
const GEMINI_WORKING_EVENTS = new Set(['SessionStart', 'BeforeAgent', 'BeforeTool', 'BeforeModel', 'BeforeToolSelection']);
const GEMINI_WAITING_EVENTS = new Set(['AfterAgent', 'Notification']);
const GEMINI_IDLE_EVENTS    = new Set(['SessionEnd', 'AfterTool', 'AfterModel']);

const VALID_TOOLS: ToolId[] = ['claude-code', 'cursor', 'vscode-copilot', 'openai-codex', 'kiro', 'gemini-cli'];
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
          // Strip UTF-8 BOM that PowerShell may prepend via [Console]::In.ReadToEnd()
          if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
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
   * Accepts seven formats (detection order matters — more specific markers first):
   *
   * 1. Our own format (curl tests):
   *    { toolId: 'claude-code', state: 'working', payload?: {...} }
   *
   * 2. Gemini CLI (has _ap_tool: 'gemini-cli' injected by our hook script):
   *    { hook_event_name: 'BeforeAgent', _ap_tool: 'gemini-cli', session_id: '...', ... }
   *
   * 3. Cursor's native hook payload (camelCase events, has cursor_version):
   *    { hook_event_name: 'preToolUse', cursor_version: '...', conversation_id: '...', transcript_path: ... }
   *
   * 4. Kiro hook payload (has kiro_version or unique agentSpawn event):
   *    { hook_event_name: 'agentSpawn', session_id: '...', cwd: '...', ... }
   *
   * 5. Claude Code CLI (PascalCase events, has permission_mode):
   *    { hook_event_name: 'PreToolUse', session_id: '...', permission_mode: '...', transcript_path: '...', ... }
   *    Checked before Copilot because both send transcript_path.
   *
   * 6. VS Code Copilot hook payload (uses hookEventName camelCase key, or has transcript_path):
   *    { hook_event_name: 'PreToolUse', session_id: '...', transcript_path: '...', ... }
   *
   * 7. Codex native hook payload (PascalCase events, has turn_id):
   *    { hook_event_name: 'PreToolUse', session_id: '...', turn_id: '...', cwd: '...', ... }
   *
   * 8. Claude Code fallback (PascalCase events, no specific markers):
   *    { hook_event_name: 'PreToolUse', session_id: '...', tool_name: '...', ... }
   */
  private normalizePayload(data: any): { toolId: ToolId; state: AgentState; payload: any } | null {
    return normalizePayload(data);
  }
}

// Exported for unit testing
export function normalizePayload(data: any): { toolId: ToolId; state: AgentState; payload: any } | null {
    // Format 1 — explicit toolId + state
    if (data.toolId && data.state) {
      if (VALID_TOOLS.includes(data.toolId) && VALID_STATES.includes(data.state)) {
        return { toolId: data.toolId, state: data.state, payload: data.payload ?? {} };
      }
      return null;
    }

    if (data.hook_event_name || data.hookEventName) {
      // Copilot may use either hookEventName (docs) or hook_event_name (actual).
      const eventName: string = data.hook_event_name ?? data.hookEventName;

      // Format 2 — Gemini CLI (injected _ap_tool field from our hook script).
      // Checked first among hook formats since `_ap_tool` is definitive and avoids
      // PascalCase ambiguity with CC/Codex events.  We use `_ap_tool` instead of
      // `source` because Gemini CLI's own SessionStart payload includes a native
      // `source` field (values: Startup | Resume | Clear) that would overwrite ours
      // during JSON.parse (last duplicate key wins).
      if (data._ap_tool === 'gemini-cli') {
        let state: AgentState;
        if (GEMINI_WAITING_EVENTS.has(eventName))      state = 'waiting';
        else if (GEMINI_WORKING_EVENTS.has(eventName)) state = 'working';
        else if (GEMINI_IDLE_EVENTS.has(eventName))    state = 'idle';
        else {
          console.log(`Ignoring unmapped Gemini CLI event: ${eventName}`);
          return null;
        }
        return {
          toolId: 'gemini-cli',
          state,
          payload: {
            sessionId:   data.session_id,
            taskSummary: data.tool_name ? `Tool: ${data.tool_name}` : undefined,
          },
        };
      }

      // Format 3 — Cursor native hook (has cursor_version or conversation_id without session_id).
      // MUST be checked before Copilot because Cursor also sends transcript_path.
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

      // Format 5a — Claude Code CLI (has permission_mode, a CLI-specific field).
      // MUST be checked before Copilot because both send transcript_path.
      if (data.permission_mode !== undefined) {
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

      // Format 5b — VS Code Copilot (uses hookEventName camelCase key, or transcript_path).
      // Checked after Claude Code CLI / Cursor / Kiro since those also send transcript_path.
      if (data.hookEventName !== undefined || (data.transcript_path !== undefined && data.cursor_version === undefined)) {
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
            sessionId:   data.session_id ?? data.sessionId,
            taskSummary: data.tool_name ? `Tool: ${data.tool_name}` : undefined,
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

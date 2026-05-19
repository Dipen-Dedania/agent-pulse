import http from 'http';
import { StatusStateManager } from './state-manager';
import { BRIDGE_PORT } from './config';
import { ToolId, AgentState } from '../../common/types';
import { logger } from '../../common/logger';

// Claude Code hook event names → AgentState
// `waiting` = agent is *blocked* on the user (permission grant / elicitation response).
// `idle-active` = turn finished, session alive, ball is in the user's court but nothing is blocked.
// PermissionRequest / Elicitation = blocked → waiting
// Notification with notification_type `permission_prompt`/`idle_prompt` = blocked → waiting
// Stop / PostToolUse / SessionEnd / TeammateIdle = turn boundary → idle-active
const CC_WAITING_EVENTS = new Set(['PermissionRequest', 'Elicitation']);
const CC_WORKING_EVENTS = new Set(['UserPromptSubmit', 'PreToolUse', 'SubagentStart']);
const CC_IDLE_EVENTS    = new Set(['Stop', 'PostToolUse', 'SessionEnd', 'TeammateIdle']);
const CC_ERROR_EVENTS   = new Set(['StopFailure', 'PostToolUseFailure']);
const CC_NOTIFICATION_WAITING_TYPES = new Set(['permission_prompt', 'idle_prompt']);

function mapClaudeCodeEvent(eventName: string, data: any): AgentState | null {
  if (eventName === 'Notification') {
    return CC_NOTIFICATION_WAITING_TYPES.has(data.notification_type) ? 'waiting' : null;
  }
  if (CC_WAITING_EVENTS.has(eventName)) return 'waiting';
  if (CC_WORKING_EVENTS.has(eventName)) return 'working';
  if (CC_IDLE_EVENTS.has(eventName))    return 'idle-active';
  if (CC_ERROR_EVENTS.has(eventName))   return 'error';
  return null;
}

// Codex hook event names → AgentState (PascalCase, same as CC but detected via turn_id)
const CODEX_WAITING_EVENTS = new Set(['PermissionRequest']);
const CODEX_WORKING_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse']);
const CODEX_IDLE_EVENTS    = new Set(['Stop', 'PostToolUse']);

// Cursor hook event names → AgentState (camelCase per Cursor docs)
const CURSOR_WAITING_EVENTS = new Set<string>([]);
const CURSOR_WORKING_EVENTS = new Set(['sessionStart', 'preToolUse', 'subagentStart']);
const CURSOR_IDLE_EVENTS    = new Set(['stop', 'postToolUse', 'sessionEnd', 'subagentStop']);
const CURSOR_ERROR_EVENTS   = new Set(['postToolUseFailure']);

// VS Code Copilot hook event names → AgentState
// Uses camelCase hookEventName field (distinguishes it from CC/Codex's hook_event_name)
const COPILOT_WAITING_EVENTS = new Set<string>([]);
const COPILOT_WORKING_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PreToolUse', 'SubagentStart']);
const COPILOT_IDLE_EVENTS    = new Set(['Stop', 'PostToolUse', 'SubagentStop']);

// Kiro hook event names → AgentState (hook_event_name field, has kiro_version or source='kiro')
const KIRO_WAITING_EVENTS = new Set<string>([]);
const KIRO_WORKING_EVENTS = new Set(['agentSpawn', 'userPromptSubmit', 'preToolUse']);
const KIRO_IDLE_EVENTS    = new Set(['postToolUse']);

// Gemini CLI hook event names → AgentState (detected via _ap_tool: 'gemini-cli' injected by our hook script)
// `waiting` is reserved for events where the CLI is *blocked* on the user (Notification —
// e.g. tool-confirmation prompts). `AfterAgent` only means the agent loop ended and the
// next user prompt is welcome but not blocking, which matches our `idle-active` semantics
// (analogous to Claude Code's `Stop`).
const GEMINI_WORKING_EVENTS = new Set(['SessionStart', 'BeforeAgent', 'BeforeTool', 'BeforeModel', 'BeforeToolSelection']);
const GEMINI_WAITING_EVENTS = new Set(['Notification']);
const GEMINI_IDLE_EVENTS    = new Set(['SessionEnd', 'AfterAgent', 'AfterTool', 'AfterModel']);

const VALID_TOOLS: ToolId[] = ['claude-code', 'cursor', 'vscode-copilot', 'openai-codex', 'kiro', 'gemini-cli'];
const VALID_STATES: AgentState[] = ['working', 'waiting', 'idle', 'idle-active', 'error'];

export class StatusBridgeServer {
  private server: http.Server;
  private stateManager: StatusStateManager;
  private port: number = BRIDGE_PORT;

  constructor(stateManager: StatusStateManager) {
    this.stateManager = stateManager;
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public start() {
    this.server.listen(this.port, () => {
      logger.info(`Status Bridge running on port ${this.port}`);
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
          logger.debug(`[Bridge] Raw body received: ${body}`);
          const data = JSON.parse(body);
          const normalized = this.normalizePayload(data);

          if (!normalized) {
            logger.warn(`[Bridge] Unrecognized event payload: ${JSON.stringify(data)}`);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unrecognized event format' }));
            return;
          }

          const { toolId, state, payload } = normalized;
          logger.debug(`[Bridge] Normalized event: toolId=${toolId} state=${state} payload=${JSON.stringify(payload)}`);
          this.stateManager.updateStatus(toolId, state, payload);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        } catch (e) {
          logger.error(`JSON parse error: ${e}`);
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
          logger.debug(`[Bridge/MCP] JSON-RPC call: ${JSON.stringify(rpc)}`);
          const toolName: string = rpc?.params?.name ?? rpc?.method ?? '';

          if (toolName === 'agent_working') {
            this.stateManager.updateStatus('cursor', 'working', {});
          } else if (toolName === 'agent_idle') {
            this.stateManager.updateStatus('cursor', 'idle-active', {});
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: { content: [{ type: 'text', text: 'ok' }] } }));
        } catch (e) {
          logger.error(`[Bridge/MCP] parse error: ${e}`);
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

      // Format 2a — Codex (injected _ap_tool field from our hook script).
      // Definitive marker — needed because Codex's SessionStart event has no
      // `turn_id`, so the turn_id-based fallback below wouldn't catch it.
      if (data._ap_tool === 'openai-codex') {
        let state: AgentState;
        if (CODEX_WAITING_EVENTS.has(eventName))      state = 'waiting';
        else if (CODEX_WORKING_EVENTS.has(eventName)) state = 'working';
        else if (CODEX_IDLE_EVENTS.has(eventName))    state = 'idle-active';
        else {
          logger.debug(`Ignoring unmapped Codex event: ${eventName}`);
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

      // Format 2b — Gemini CLI (injected _ap_tool field from our hook script).
      // Checked first among hook formats since `_ap_tool` is definitive and avoids
      // PascalCase ambiguity with CC/Codex events.  We use `_ap_tool` instead of
      // `source` because Gemini CLI's own SessionStart payload includes a native
      // `source` field (values: Startup | Resume | Clear) that would overwrite ours
      // during JSON.parse (last duplicate key wins).
      if (data._ap_tool === 'gemini-cli') {
        let state: AgentState;
        if (GEMINI_WAITING_EVENTS.has(eventName))      state = 'waiting';
        else if (GEMINI_WORKING_EVENTS.has(eventName)) state = 'working';
        else if (GEMINI_IDLE_EVENTS.has(eventName))    state = 'idle-active';
        else {
          logger.debug(`Ignoring unmapped Gemini CLI event: ${eventName}`);
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
        else if (CURSOR_IDLE_EVENTS.has(eventName))    state = 'idle-active';
        else if (CURSOR_ERROR_EVENTS.has(eventName))   state = 'error';
        else {
          logger.debug(`Ignoring unmapped Cursor event: ${eventName}`);
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
        else if (KIRO_IDLE_EVENTS.has(eventName))    state = 'idle-active';
        else {
          logger.debug(`Ignoring unmapped Kiro event: ${eventName}`);
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
        const state = mapClaudeCodeEvent(eventName, data);
        if (state === null) {
          logger.debug(`Ignoring unmapped Claude Code event: ${eventName}${eventName === 'Notification' ? ` (notification_type=${data.notification_type})` : ''}`);
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
        else if (COPILOT_IDLE_EVENTS.has(eventName))    state = 'idle-active';
        else {
          logger.debug(`Ignoring unmapped Copilot event: ${eventName}`);
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
        else if (CODEX_IDLE_EVENTS.has(eventName))    state = 'idle-active';
        else {
          logger.debug(`Ignoring unmapped Codex event: ${eventName}`);
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
      const state = mapClaudeCodeEvent(eventName, data);
      if (state === null) {
        logger.debug(`Ignoring unmapped Claude Code event: ${eventName}${eventName === 'Notification' ? ` (notification_type=${data.notification_type})` : ''}`);
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

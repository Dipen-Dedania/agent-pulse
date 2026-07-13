import http from 'http';
import { StatusStateManager } from './state-manager';
import { BRIDGE_PORT } from './config';
import { ToolId, AgentState } from '../../common/types';
import { GuardrailConfig, GuardrailEvent, GuardrailEvaluation } from '../../common/guardrails';
import {
  SecretProtectionConfig,
  SecretAccessEvent,
  SecretAccessEvaluation,
} from '../../common/secretProtection';
import { evaluateCommand, detectOs } from '../guardrails/engine';
import { extractCommand } from '../guardrails/extractCommand';
import { evaluateSecretAccess, effectiveSecretRules } from '../secretProtection/engine';
import { extractReadPath } from '../secretProtection/extractReadPath';
import { logger } from '../../common/logger';
import {
  clampPidChain,
  isHostAllowed,
  readBody,
  redactTranscriptPath,
} from './security';

export interface BridgeOptions {
  getGuardrailConfig?: () => GuardrailConfig;
  onGuardrailEvent?: (event: GuardrailEvent) => void;
  // Secret Protection (separate guardrail family — gates file *reads*).
  getSecretProtectionConfig?: () => SecretProtectionConfig;
  onSecretAccessEvent?: (event: SecretAccessEvent) => void;
  // Called when the bridge cannot bind its port after exhausting retries.
  // Lets the main process surface a clean notification instead of letting the
  // listen error escape as a fatal uncaught exception ("A JavaScript error
  // occurred in the main process").
  onListenError?: (err: NodeJS.ErrnoException, port: number) => void;
}

// How many times to retry binding when the port is busy, and how long to wait
// between attempts. Covers the common case where a previous instance (or an
// updater-relaunched copy) is still releasing the socket during its shutdown.
const LISTEN_RETRY_LIMIT = 5;
const LISTEN_RETRY_DELAY_MS = 500;

// Claude Code hook event names → AgentState
// `waiting` = agent is *blocked* on the user (permission grant / elicitation response).
// `idle-active` = turn finished, session alive, ball is in the user's court but nothing is blocked.
// PermissionRequest / Elicitation = blocked → waiting
// Notification with notification_type `permission_prompt` = blocked → waiting
// `idle_prompt` is CC's 60s-idle nudge that fires after Stop; not blocking, so we ignore it
// and let the prior Stop's idle-active state stand.
// Stop / PostToolUse / SessionEnd / TeammateIdle = turn boundary → idle-active
const CC_WAITING_EVENTS = new Set(['PermissionRequest', 'Elicitation']);
const CC_WORKING_EVENTS = new Set(['UserPromptSubmit', 'PreToolUse', 'SubagentStart']);
const CC_IDLE_EVENTS    = new Set(['Stop', 'PostToolUse', 'SessionEnd', 'TeammateIdle']);
const CC_ERROR_EVENTS   = new Set(['StopFailure', 'PostToolUseFailure']);
const CC_NOTIFICATION_WAITING_TYPES = new Set(['permission_prompt']);

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

// Antigravity CLI hook event names → AgentState (detected via _ap_tool: 'antigravity-cli'
// injected by our hook script). Antigravity supports five events; PreInvocation/PreToolUse/
// PostToolUse keep the loop alive, while PostInvocation/Stop mark turn boundaries.
// There is no `Notification`-style event, so `waiting` is unreachable for this tool.
// There is also no dedicated failure event: a turn that errors out still fires a
// normal `Stop`, signalling the failure via `terminationReason: "ERROR"` + a top-level
// `error` string in the payload. normalizePayload inspects those to emit `error`.
const ANTIGRAVITY_WORKING_EVENTS = new Set(['PreInvocation', 'PreToolUse', 'PostToolUse']);
const ANTIGRAVITY_IDLE_EVENTS    = new Set(['PostInvocation', 'Stop']);

const VALID_TOOLS: ToolId[] = ['claude-code', 'cursor', 'vscode-copilot', 'openai-codex', 'kiro', 'antigravity-cli'];
const VALID_STATES: AgentState[] = ['working', 'waiting', 'idle', 'idle-active', 'error'];

export class StatusBridgeServer {
  private server: http.Server;
  private stateManager: StatusStateManager;
  private port: number = BRIDGE_PORT;
  private options: BridgeOptions;
  private listenAttempts = 0;

  constructor(stateManager: StatusStateManager, options: BridgeOptions = {}) {
    this.stateManager = stateManager;
    this.options = options;
    // Wrap with .catch so an async-handler rejection doesn't escape as an
    // unhandled promise — we still want a clean 500 on the wire.
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((e) => {
        logger.error('[Bridge] handler threw:', e);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end();
        }
      });
    });
  }

  public start() {
    // A `listen` failure is emitted as an 'error' event on net.Server. Without
    // a listener it becomes an uncaught exception → Electron's fatal error
    // dialog. We handle EADDRINUSE by retrying a few times (a shutting-down
    // previous instance usually frees the socket within a second), and report
    // anything else through onListenError so the app can degrade gracefully.
    this.server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && this.listenAttempts < LISTEN_RETRY_LIMIT) {
        this.listenAttempts++;
        logger.warn(
          `[Bridge] Port ${this.port} in use — retry ${this.listenAttempts}/${LISTEN_RETRY_LIMIT} in ${LISTEN_RETRY_DELAY_MS}ms`,
        );
        setTimeout(() => this.listen(), LISTEN_RETRY_DELAY_MS);
        return;
      }
      logger.error(`[Bridge] Failed to bind 127.0.0.1:${this.port} (${err.code ?? 'unknown'}): ${err.message}`);
      this.options.onListenError?.(err, this.port);
    });
    this.listen();
  }

  // Bind to loopback only — the bridge is a local IPC channel, never meant
  // to accept LAN traffic. Anyone needing remote access must explicitly
  // re-bind by editing this file.
  private listen() {
    this.server.listen(this.port, '127.0.0.1', () => {
      logger.info(`Status Bridge running on 127.0.0.1:${this.port}`);
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // Host allowlist check runs before anything else — rejects DNS-rebound
    // browser traffic with no JSON parsing, no body read, no allocation.
    if (!isHostAllowed(req.headers.host, this.port)) {
      logger.warn(`[Bridge] rejected request with non-local Host header: ${req.headers.host}`);
      res.writeHead(403);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/event') {
      const result = await readBody(req);
      if (!result.ok) {
        res.writeHead(result.reason === 'too-large' ? 413 : 400);
        res.end();
        return;
      }
      let body = result.body;
      try {
        // Strip UTF-8 BOM that PowerShell may prepend via [Console]::In.ReadToEnd()
        if (body.charCodeAt(0) === 0xFEFF) body = body.slice(1);
        logger.debug(`[Bridge] Raw body received: ${redactTranscriptPath(body)}`);
        const data = JSON.parse(body);
        const normalized = this.normalizePayload(data);

        if (!normalized) {
          logger.warn(`[Bridge] Unrecognized event payload: ${redactTranscriptPath(JSON.stringify(data))}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unrecognized event format' }));
          return;
        }

        const { toolId, state, payload } = normalized;
        logger.debug(`[Bridge] Normalized event: toolId=${toolId} state=${state} payload=${redactTranscriptPath(JSON.stringify(payload))}`);

        // Guardrail evaluation runs only on tool-call entry. For non-shell
        // tools or non-PreToolUse events, extractCommand returns null and
        // we fall through to the normal status broadcast path.
        const evaluation = this.evaluateGuardrails(toolId, data);

        if (evaluation && evaluation.eval.decision === 'block') {
          // Hard stop — don't propagate working state for a command we're
          // refusing. The state stays whatever it was.
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(buildBlockResponse(toolId, evaluation.eval)));
          return;
        }

        // Secret Protection — same pipeline shape, gating file *reads* instead
        // of commands. extractReadPath returns null for non-read tool calls, so
        // ordinary events fall straight through to the status broadcast.
        const secret = this.evaluateSecretAccess(toolId, data);
        if (secret && secret.eval.decision === 'block' && secret.enforce) {
          // Audit-only mode (hookBlocking off) skips the deny but still emits
          // the event above, so the read is observed/logged without refusal.
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(buildSecretBlockResponse(toolId, secret.eval, secret.filePath)));
          return;
        }

        this.stateManager.updateStatus(toolId, state, payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } catch (e) {
        logger.error(`JSON parse error: ${e}`);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    } else if (req.url === '/mcp') {
      await this.handleMcp(req, res);
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
  private async handleMcp(req: http.IncomingMessage, res: http.ServerResponse) {
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
      const result = await readBody(req);
      if (!result.ok) {
        res.writeHead(result.reason === 'too-large' ? 413 : 400);
        res.end();
        return;
      }
      try {
        const rpc = JSON.parse(result.body);
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
      return;
    }

    res.writeHead(405);
    res.end();
  }

  // Run extracted command (if any) through the guardrail engine and emit
  // a guardrail event via the options callback when the decision isn't allow.
  // Returns the evaluation + extracted command so the request handler can
  // decide whether to respond with a block payload.
  private evaluateGuardrails(toolId: ToolId, raw: any):
    { command: string; eval: GuardrailEvaluation } | null {
    const command = extractCommand(toolId, raw);
    if (!command) return null;

    const config = this.options.getGuardrailConfig?.();
    const evaluation = evaluateCommand(command, { os: detectOs(), toolId, config });
    if (evaluation.decision === 'allow') {
      return { command, eval: evaluation };
    }

    const event: GuardrailEvent = {
      ts: Date.now(),
      toolId,
      command,
      decision: evaluation.decision,
      matched: evaluation.matched,
      blockable: evaluation.blockable,
    };
    try {
      this.options.onGuardrailEvent?.(event);
    } catch (e) {
      logger.warn('[Bridge] onGuardrailEvent threw', e);
    }
    logger.info(
      `[Bridge/Guardrail] ${evaluation.decision.toUpperCase()} toolId=${toolId} ` +
      `rules=${evaluation.matched.map(m => m.ruleId).join(',')} command=${JSON.stringify(command)}`,
    );
    return { command, eval: evaluation };
  }

  // Run a read-class tool call (if any) through the Secret Protection engine and
  // emit a SecretAccessEvent when the decision isn't allow. Returns the
  // evaluation + the extracted path so the handler can respond with a deny.
  // Mirrors evaluateGuardrails.
  private evaluateSecretAccess(toolId: ToolId, raw: any):
    { filePath: string; viaShell: boolean; enforce: boolean; eval: SecretAccessEvaluation } | null {
    const config = this.options.getSecretProtectionConfig?.();
    if (config && !config.enabled) return null;
    // hookBlocking off → audit-only: observe + emit, but never deny.
    const enforce = config ? config.hookBlocking !== false : true;

    // Conservative shell-read scan: only treat a shell token as a read of a
    // protected path when the engine would actually flag it.
    const rules = effectiveSecretRules(config);
    const isProtected = (candidate: string) =>
      evaluateSecretAccess(candidate, { toolId, config }).matched.length > 0;

    const read = extractReadPath(toolId, raw, rules.length ? { isProtected } : undefined);
    if (!read) return null;

    const evaluation = evaluateSecretAccess(read.path, { toolId, config });
    if (evaluation.decision === 'allow') {
      return { filePath: read.path, viaShell: read.viaShell, enforce, eval: evaluation };
    }

    const event: SecretAccessEvent = {
      ts: Date.now(),
      toolId,
      filePath: read.path,
      decision: evaluation.decision,
      matched: evaluation.matched,
      blockable: evaluation.blockable,
      viaShell: read.viaShell,
    };
    try {
      this.options.onSecretAccessEvent?.(event);
    } catch (e) {
      logger.warn('[Bridge] onSecretAccessEvent threw', e);
    }
    logger.info(
      `[Bridge/Secret] ${evaluation.decision.toUpperCase()} toolId=${toolId}${read.viaShell ? ' (shell)' : ''} ` +
      `rules=${evaluation.matched.map(m => m.ruleId).join(',')} path=${JSON.stringify(read.path)}`,
    );
    return { filePath: read.path, viaShell: read.viaShell, enforce, eval: evaluation };
  }

  /**
   * Accepts seven formats (detection order matters — more specific markers first):
   *
   * 1. Our own format (curl tests):
   *    { toolId: 'claude-code', state: 'working', payload?: {...} }
   *
   * 2. Antigravity CLI (has _ap_tool: 'antigravity-cli' injected by our hook script):
   *    { hook_event_name: 'PreToolUse', _ap_tool: 'antigravity-cli', session_id: '...', ... }
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

// Build a hook-response body that asks the originating tool to deny the
// pending tool call. The exact shape is tool-specific — see buildDenyResponse.
// The response always returns 200 OK so the hook script doesn't error out.
export function buildBlockResponse(toolId: ToolId, evaluation: GuardrailEvaluation): any {
  const detail = evaluation.matched
    .map(m => m.message + (m.suggestedFix ? ` ${m.suggestedFix}` : ''))
    .join(' | ') || 'guardrail tripped';
  const ruleIds = evaluation.matched.map(m => m.ruleId).join(',');
  const reason = `[Agent Pulse] Blocked by ${ruleIds || 'guardrail'}: ${detail}`;
  return buildDenyResponse(toolId, reason, ruleIds);
}

// Secret Protection deny — same wire shape as buildBlockResponse, with a
// file-oriented reason. Reuses buildDenyResponse so the two families never
// drift in how they signal a deny to each tool.
export function buildSecretBlockResponse(
  toolId: ToolId,
  evaluation: SecretAccessEvaluation,
  filePath: string,
): any {
  const ruleIds = evaluation.matched.map(m => m.ruleId).join(',');
  const detail = evaluation.matched
    .map(m => m.message ?? m.glob)
    .join(' | ') || 'protected file';
  const reason = `[Agent Pulse] Blocked by ${ruleIds || 'secret protection'}: read of protected file ${filePath} — ${detail}`;
  return buildDenyResponse(toolId, reason, ruleIds);
}

// The shared deny payload. The wire shape differs per tool because each one
// reads a different field:
//   - Antigravity: top-level `decision` must be the literal "deny" (its hook
//     protocol is allow/deny). Our hook script forwards this body to stdout.
//   - Codex: prefers `hookSpecificOutput.permissionDecision = "deny"`; its
//     legacy `decision` field only accepts "block" (it rejects "deny"/"allow"),
//     so we must NOT send "deny" at the top level for Codex.
//   - Claude Code: native http hook reads `hookSpecificOutput.permissionDecision`.
// `status: "blocked"` + `continue: false` are stable markers every block body
// carries so the shell hook scripts can detect a block without a JSON parser.
function buildDenyResponse(toolId: ToolId, reason: string, matchedRules: string): any {
  // Antigravity's allow/deny protocol uses "deny"; Codex/Claude Code use the
  // legacy "block" plus hookSpecificOutput.
  const decision = toolId === 'antigravity-cli' ? 'deny' : 'block';
  return {
    status: 'blocked',
    decision,
    reason,
    matchedRules,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
    continue: false,
  };
}

// Pulls fields we forward to the timeline subscribers off the raw hook payload.
// These are shared across every tool format (each hook script injects what it
// can; null is fine for tools that don't expose a field).
function extractCommonFields(data: any): {
  cwd?: string;
  agentPid?: number;
  agentPidChain?: number[];
  transcriptPath?: string;
} {
  const cwd = typeof data.cwd === 'string' ? data.cwd : undefined;
  const pidRaw = data.agent_pid ?? data.agentPid ?? data.ap_pid;
  const agentPid =
    typeof pidRaw === 'number'
      ? pidRaw
      : typeof pidRaw === 'string' && /^\d+$/.test(pidRaw)
        ? parseInt(pidRaw, 10)
        : undefined;
  // Hook scripts also report an ancestor PID chain (immediate parent through
  // ~8 levels up). Lets the focus path try every entry — survives short-lived
  // shim processes (cmd.exe /C, transient launchers) that die between the
  // hook firing and the user clicking the bubble. clampPidChain bounds the
  // array before .map/.filter so a hostile payload can't burn CPU here.
  const chainRaw = clampPidChain(data.agent_pid_chain ?? data.agentPidChain ?? data.ap_pid_chain);
  let agentPidChain: number[] | undefined;
  if (chainRaw) {
    const parsed = chainRaw
      .map((v: unknown) =>
        typeof v === 'number'
          ? v
          : typeof v === 'string' && /^\d+$/.test(v)
            ? parseInt(v, 10)
            : undefined,
      )
      .filter((v): v is number => typeof v === 'number' && v > 0);
    if (parsed.length > 0) agentPidChain = parsed;
  }
  const transcriptPath =
    typeof data.transcript_path === 'string'
      ? data.transcript_path
      : typeof data.transcriptPath === 'string'
        ? data.transcriptPath
        : undefined;
  return { cwd, agentPid, agentPidChain, transcriptPath };
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
      const common = extractCommonFields(data);

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
            // Fallback model id; the rollout transcript parser supplies a more
            // precise one (turn_context.model) when it reads token usage.
            model:       typeof data.model === 'string' ? data.model : undefined,
            ...common,
          },
        };
      }

      // Format 2b — Antigravity CLI (injected _ap_tool field from our hook script).
      // Checked first among hook formats since `_ap_tool` is definitive and avoids
      // PascalCase ambiguity with CC/Codex events. Antigravity uses Pre/Post Tool/Invocation
      // plus Stop — no Notification-style event, so `waiting` is never produced here.
      if (data._ap_tool === 'antigravity-cli') {
        // Antigravity has no dedicated failure event — a turn that dies (e.g.
        // a 503 "high traffic"/no-capacity error) still fires a normal `Stop`,
        // but the payload carries `terminationReason: "ERROR"` plus a non-empty
        // top-level `error` string. Detect that first so a failed turn lands on
        // `error` (red) instead of being mapped to idle by the event name below.
        const errorMessage: string | undefined =
          typeof data.error === 'string' && data.error.trim() ? data.error : undefined;
        const isErrorTermination =
          (typeof data.terminationReason === 'string' &&
            data.terminationReason.toUpperCase() === 'ERROR') ||
          errorMessage !== undefined;

        let state: AgentState;
        if (isErrorTermination)                          state = 'error';
        else if (ANTIGRAVITY_WORKING_EVENTS.has(eventName)) state = 'working';
        else if (ANTIGRAVITY_IDLE_EVENTS.has(eventName))   state = 'idle-active';
        else {
          logger.debug(`Ignoring unmapped Antigravity CLI event: ${eventName}`);
          return null;
        }
        // Antigravity uses camelCase fields and nests tool info under toolCall.
        // Keep snake_case fallbacks for resilience if Google ever flips the
        // naming, but prefer the documented camelCase shape.
        const toolName: string | undefined =
          data.toolCall?.name ?? data.tool_name;
        return {
          toolId: 'antigravity-cli',
          state,
          payload: {
            sessionId:   data.conversationId ?? data.session_id,
            taskSummary: toolName ? `Tool: ${toolName}` : undefined,
            model:       typeof data.model === 'string' ? data.model : undefined,
            errorMessage,
            ...common,
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
            // Cursor's base hook payload carries `model` (a model-ID string like
            // "claude-sonnet-4-20250514"). It's the ONLY model source for Cursor —
            // there's no token transcript to read — so capturing it here feeds the
            // session model-usage analytics. Tokens/cost still come from the
            // usage-summary API; this is attribution only.
            model:        typeof data.model === 'string' ? data.model : undefined,
            ...common,
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
            ...common,
          },
        };
      }

      // Format 5a — Claude Code CLI (has permission_mode, a CLI-specific field,
      // or a transcript_path under `.claude/projects/`). MUST be checked before
      // Copilot because both send transcript_path; some CC events (e.g.
      // Notification) omit permission_mode, so the path pattern is the fallback.
      const isClaudeCodeTranscript =
        typeof data.transcript_path === 'string' &&
        /[\\/]\.claude[\\/]projects[\\/]/.test(data.transcript_path);
      if (data.permission_mode !== undefined || isClaudeCodeTranscript) {
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
            ...common,
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
            ...common,
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
            // Fallback model id; the rollout transcript parser supplies a more
            // precise one (turn_context.model) when it reads token usage.
            model:       typeof data.model === 'string' ? data.model : undefined,
            ...common,
          },
        };
      }

      // Format 7 — Claude Code native hook payload (has session_id, no turn_id)
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
          ...common,
        },
      };
    }

    return null;
}

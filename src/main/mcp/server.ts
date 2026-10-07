#!/usr/bin/env node
// Agent Pulse MCP server — lets a Claude Code terminal chat drop work straight
// onto the Backlog board ("add that to my backlog").
//
// Runs as its OWN process, spawned by Claude Code over stdio. It must not
// import electron (there is none here) and deliberately has zero npm
// dependencies: the MCP stdio wire format is newline-delimited JSON-RPC 2.0,
// which is small enough to implement directly and keeps the packaged app from
// carrying an SDK it only needs in a child process.
//
// It holds no board state. Every tool call is an authenticated HTTP hop to the
// running app's bridge (see bridge/server.ts `/backlog/*`), so the app owns
// validation, dedup and persistence, and this process stays a thin adapter.
//
// stdout is the protocol channel — diagnostics go to stderr only.

import http from 'http';
import { readConnectionFile } from './connection';

const SERVER_NAME = 'agent-pulse';
const SERVER_VERSION = '1.0.0';
// Echoed back when the client doesn't state one. Any client that does state a
// version gets its own echoed, which is the spec's negotiation rule.
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

const NOT_RUNNING =
  'Agent Pulse is not running, so the backlog is unreachable. Start Agent Pulse and try again ' +
  '— do not retry more than once.';

export interface BridgeResponse {
  status: number;
  body: any;
}

export type BridgeCall = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<BridgeResponse>;

/** POST/GET the local bridge with the shared token. Rejects with a human sentence. */
export const callBridge: BridgeCall = (method, pathname, body) =>
  new Promise((resolve, reject) => {
    const conn = readConnectionFile();
    if (!conn) {
      reject(new Error(NOT_RUNNING));
      return;
    }
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port: conn.port,
        path: pathname,
        method,
        headers: {
          'x-pulse-token': conn.token,
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) } : {}),
        },
        timeout: 15_000,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (raw.length < 1_000_000) raw += c; });
        res.on('end', () => {
          let parsed: any = null;
          try { parsed = JSON.parse(raw); } catch { /* non-JSON body → null */ }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('timeout', () => { req.destroy(new Error('the Agent Pulse bridge did not respond within 15s')); });
    req.on('error', (e: NodeJS.ErrnoException) => {
      reject(new Error(e.code === 'ECONNREFUSED' ? NOT_RUNNING : `could not reach Agent Pulse: ${e.message}`));
    });
    if (payload) req.write(payload);
    req.end();
  });

export const TOOLS = [
  {
    name: 'add_backlog_card',
    description:
      'Add a card to the Agent Pulse backlog board — the queue the overnight scheduler runs. ' +
      'Use it when the user asks to capture, save, remember or "add to the backlog/todo" something ' +
      'discussed in this conversation. Write the card as a brief for an agent that will NOT have seen ' +
      'this conversation: a specific title, and a description carrying the concrete context ' +
      '(files, symbols, decisions, constraints) that came up here. The card lands in To-Do and is ' +
      'eligible to run unattended, so only capture work that is actually well understood; ' +
      'set state to "refinement" for a half-formed idea that still needs planning.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short imperative summary, e.g. "Debounce the bubble drag handler".' },
        description: {
          type: 'string',
          description: 'Markdown brief: what to do, why, and the specific context from this chat (file paths, function names, decisions already made).',
        },
        acceptanceCriteria: {
          type: 'array',
          items: { type: 'string' },
          description: 'Checkable statements that define done. Omit rather than invent.',
        },
        taskType: {
          type: 'string',
          enum: ['execution', 'research', 'qa'],
          description: 'execution = changes code in a worktree (default); research = read-only investigation producing a report; qa = verification pass.',
        },
        agent: {
          type: 'string',
          enum: ['claude', 'codex'],
          description: 'Which CLI runs the card headlessly: claude (default, `claude -p`) or codex (`codex exec`). Only pass codex when the user asked for it.',
        },
        riskTier: {
          type: 'string',
          enum: ['green', 'amber', 'red'],
          description: 'green (default) is eligible for unattended autorun. Use amber/red for work that must be watched — those only run when the user starts them manually.',
        },
        estimatedMinutes: { type: 'number', description: 'Rough agent runtime estimate, if you have a basis for one.' },
        state: {
          type: 'string',
          enum: ['todo', 'refinement'],
          description: 'todo (default) = queue-ready. refinement = needs a planning pass first.',
        },
        projectPath: {
          type: 'string',
          description: 'Absolute path of the repo this card belongs to. Defaults to the current working directory; only pass it to target a different repo.',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'list_backlog_projects',
    description:
      'List the repos registered on the Agent Pulse backlog board. Use only when you need to target ' +
      'a card at a repo other than the current one — add_backlog_card already defaults to the current repo.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

const textResult = (text: string, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });

/** Render an intake result as the sentence the model reports back to the user. */
export function describeCardResult(body: any): { text: string; isError: boolean } {
  if (!body || body.ok !== true) {
    return { text: `Could not add the card: ${body?.reason ?? 'the backlog rejected the request'}`, isError: true };
  }
  const where = body.card?.state === 'refinement' ? 'Refinement' : 'To-Do';
  const project = body.projectName ? ` in ${body.projectName}` : '';
  return {
    text: body.duplicate
      ? `That card already exists${project} — "${body.card?.title}" is already on the board (${where}). Nothing was added.`
      : `Added "${body.card?.title}" to ${where}${project}.`,
    isError: false,
  };
}

async function callTool(name: string, args: any, bridge: BridgeCall) {
  if (name === 'list_backlog_projects') {
    const res = await bridge('GET', '/backlog/projects');
    if (res.status !== 200 || !res.body?.ok) {
      return textResult(`Could not list projects: ${res.body?.reason ?? `bridge returned ${res.status}`}`, true);
    }
    const projects: { name: string; path: string }[] = res.body.projects ?? [];
    return textResult(
      projects.length === 0
        ? 'No projects are registered on the board yet — adding a card from inside a git repo will register it automatically.'
        : projects.map((p) => `- ${p.name} — ${p.path}`).join('\n'),
    );
  }

  if (name === 'add_backlog_card') {
    const res = await bridge('POST', '/backlog/card', {
      ...args,
      // The chat's cwd is the default target repo; an explicit argument wins.
      projectPath: typeof args?.projectPath === 'string' && args.projectPath.trim().length > 0
        ? args.projectPath
        : process.cwd(),
    });
    if (res.status === 401) return textResult('Agent Pulse rejected the request (stale token). Reconnect the MCP server from Agent Pulse → Settings.', true);
    const described = describeCardResult(res.body);
    return textResult(described.text, described.isError);
  }

  return textResult(`Unknown tool: ${name}`, true);
}

/**
 * Handle one JSON-RPC message. Returns the response object, or null for
 * notifications (which must not be answered). Exported for tests.
 */
export async function handleRpc(msg: any, bridge: BridgeCall): Promise<any | null> {
  const { id, method, params } = msg ?? {};
  const isNotification = id === undefined || id === null;
  const reply = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id, result });

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      try {
        return reply(await callTool(params?.name, params?.arguments ?? {}, bridge));
      } catch (e: any) {
        // Tool-level failures are results with isError, not protocol errors —
        // that's what lets the model read the reason and tell the user.
        return reply(textResult(e?.message ?? String(e), true));
      }
    }
    default:
      if (isNotification) return null;
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

/** Wire up stdio: newline-delimited JSON in, newline-delimited JSON out. */
function main(): void {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let msg: any;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stderr.write(`[agent-pulse-mcp] dropped unparseable line\n`);
        continue;
      }
      void handleRpc(msg, callBridge)
        .then((response) => {
          if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
        })
        .catch((e) => {
          process.stderr.write(`[agent-pulse-mcp] handler failed: ${e?.message ?? e}\n`);
          if (msg?.id !== undefined && msg?.id !== null) {
            process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: 'internal error' } })}\n`);
          }
        });
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

// Only run the loop when executed directly — importing this module in tests
// must not hijack stdin.
if (require.main === module) main();

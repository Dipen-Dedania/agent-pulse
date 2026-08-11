// Handshake file between the running app and the standalone MCP server.
//
// The MCP server (mcp/server.ts) is a *separate process* that Claude Code
// spawns; it has no Electron, so it can't call app.getPath('userData') — and
// that path differs between dev (`agent-pulse`) and packaged (`Agent Pulse`)
// builds anyway. So the app publishes its bridge port + a shared secret to a
// fixed homedir location that both sides can compute identically.
//
// The token matters: the bridge listens on loopback, but a malicious web page
// can still issue a cross-origin POST to 127.0.0.1. Card creation lands work
// in the To-Do queue that the overnight scheduler *executes*, so it must not
// be reachable that way. Requiring a custom header both forces a CORS
// preflight (which the bridge fails) and carries a secret no page can read.

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface McpConnection {
  port: number;
  token: string;
}

/** `~/.agent-pulse/mcp.json` — identical in dev and packaged builds. */
export function connectionDir(): string {
  return path.join(os.homedir(), '.agent-pulse');
}

export function connectionFilePath(): string {
  return path.join(connectionDir(), 'mcp.json');
}

/**
 * Read the published connection, or null when the app has never run / the file
 * is unusable. The env pair overrides the file so a dev (or a test harness) can
 * point the MCP server at a throwaway bridge without disturbing the real app's
 * published connection.
 */
export function readConnectionFile(): McpConnection | null {
  const envPort = Number(process.env.AGENT_PULSE_BRIDGE_PORT);
  const envToken = process.env.AGENT_PULSE_MCP_TOKEN;
  if (Number.isInteger(envPort) && envPort > 0 && typeof envToken === 'string' && envToken.length > 0) {
    return { port: envPort, token: envToken };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(connectionFilePath(), 'utf8'));
    const port = Number(parsed?.port);
    const token = typeof parsed?.token === 'string' ? parsed.token : '';
    if (!Number.isInteger(port) || port <= 0 || token.length === 0) return null;
    return { port, token };
  } catch {
    return null;
  }
}

/**
 * Publish the bridge port + token, reusing the existing token when one is
 * already on disk. Reuse is what lets a registered MCP server keep working
 * across app restarts without re-registering. Returns null if the file can't
 * be written — the caller degrades to "MCP unavailable" rather than throwing.
 */
export function writeConnectionFile(port: number): McpConnection | null {
  const existing = readConnectionFile();
  const conn: McpConnection = {
    port,
    token: existing?.token ?? crypto.randomBytes(32).toString('hex'),
  };
  try {
    fs.mkdirSync(connectionDir(), { recursive: true, mode: 0o700 });
    // 0600: the token is a capability. mode is advisory on Windows (ACLs rule
    // there), but correct on macOS/Linux and harmless either way.
    fs.writeFileSync(connectionFilePath(), JSON.stringify(conn, null, 2), { encoding: 'utf8', mode: 0o600 });
    return conn;
  } catch {
    return null;
  }
}

/** Constant-time token comparison — avoids leaking the secret via response timing. */
export function tokensMatch(expected: string | null | undefined, provided: unknown): boolean {
  if (typeof expected !== 'string' || expected.length === 0) return false;
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
  } catch {
    return false;
  }
}

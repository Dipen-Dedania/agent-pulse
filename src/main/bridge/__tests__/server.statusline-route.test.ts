import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  Notification: class { show() { /* no-op */ } },
  ipcMain: { handle: () => {}, on: () => {} },
}));

import { StatusBridgeServer } from '../server';
import { StatusLineFeedSnapshot } from '../statusline';

const TOKEN = 'test-token-0123456789abcdef';

let server: StatusBridgeServer;
let port: number;
const received: StatusLineFeedSnapshot[] = [];

beforeAll(async () => {
  server = new StatusBridgeServer({} as any, {
    port: 0, // ephemeral — never collides with a live Agent Pulse on 4242
    getMcpToken: () => TOKEN,
    onStatusLine: (snap) => received.push(snap),
    getBacklogMcpApi: () => ({ listProjects: () => [], createCard: () => ({ ok: true }) } as any),
  });
  server.start();
  // Wait for the listen callback to resolve the ephemeral port.
  for (let i = 0; i < 100 && server.getPort() === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  port = server.getPort();
  expect(port).toBeGreaterThan(0);
});

afterAll(() => {
  // StatusBridgeServer has no stop(); close the underlying socket directly.
  (server as any).server?.close();
});

function post(path: string, body: string, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

describe('POST /statusline token gate', () => {
  it('rejects a request with no token', async () => {
    const res = await post('/statusline', JSON.stringify({ session_id: 's1' }));
    expect(res.status).toBe(401);
    expect(received).toHaveLength(0);
  });

  it('rejects a request with a wrong token', async () => {
    const res = await post('/statusline', JSON.stringify({ session_id: 's1' }), {
      'x-pulse-token': 'wrong-token-9876543210fedcba',
    });
    expect(res.status).toBe(401);
    expect(received).toHaveLength(0);
  });

  it('accepts a request with the correct token and forwards the snapshot', async () => {
    const res = await post('/statusline', JSON.stringify({ session_id: 's1', cost: { total_cost_usd: 0.5 } }), {
      'x-pulse-token': TOKEN,
    });
    expect(res.status).toBe(200);
    expect(received).toHaveLength(1);
    expect(received[0].sessionId).toBe('s1');
  });
});

describe('GET /backlog/projects token gate (regression)', () => {
  it('rejects without a token and accepts with it', async () => {
    const denied = await fetch(`http://127.0.0.1:${port}/backlog/projects`);
    expect(denied.status).toBe(401);
    const allowed = await fetch(`http://127.0.0.1:${port}/backlog/projects`, {
      headers: { 'x-pulse-token': TOKEN },
    });
    expect(allowed.status).toBe(200);
  });
});

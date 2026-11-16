// @vitest-environment node
import http from 'http';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { HermesSessions, parseHermesEvent, HERMES_TTL_MS, HERMES_TOOL_TTL_MS, type HermesEvent } from '../hermes';
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
import { StatusStateManager } from '../state-manager';
import { StatusBridgeServer } from '../server';
const a = 'a'.repeat(64), b = 'b'.repeat(64), r = 'c'.repeat(64), q = 'd'.repeat(64);
const event = (name: HermesEvent['event'], at: number, session = a, request?: string): HermesEvent =>
  ({ v: 1, event: name, at, session, ...(request ? { request } : {}) });

describe('Hermes correlations and bounded aggregation', () => {
  it('does not idle B when A ends; clears an explicit zero', () => {
    const s = new HermesSessions();
    s.accept(event('pre_llm_call', 100, a), 100);
    s.accept(event('pre_llm_call', 101, b), 101);
    s.accept(event('on_session_end', 102, a), 102);
    expect(s.snapshot()).toMatchObject({ state: 'working', activeAgents: 1,
      sessions: [{ session: a, state: 'idle-active' }, { session: b, state: 'working' }] });
    s.accept(event('on_session_end', 103, b), 103);
    expect(s.snapshot()).toMatchObject({ state: 'idle-active', activeAgents: 0 });
  });
  it('keeps two waits and ignores unrelated activity / wrong resolution', () => {
    const s = new HermesSessions();
    s.accept(event('on_human_input_request', 100, a, r), 100);
    s.accept(event('on_human_input_request', 101, a, q), 101);
    s.accept(event('post_tool_call', 102), 102);
    s.accept(event('on_human_input_resolved', 103, b, r), 103);
    s.accept(event('on_human_input_resolved', 104, a, r), 104);
    expect(s.snapshot().state).toBe('waiting');
    s.accept(event('on_human_input_resolved', 105, a, q), 105);
    expect(s.snapshot().state).toBe('working');
  });
  it('does not resurrect ended turns or resolved requests on replay/reordering', () => {
    const s = new HermesSessions();
    s.accept(event('on_human_input_resolved', 110, a, r), 110);
    s.accept(event('on_human_input_request', 100, a, r), 111);
    expect(s.snapshot().state).toBe('working');
    s.accept(event('on_session_end', 120), 120);
    s.accept(event('pre_llm_call', 119), 121);
    s.accept(event('on_human_input_request', 119, a, q), 122);
    expect(s.snapshot().state).toBe('idle-active');
  });
  it('ignores delayed turn completion after newer human-input activity per session', () => {
    const s = new HermesSessions();
    s.accept(event('pre_llm_call', 100, a), 100);
    s.accept(event('pre_llm_call', 100, b), 100);
    s.accept(event('on_human_input_request', 200, a, r), 200);
    s.accept(event('on_human_input_resolved', 300, a, r), 300);
    s.accept(event('on_session_end', 150, a), 301);
    // A's watermark must not suppress B's independent completion.
    s.accept(event('on_session_end', 150, b), 302);
    expect(s.snapshot()).toEqual({ state: 'working', activeAgents: 1,
      sessions: [{ session: a, state: 'working' }, { session: b, state: 'idle-active' }] });
    s.accept(event('on_session_end', 400, a), 400);
    expect(s.snapshot()).toMatchObject({ state: 'idle-active', activeAgents: 0 });
  });
  it('still correlates older human requests delivered after newer tool activity', () => {
    const s = new HermesSessions();
    s.accept(event('pre_llm_call', 100), 100);
    s.accept(event('post_tool_call', 300), 300);
    s.accept(event('on_human_input_request', 200, a, r), 301);
    expect(s.snapshot().state).toBe('waiting');
    s.accept(event('on_human_input_resolved', 250, a, r), 302);
    s.accept(event('on_session_end', 275), 303);
    expect(s.snapshot()).toMatchObject({ state: 'working', activeAgents: 1 });
  });
  it('expires quiet sessions without inventing a death or refreshing from duplicates', () => {
    const s = new HermesSessions();
    s.accept(event('pre_llm_call', 100), 100);
    s.accept(event('pre_llm_call', 100), HERMES_TTL_MS);
    expect(s.expire(HERMES_TTL_MS + 100)).toBe(true);
    expect(s.snapshot()).toEqual({ state: 'idle', activeAgents: 0, sessions: [] });
  });
  it('never expires a session waiting on a human; the normal TTL resumes once answered', () => {
    const s = new HermesSessions();
    s.accept(event('on_human_input_request', 100, a, r), 100);
    expect(s.expire(100 + HERMES_TOOL_TTL_MS * 4)).toBe(false);
    expect(s.snapshot().state).toBe('waiting');

    const answeredAt = 100 + HERMES_TOOL_TTL_MS * 4;
    s.accept(event('on_human_input_resolved', answeredAt, a, r), answeredAt);
    expect(s.expire(answeredAt + HERMES_TTL_MS - 1)).toBe(false);
    expect(s.expire(answeredAt + HERMES_TTL_MS)).toBe(true);
  });
  it('gives a running tool the longer silence allowance', () => {
    const s = new HermesSessions();
    s.accept(event('pre_llm_call', 100, a), 100);
    s.accept(event('pre_tool_call', 200, a), 200);
    expect(s.expire(200 + HERMES_TTL_MS)).toBe(false);
    expect(s.snapshot().state).toBe('working');
    expect(s.expire(200 + HERMES_TOOL_TTL_MS)).toBe(true);

    const done = new HermesSessions();
    done.accept(event('pre_tool_call', 100, a), 100);
    done.accept(event('post_tool_call', 200, a), 200);
    expect(done.expire(200 + HERMES_TTL_MS)).toBe(true);
  });
  it('bounds sessions and request tombstones', () => {
    const s = new HermesSessions();
    for (let i = 0; i < 256; i++) expect(s.accept(event('pre_llm_call', 100, i.toString(16).padStart(64, '0')), 100)).toBe(true);
    expect(s.accept(event('pre_llm_call', 100), 100)).toBe(false);
    const waits = new HermesSessions();
    for (let i = 0; i < 128; i++) expect(waits.accept(event('on_human_input_request', 100 + i, a, i.toString(16).padStart(64, '0')), 100)).toBe(true);
    expect(waits.accept(event('on_human_input_request', 300, a, r), 100)).toBe(false);
  });
  it('reclaims old resolved correlations for long-lived sessions', () => {
    const s = new HermesSessions();
    for (let i = 0; i < 128; i++) s.accept(event('on_human_input_resolved', 100 + i, a, i.toString(16).padStart(64, '0')), 100 + i);
    expect(s.accept(event('on_human_input_request', 40_000, a, r), 40_000)).toBe(true);
    expect(s.snapshot().state).toBe('waiting');
  });
  it('rejects missing IDs, extra content, stale and future timestamps', () => {
    const valid = event('pre_llm_call', 100_000);
    expect(parseHermesEvent(valid, 100_000)).toEqual(valid);
    for (const bad of [{ ...valid, session: '' }, { ...valid, prompt: 'private' },
      { ...valid, at: 1 }, { ...valid, at: 200_000 }, { ...valid, request: r },
      { ...valid, event: 'on_human_input_request' }, null]) expect(parseHermesEvent(bad, 100_000)).toBeNull();
  });
  it('publishes the aggregate to live listeners as a session-less event, never to the replay buffer', async () => {
    const manager = new StatusStateManager();
    const listener = vi.fn();
    manager.onEvent(listener);
    manager.updateHermesProjection('waiting', 2);
    manager.updateHermesProjection('idle-active', 0);
    await new Promise(resolve => setImmediate(resolve));
    expect(manager.getStatus('hermes')).toMatchObject({ state: 'idle-active', activeAgents: 0 });
    // Attention escalation and the screen-edge glow key off toolId + state.
    expect(listener.mock.calls.map(([e]) => [e.toolId, e.state, e.payload])).toEqual([
      ['hermes', 'waiting', { activeAgents: 2 }],
      ['hermes', 'idle-active', { activeAgents: 0 }],
    ]);
    expect(manager.drainPending()).toEqual([]);
  });
  it('passes an explicit zero agent count through for other tools', () => {
    const manager = new StatusStateManager();
    manager.updateStatus('cursor', 'working', { activeAgents: 2 });
    manager.updateStatus('cursor', 'idle-active', { activeAgents: 0 });
    expect(manager.getStatus('cursor')?.activeAgents).toBe(0);
  });
});

describe('Hermes authenticated HTTP boundary', () => {
  const manager = new StatusStateManager();
  let server: StatusBridgeServer;
  let port: number;
  const token = 'test-hermes-only-token';
  beforeAll(async () => {
    server = new StatusBridgeServer(manager, { port: 0, getHermesToken: () => token, getMcpToken: () => 'other-token' });
    server.start();
    for (let i = 0; i < 100 && server.getPort() === 0; i++) await new Promise(r => setTimeout(r, 10));
    port = server.getPort();
  });
  afterAll(() => (server as any).server.close());
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  it('requires the dedicated token and rejects browser Origin and nonlocal Host', async () => {
    const body = event('pre_llm_call', Date.now());
    for (const headers of [{}, { 'x-pulse-token': 'other-token' }, { 'x-pulse-token': token, Origin: 'https://evil.test' }]) {
      expect((await post('/hermes/event', body, headers as Record<string,string>)).status).toBe(401);
    }
    const status = await new Promise(resolve => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/hermes/event', method: 'POST',
        headers: { Host: 'evil.test', 'x-pulse-token': token } }, res => { res.resume(); resolve(res.statusCode); });
      req.end(JSON.stringify(body));
    });
    expect(status).toBe(403);
  });
  it('cannot bypass authentication via generic event route', async () => {
    expect((await post('/event', { toolId: 'hermes', state: 'working', payload: {} })).status).toBe(400);
    expect(manager.getStatus('hermes')).toBeUndefined();
  });
  it('bounds bytes and schema without updating status', async () => {
    expect((await post('/hermes/event', '界'.repeat(1000), { 'x-pulse-token': token })).status).toBe(413);
    expect((await post('/hermes/event', { ...event('pre_llm_call', Date.now()), prompt: 'private' }, { 'x-pulse-token': token })).status).toBe(400);
    expect(manager.getStatus('hermes')).toBeUndefined();
  });
  it('updates actual normalized status and exposes only authenticated hashed diagnostics', async () => {
    expect((await post('/hermes/event', event('pre_llm_call', Date.now()), { 'x-pulse-token': token })).status).toBe(204);
    expect(manager.getStatus('hermes')).toMatchObject({ state: 'working', activeAgents: 1 });
    expect((await fetch(`http://127.0.0.1:${port}/hermes/status`)).status).toBe(401);
    const res = await fetch(`http://127.0.0.1:${port}/hermes/status`, { headers: { 'x-pulse-token': token } });
    expect(await res.json()).toMatchObject({ state: 'working', sessions: [{ session: a, state: 'working' }] });
  });
});

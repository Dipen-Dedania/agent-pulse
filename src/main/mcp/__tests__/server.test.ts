import { describe, it, expect, vi } from 'vitest';
import { handleRpc, describeCardResult, TOOLS, BridgeCall } from '../server';

const ok = (body: any) => ({ status: 200, body });

describe('handleRpc', () => {
  const bridge: BridgeCall = async () => ok({ ok: true });

  it('answers initialize with the client protocol version and our server info', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, bridge);
    expect(res).toMatchObject({
      id: 1,
      result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'agent-pulse' } },
    });
  });

  it('falls back to a default protocol version when the client states none', async () => {
    const res = await handleRpc({ id: 1, method: 'initialize', params: {} }, bridge);
    expect(res.result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never answers a notification', async () => {
    expect(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, bridge)).toBeNull();
    expect(await handleRpc({ jsonrpc: '2.0', method: 'some/unknown/notification' }, bridge)).toBeNull();
  });

  it('lists both tools with a required title on the card tool', async () => {
    const res = await handleRpc({ id: 2, method: 'tools/list' }, bridge);
    expect(res.result.tools.map((t: any) => t.name)).toEqual(['add_backlog_card', 'list_backlog_projects']);
    const card = TOOLS[0];
    expect(card.inputSchema.required).toEqual(['title']);
    expect(Object.keys(card.inputSchema.properties)).toContain('projectPath');
  });

  it('returns a JSON-RPC error for an unknown method with an id', async () => {
    const res = await handleRpc({ id: 3, method: 'nope' }, bridge);
    expect(res.error.code).toBe(-32601);
  });

  it('defaults projectPath to the process cwd and forwards the rest', async () => {
    const call = vi.fn<BridgeCall>().mockResolvedValue(ok({ ok: true, duplicate: false, card: { title: 'T', state: 'todo' }, projectName: 'demo' }));
    await handleRpc({ id: 4, method: 'tools/call', params: { name: 'add_backlog_card', arguments: { title: 'T', riskTier: 'amber' } } }, call);
    expect(call).toHaveBeenCalledWith('POST', '/backlog/card', expect.objectContaining({ title: 'T', riskTier: 'amber', projectPath: process.cwd() }));
  });

  it('keeps an explicit projectPath', async () => {
    const call = vi.fn<BridgeCall>().mockResolvedValue(ok({ ok: true, duplicate: false, card: { title: 'T', state: 'todo' } }));
    await handleRpc({ id: 5, method: 'tools/call', params: { name: 'add_backlog_card', arguments: { title: 'T', projectPath: 'E:/other' } } }, call);
    expect(call).toHaveBeenCalledWith('POST', '/backlog/card', expect.objectContaining({ projectPath: 'E:/other' }));
  });

  it('reports a bridge failure as an isError result, not a protocol error', async () => {
    const call: BridgeCall = async () => { throw new Error('Agent Pulse is not running'); };
    const res = await handleRpc({ id: 6, method: 'tools/call', params: { name: 'add_backlog_card', arguments: { title: 'T' } } }, call);
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('not running');
  });

  it('explains a rejected token instead of passing the raw status through', async () => {
    const call: BridgeCall = async () => ({ status: 401, body: { ok: false, reason: 'unauthorized' } });
    const res = await handleRpc({ id: 7, method: 'tools/call', params: { name: 'add_backlog_card', arguments: { title: 'T' } } }, call);
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toContain('Reconnect');
  });

  it('renders an empty project list as guidance rather than a blank reply', async () => {
    const call: BridgeCall = async () => ok({ ok: true, projects: [] });
    const res = await handleRpc({ id: 8, method: 'tools/call', params: { name: 'list_backlog_projects' } }, call);
    expect(res.result.content[0].text).toContain('No projects');
  });
});

describe('describeCardResult', () => {
  it('names the column and project on success', () => {
    expect(describeCardResult({ ok: true, duplicate: false, card: { title: 'T', state: 'todo' }, projectName: 'demo' }))
      .toEqual({ text: 'Added "T" to To-Do in demo.', isError: false });
    expect(describeCardResult({ ok: true, duplicate: false, card: { title: 'T', state: 'refinement' }, projectName: 'demo' }).text)
      .toContain('Refinement');
  });

  it('says nothing was added for a duplicate, without flagging an error', () => {
    const res = describeCardResult({ ok: true, duplicate: true, card: { title: 'T', state: 'todo' }, projectName: 'demo' });
    expect(res.isError).toBe(false);
    expect(res.text).toContain('already exists');
  });

  it('surfaces the rejection reason', () => {
    expect(describeCardResult({ ok: false, reason: 'title is required' })).toEqual({
      text: 'Could not add the card: title is required',
      isError: true,
    });
  });
});

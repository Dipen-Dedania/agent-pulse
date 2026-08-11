import { describe, it, expect } from 'vitest';
import { buildMcpEntry, entryMatches, withPulseServer, withoutPulseServer, MCP_SERVER_KEY } from '../install';
import { tokensMatch } from '../connection';

const entry = buildMcpEntry('C:/apps/Agent Pulse.exe', 'C:/apps/resources/app.asar/dist/main/mcp/server.js');

describe('buildMcpEntry', () => {
  it('launches our own binary in node mode so a packaged install needs no node on PATH', () => {
    expect(entry).toEqual({
      type: 'stdio',
      command: 'C:/apps/Agent Pulse.exe',
      args: ['C:/apps/resources/app.asar/dist/main/mcp/server.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});

describe('entryMatches', () => {
  it('is true only for the same binary and script', () => {
    expect(entryMatches(entry, entry)).toBe(true);
    expect(entryMatches({ ...entry, command: 'C:/old/Agent Pulse.exe' }, entry)).toBe(false);
    expect(entryMatches({ ...entry, args: ['C:/old/server.js'] }, entry)).toBe(false);
    expect(entryMatches(undefined, entry)).toBe(false);
  });
});

describe('withPulseServer / withoutPulseServer', () => {
  const foreign = { 'chrome-devtools': { type: 'stdio', command: 'npx', args: ['chrome-devtools-mcp@latest'], env: {} } };

  it('adds our entry without disturbing other servers or unrelated config', () => {
    const config = { numStartups: 42, mcpServers: { ...foreign } };
    const next = withPulseServer(config, entry);
    expect(next.numStartups).toBe(42);
    expect(next.mcpServers['chrome-devtools']).toEqual(foreign['chrome-devtools']);
    expect(next.mcpServers[MCP_SERVER_KEY]).toEqual(entry);
    // The input config must not be mutated — we write a fresh object atomically.
    expect(config.mcpServers[MCP_SERVER_KEY as keyof typeof config.mcpServers]).toBeUndefined();
  });

  it('creates the mcpServers map when the config has none', () => {
    expect(withPulseServer({ numStartups: 1 }, entry).mcpServers[MCP_SERVER_KEY]).toEqual(entry);
    expect(withPulseServer(undefined, entry).mcpServers[MCP_SERVER_KEY]).toEqual(entry);
  });

  it('removes only our key', () => {
    const next = withoutPulseServer({ numStartups: 42, mcpServers: { ...foreign, [MCP_SERVER_KEY]: entry } });
    expect(next.mcpServers[MCP_SERVER_KEY]).toBeUndefined();
    expect(next.mcpServers['chrome-devtools']).toBeDefined();
    expect(next.numStartups).toBe(42);
  });

  it('is a no-op on a config with no servers at all', () => {
    expect(withoutPulseServer({ numStartups: 1 })).toEqual({ numStartups: 1 });
  });
});

describe('tokensMatch', () => {
  it('accepts the exact token only', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc123', 'abc124')).toBe(false);
    expect(tokensMatch('abc123', 'abc12')).toBe(false);
  });

  it('rejects every shape of missing token', () => {
    expect(tokensMatch(null, 'abc123')).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
    expect(tokensMatch('abc123', undefined)).toBe(false);
    expect(tokensMatch('abc123', ['abc123'])).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { buildScoutArgs, classifyConnector } from '../scout-core';

describe('buildScoutArgs', () => {
  it('is read-only, allow-lists the given tools, forces the model, and never uses strict-mcp-config', () => {
    const args = buildScoutArgs('claude-haiku-4-5', 'mcp__x__a,mcp__x__b');
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).not.toContain('--strict-mcp-config');
    const allowIdx = args.indexOf('--allowedTools');
    expect(allowIdx).toBeGreaterThan(-1);
    expect(args[allowIdx + 1]).toBe('mcp__x__a,mcp__x__b'); // arbitrary allowlist passed through
    const disallowIdx = args.indexOf('--disallowedTools');
    expect(args[disallowIdx + 1]).toBe('Write,Edit,Bash,NotebookEdit,Read,Grep,Glob,Agent,Task');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-4-5');
  });

  it('omits --model for an unsafe model id', () => {
    expect(buildScoutArgs('haiku && del *', 'mcp__x__a')).not.toContain('--model');
  });
});

describe('classifyConnector', () => {
  it('is connected on success', () => {
    expect(classifyConnector(true, null)).toBe('connected');
  });
  it('flags needs-auth only for auth-shaped failures', () => {
    expect(classifyConnector(false, 'authenticate with Linear first')).toBe('needs-auth');
    expect(classifyConnector(false, 'HTTP 401 Unauthorized')).toBe('needs-auth');
    expect(classifyConnector(false, 'please connect the connector')).toBe('needs-auth');
    expect(classifyConnector(false, 'claude exited with code 1: some other error')).toBe('connected');
  });
});

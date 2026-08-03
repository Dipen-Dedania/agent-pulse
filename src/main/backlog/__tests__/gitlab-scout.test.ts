import { describe, it, expect } from 'vitest';
import { parseScoutIssues, classifyConnector, buildScoutArgs } from '../gitlab-scout';

describe('parseScoutIssues', () => {
  const one = '[{"iid":42,"title":"Fix login","description":"d","webUrl":"https://x/-/issues/42","labels":["bug"]}]';

  it('parses a plain JSON array', () => {
    const out = parseScoutIssues(one);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ iid: 42, title: 'Fix login', description: 'd', webUrl: 'https://x/-/issues/42', labels: ['bug'] });
  });

  it('tolerates a ```json fence and leading prose', () => {
    expect(parseScoutIssues('```json\n' + one + '\n```')).toHaveLength(1);
    expect(parseScoutIssues('Here are the issues:\n' + one)).toHaveLength(1);
  });

  it('accepts a web_url alias and a numeric-string iid', () => {
    const out = parseScoutIssues('[{"iid":"7","title":"T","web_url":"u"}]');
    expect(out[0].iid).toBe(7);
    expect(out[0].webUrl).toBe('u');
  });

  it('drops malformed rows (no iid / no title) and non-arrays', () => {
    expect(parseScoutIssues('[{"title":"no iid"},{"iid":1},{"iid":2,"title":"ok"}]')).toEqual([
      { iid: 2, title: 'ok', description: '', webUrl: '', labels: [] },
    ]);
    expect(parseScoutIssues('{"iid":1,"title":"obj"}')).toEqual([]);
    expect(parseScoutIssues('not json')).toEqual([]);
    expect(parseScoutIssues('')).toEqual([]);
    expect(parseScoutIssues(null)).toEqual([]);
  });

  it('truncates an over-long description to the preview length (belt-and-braces)', () => {
    const long = 'y'.repeat(900);
    const desc = parseScoutIssues(`[{"iid":9,"title":"t","description":"${long}"}]`)[0].description;
    expect(desc.length).toBe(501); // 500 chars + the ellipsis
    expect(desc.endsWith('…')).toBe(true);
  });
});

describe('classifyConnector', () => {
  it('is connected on success', () => {
    expect(classifyConnector(true, null)).toBe('connected');
  });
  it('flags needs-auth only for auth-shaped failures', () => {
    expect(classifyConnector(false, 'authentication required')).toBe('needs-auth');
    expect(classifyConnector(false, 'HTTP 401 Unauthorized')).toBe('needs-auth');
    expect(classifyConnector(false, 'please connect the GitLab connector')).toBe('needs-auth');
    // A non-auth failure keeps the connector "connected" (don't show a misleading badge).
    expect(classifyConnector(false, 'claude exited with code 1: some other error')).toBe('connected');
  });
});

describe('buildScoutArgs', () => {
  it('is read-only, allowlists GitLab tools, forces the model, and never uses strict-mcp-config', () => {
    const args = buildScoutArgs('claude-haiku-4-5');
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).not.toContain('--strict-mcp-config');
    const allowIdx = args.indexOf('--allowedTools');
    expect(allowIdx).toBeGreaterThan(-1);
    expect(args[allowIdx + 1]).toContain('mcp__claude_ai_Gitlab_Cloud__my_issues');
    expect(args[allowIdx + 1]).toContain('mcp__claude_ai_Gitlab_Cloud__get_project');
    const disallowIdx = args.indexOf('--disallowedTools');
    expect(args[disallowIdx + 1]).toBe('Write,Edit,Bash,NotebookEdit,Read,Grep,Glob,Agent,Task');
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-haiku-4-5');
  });

  it('omits --model for an unsafe model id', () => {
    expect(buildScoutArgs('haiku && del *')).not.toContain('--model');
  });
});

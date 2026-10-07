import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../scheduler/opener', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../scheduler/opener')>();
  return { ...actual, resolveClaudeBin: () => null, resetClaudeBinCache: () => {} };
});

import { buildClaudeArgs, claudeAdapter } from '../claude';
import { RESUME_PROMPT } from '../shared';

const base = { cwd: 'E:\\repo', model: null, resumeSessionId: null } as const;

describe('buildClaudeArgs', () => {
  it('research: print mode + json + read-only disallow list', () => {
    const r = buildClaudeArgs({ ...base, taskType: 'research' });
    expect(r.ok && r.args).toEqual(['-p', '--output-format', 'json', '--disallowedTools', 'Write,Edit,NotebookEdit,Bash']);
    expect(r.ok && r.resuming).toBe(false);
  });

  it('execution: acceptEdits, no Bash, user-only settings', () => {
    const r = buildClaudeArgs({ ...base, taskType: 'execution' });
    expect(r.ok && r.args).toEqual([
      '-p', '--output-format', 'json', '--permission-mode', 'acceptEdits',
      '--disallowedTools', 'Bash,NotebookEdit', '--setting-sources', 'user',
    ]);
  });

  it('qa: strict MCP config with only the chrome-devtools tools; refuses without a config', () => {
    const r = buildClaudeArgs({ ...base, taskType: 'qa', mcpConfigPath: 'C:\\u\\qa.json' });
    expect(r.ok && r.args.slice(-5)).toEqual(['--mcp-config', 'C:\\u\\qa.json', '--strict-mcp-config', '--allowedTools', 'mcp__chrome-devtools__*']);
    expect(buildClaudeArgs({ ...base, taskType: 'qa' })).toMatchObject({ ok: false });
  });

  it('model gating and resume', () => {
    const m = buildClaudeArgs({ ...base, taskType: 'research', model: 'sonnet' });
    expect(m.ok && m.args.slice(-2)).toEqual(['--model', 'sonnet']);
    const bad = buildClaudeArgs({ ...base, taskType: 'research', model: 'a b' });
    expect(bad.ok && bad.args).not.toContain('--model');
    const res = buildClaudeArgs({ ...base, taskType: 'execution', resumeSessionId: 'sess-123abc' });
    expect(res.ok && res.resuming).toBe(true);
    expect(res.ok && res.args.slice(-3)).toEqual(['--resume', 'sess-123abc', RESUME_PROMPT]);
  });
});

describe('claudeAdapter', () => {
  it('always routes through cmd.exe on Windows (npm shims)', () => {
    expect(claudeAdapter.needsCmdShim('C:\\x\\claude.exe')).toBe(process.platform === 'win32');
  });
  it('parseOutput adds null token fields to the Claude JSON result', () => {
    const out = claudeAdapter.parseOutput(JSON.stringify({ result: 'ok', session_id: 's', total_cost_usd: 0.1, num_turns: 1 }), { taskType: 'research', ...base });
    expect(out).toMatchObject({ ok: true, report: 'ok', costUsd: 0.1, inputTokens: null, outputTokens: null });
  });
});

import { describe, it, expect, vi } from 'vitest';

// Keep the adapter from touching the real PATH / ~/.codex in these tests.
vi.mock('../../../scheduler/codex-opener', () => ({
  resolveCodexBin: () => null,
  resetCodexBinCache: () => {},
}));
vi.mock('../../codex-settings', () => ({
  resolveCodexDefaultModel: () => ({ model: 'gpt-5-codex', source: 'user' }),
}));

import {
  buildCodexArgs,
  classifyCodexNonZeroExit,
  codexAdapter,
  isCodexUsageLimitError,
  parseCodexEvents,
  parseCodexOutput,
} from '../codex';
import { RESUME_PROMPT } from '../shared';

// Captured from a real `codex exec --json` run (codex-cli 0.160.0, Spike 0).
const SUCCESS_JSONL = [
  '{"type":"thread.started","thread_id":"01a10fab-0053-7c11-a8c3-b4bbf69e4890"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello from codex\\nSTATUS: completed"}}',
  '{"type":"turn.completed","usage":{"input_tokens":17086,"cached_input_tokens":13312,"cache_write_input_tokens":0,"output_tokens":12,"reasoning_output_tokens":0}}',
].join('\n');

// Captured from a run with a bogus model: exit 1, the API error forwarded as JSON text.
const FAILED_JSONL = [
  '{"type":"thread.started","thread_id":"01a10fad-079b-7340-b159-9e6f9f939ed6"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `not-a-real-model-xyz` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'not-a-real-model-xyz\' model is not supported when using Codex with a ChatGPT account.\\"}}"}',
  '{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'not-a-real-model-xyz\' model is not supported when using Codex with a ChatGPT account.\\"}}"}}',
].join('\n');

const base = { cwd: 'E:\\wt\\card', outputFile: 'E:\\art\\card\\att-codex-last.md', model: null, resumeSessionId: null } as const;

describe('buildCodexArgs', () => {
  it('research: read-only sandbox, never-approve, stdin prompt, no --ephemeral', () => {
    const r = buildCodexArgs({ ...base, taskType: 'research' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resuming).toBe(false);
    expect(r.args).toEqual([
      'exec', '--json', '-o', base.outputFile, '-c', 'approval_policy="never"', '--skip-git-repo-check',
      '-s', 'read-only', '-C', base.cwd, '-',
    ]);
    expect(r.args).not.toContain('--ephemeral');
  });

  it('execution: workspace-write sandbox', () => {
    const r = buildCodexArgs({ ...base, taskType: 'execution' });
    expect(r.ok && r.args).toContain('workspace-write');
  });

  it('qa: read-only plus the engine profile; refuses without one', () => {
    const r = buildCodexArgs({ ...base, taskType: 'qa', qaProfile: 'agent-pulse-qa' });
    expect(r.ok && r.args.slice(-3)).toEqual(['-p', 'agent-pulse-qa', '-']);
    expect(r.ok && r.args).toContain('read-only');
    expect(buildCodexArgs({ ...base, taskType: 'qa' })).toMatchObject({ ok: false });
    expect(buildCodexArgs({ ...base, taskType: 'qa', qaProfile: 'bad name; rm' })).toMatchObject({ ok: false });
  });

  it('refuses to run without an output file', () => {
    expect(buildCodexArgs({ ...base, outputFile: null, taskType: 'research' })).toMatchObject({ ok: false });
  });

  it('passes a safe model with -m and drops an unsafe one', () => {
    const good = buildCodexArgs({ ...base, taskType: 'research', model: 'gpt-5-codex' });
    expect(good.ok && good.args).toContain('-m');
    expect(good.ok && good.args).toContain('gpt-5-codex');
    const bad = buildCodexArgs({ ...base, taskType: 'research', model: 'x && del *' });
    expect(bad.ok && bad.args).not.toContain('-m');
  });

  it('resume: exec resume <id> with the sandbox as a config override and the fixed prompt on argv', () => {
    const id = '01a10fab-0053-7c11-a8c3-b4bbf69e4890';
    const r = buildCodexArgs({ ...base, taskType: 'execution', resumeSessionId: id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resuming).toBe(true);
    expect(r.args.slice(0, 2)).toEqual(['exec', 'resume']);
    expect(r.args).toContain('sandbox_mode="workspace-write"');
    expect(r.args).not.toContain('-s');
    expect(r.args).not.toContain('-C');
    expect(r.args.slice(-2)).toEqual([id, RESUME_PROMPT]);
  });

  it('resume with an unsafe id degrades to a fresh run', () => {
    const r = buildCodexArgs({ ...base, taskType: 'execution', resumeSessionId: 'nope; rm -rf' });
    expect(r.ok && r.resuming).toBe(false);
    expect(r.ok && r.args[1]).toBe('--json');
  });
});

describe('parseCodexEvents', () => {
  it('reads the thread id, agent message, and usage from a success run', () => {
    const ev = parseCodexEvents(SUCCESS_JSONL);
    expect(ev.threadId).toBe('01a10fab-0053-7c11-a8c3-b4bbf69e4890');
    expect(ev.turns).toBe(1);
    expect(ev.lastMessage).toBe('hello from codex\nSTATUS: completed');
    expect(ev.error).toBeNull();
    expect(ev.usage).toEqual({ input: 17086, cachedInput: 13312, cacheWrite: 0, output: 12 });
  });

  it('unwraps the JSON-encoded API error from a failed turn and ignores warning items', () => {
    const ev = parseCodexEvents(FAILED_JSONL);
    expect(ev.error).toBe("The 'not-a-real-model-xyz' model is not supported when using Codex with a ChatGPT account.");
    expect(ev.lastMessage).toBeNull();
    expect(ev.turns).toBe(0);
  });

  it('tolerates non-JSON lines and sums usage across turns', () => {
    const multi = `warning: something\n${SUCCESS_JSONL}\n{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":5}}`;
    const ev = parseCodexEvents(multi);
    expect(ev.turns).toBe(2);
    expect(ev.usage.input).toBe(17186);
    expect(ev.usage.output).toBe(17);
  });
});

describe('parseCodexOutput', () => {
  it('prefers the -o file for the report and estimates cost from tokens at the card model', () => {
    const out = parseCodexOutput(
      SUCCESS_JSONL,
      { model: 'gpt-5-codex', outputFile: 'last.md' },
      () => 'from file\nSTATUS: completed\n',
    );
    expect(out.ok).toBe(true);
    expect(out.report).toBe('from file\nSTATUS: completed');
    expect(out.sessionId).toBe('01a10fab-0053-7c11-a8c3-b4bbf69e4890');
    expect(out.numTurns).toBe(1);
    expect(out.inputTokens).toBe(17086);
    expect(out.outputTokens).toBe(12);
    // (17086-13312) fresh @1.25 + 13312 cached @0.125 + 12 out @10, per 1M.
    const expected = (3774 * 1.25 + 13312 * 0.125 + 12 * 10) / 1_000_000;
    expect(out.costUsd).toBeCloseTo(expected, 8);
  });

  it('falls back to the JSONL agent message when the file is missing', () => {
    const out = parseCodexOutput(SUCCESS_JSONL, { model: null, outputFile: 'missing.md' }, () => null);
    expect(out.ok).toBe(true);
    expect(out.report).toBe('hello from codex\nSTATUS: completed');
  });

  it('uses the config.toml default model for pricing when the card has none, null when unpriced', () => {
    const priced = parseCodexOutput(SUCCESS_JSONL, { model: null, outputFile: null }, () => null);
    expect(priced.costUsd).not.toBeNull();
    const unpriced = parseCodexOutput(SUCCESS_JSONL, { model: null, outputFile: null }, () => null, () => 'totally-unknown-model');
    expect(unpriced.costUsd).toBeNull();
    expect(unpriced.inputTokens).toBe(17086);
  });

  it('reports a failed turn as a failure with the unwrapped reason, keeping the thread id', () => {
    const out = parseCodexOutput(FAILED_JSONL, { model: null, outputFile: null }, () => null);
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('not supported when using Codex');
    expect(out.sessionId).toBe('01a10fad-079b-7340-b159-9e6f9f939ed6');
    expect(out.inputTokens).toBeNull();
  });

  it('fails cleanly on empty / garbage stdout', () => {
    expect(parseCodexOutput('', { model: null, outputFile: null }, () => null).ok).toBe(false);
    expect(parseCodexOutput('not json', { model: null, outputFile: null }, () => null).ok).toBe(false);
    expect(parseCodexOutput(SUCCESS_JSONL, { model: null, outputFile: 'f' }, () => '   ').ok).toBe(true); // file empty → message fallback
  });
});

describe('usage-limit classification', () => {
  it('matches rate-limit / quota wording and not ordinary errors', () => {
    expect(isCodexUsageLimitError('You have hit your usage limit')).toBe(true);
    expect(isCodexUsageLimitError('Rate limit reached for gpt-5-codex')).toBe(true);
    expect(isCodexUsageLimitError('status 429 Too Many Requests')).toBe(true);
    expect(isCodexUsageLimitError('insufficient_quota')).toBe(true);
    expect(isCodexUsageLimitError('model is not supported')).toBe(false);
    expect(isCodexUsageLimitError(null)).toBe(false);
  });

  it('classifyNonZeroExit prefers the JSONL error over stream tails', () => {
    const out = classifyCodexNonZeroExit(1, FAILED_JSONL, 'some stderr noise');
    expect(out.reason).toBe("codex exited with code 1: The 'not-a-real-model-xyz' model is not supported when using Codex with a ChatGPT account.");
    expect(out.usageLimit).toBe(false);
    const limit = classifyCodexNonZeroExit(1, '', 'Error: usage limit reached, resets at 16:00');
    expect(limit.usageLimit).toBe(true);
  });
});

describe('codexAdapter', () => {
  it('spawns a real .exe directly and only shims npm .cmd/.bat', () => {
    const win = process.platform === 'win32';
    expect(codexAdapter.needsCmdShim('C:\\x\\codex.exe')).toBe(false);
    expect(codexAdapter.needsCmdShim('C:\\npm\\codex.cmd')).toBe(win);
    expect(codexAdapter.needsCmdShim('/usr/local/bin/codex')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { parseClaudeJsonOutput } from '../runner';
import { buildResearchPrompt } from '../prompt';

// Shape captured from a real `claude -p --output-format json` run (see plan spike).
const SUCCESS_JSON = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 3,
  result: '# Report\n\nFindings here.',
  session_id: 'sess-123',
  total_cost_usd: 0.42,
});

describe('parseClaudeJsonOutput', () => {
  it('parses a successful result with cost/turns/session', () => {
    const out = parseClaudeJsonOutput(SUCCESS_JSON);
    expect(out.ok).toBe(true);
    expect(out.report).toContain('# Report');
    expect(out.costUsd).toBeCloseTo(0.42);
    expect(out.numTurns).toBe(3);
    expect(out.sessionId).toBe('sess-123');
  });

  it('tolerates warning lines before the JSON object', () => {
    const out = parseClaudeJsonOutput(`some warning\nanother line\n${SUCCESS_JSON}`);
    expect(out.ok).toBe(true);
  });

  it('reports is_error results as failures but keeps the cost', () => {
    const out = parseClaudeJsonOutput(JSON.stringify({
      type: 'result', is_error: true, result: 'Credit balance too low', total_cost_usd: 0.01, num_turns: 1,
    }));
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('Credit balance');
    expect(out.costUsd).toBeCloseTo(0.01);
  });

  it('fails cleanly on garbage or empty stdout', () => {
    expect(parseClaudeJsonOutput('').ok).toBe(false);
    expect(parseClaudeJsonOutput('not json at all').ok).toBe(false);
    expect(parseClaudeJsonOutput('{"broken": ').ok).toBe(false);
  });

  it('treats an empty result string as a failure', () => {
    const out = parseClaudeJsonOutput(JSON.stringify({ type: 'result', is_error: false, result: '  ' }));
    expect(out.ok).toBe(false);
    expect(out.reason).toContain('empty result');
  });
});

describe('buildResearchPrompt', () => {
  it('carries the card title/description and the read-only report contract', () => {
    const prompt = buildResearchPrompt({ title: 'Audit the bridge', description: 'Look at port 4242 handling.' });
    expect(prompt).toContain('Audit the bridge');
    expect(prompt).toContain('port 4242');
    expect(prompt).toContain('READ-ONLY');
    expect(prompt).toContain('markdown report');
  });

  it('handles an empty description', () => {
    const prompt = buildResearchPrompt({ title: 'T', description: '  ' });
    expect(prompt).toContain('interpret the title');
  });
});

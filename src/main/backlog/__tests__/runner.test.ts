import { describe, it, expect } from 'vitest';
import { parseClaudeJsonOutput, isUsageLimitError, isSafeSessionId, parseSelfReportedStatus, classifyNonZeroExit } from '../runner';
import { buildResearchPrompt, buildExecutionPrompt, buildQaPrompt } from '../prompt';
import { buildCmdShimArgs } from '../../scheduler/opener';

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

describe('parseSelfReportedStatus', () => {
  it('reads the trailing STATUS marker in each variant', () => {
    expect(parseSelfReportedStatus('done\n\nSTATUS: completed')).toBe('completed');
    expect(parseSelfReportedStatus('some progress\nSTATUS: partial')).toBe('partial');
    expect(parseSelfReportedStatus('I could not read the plan.\nSTATUS: blocked')).toBe('blocked');
  });

  it('is case-insensitive and tolerates trailing text/whitespace', () => {
    expect(parseSelfReportedStatus('x\nstatus:   Blocked — no plan file')).toBe('blocked');
  });

  it('takes the LAST marker when the word also appears earlier in prose', () => {
    expect(parseSelfReportedStatus('I was blocked at first.\nThen finished.\nSTATUS: completed')).toBe('completed');
  });

  it('returns null when no marker is present or input is empty', () => {
    expect(parseSelfReportedStatus('just a normal report, no footer')).toBeNull();
    expect(parseSelfReportedStatus('')).toBeNull();
    expect(parseSelfReportedStatus(undefined)).toBeNull();
    // Bare mention without the STATUS: prefix must not match.
    expect(parseSelfReportedStatus('the task is completed')).toBeNull();
  });
});

describe('buildResearchPrompt', () => {
  it('carries the card title/description and the read-only report contract', () => {
    const prompt = buildResearchPrompt({ title: 'Audit the bridge', description: 'Look at port 4242 handling.' });
    expect(prompt).toContain('Audit the bridge');
    expect(prompt).toContain('port 4242');
    expect(prompt).toContain('READ-ONLY');
    expect(prompt).toContain('markdown report');
    expect(prompt).toContain('STATUS: blocked');
  });

  it('handles an empty description', () => {
    const prompt = buildResearchPrompt({ title: 'T', description: '  ' });
    expect(prompt).toContain('interpret the title');
  });
});

describe('buildExecutionPrompt', () => {
  it('carries title/description/criteria and the no-commit contract', () => {
    const prompt = buildExecutionPrompt({
      title: 'Fix flaky retry',
      description: 'The bridge retries twice.',
      acceptanceCriteria: ['retry is configurable', '  tests pass  ', ''],
    });
    expect(prompt).toContain('Fix flaky retry');
    expect(prompt).toContain('The bridge retries twice.');
    expect(prompt).toContain('1. retry is configurable');
    expect(prompt).toContain('2. tests pass');
    expect(prompt).toContain('uncommitted');
    expect(prompt).toContain('diff is your deliverable');
    expect(prompt).toContain('STATUS: blocked');
  });

  it('omits the criteria section when the card has none', () => {
    const prompt = buildExecutionPrompt({ title: 'T', description: 'd', acceptanceCriteria: [] });
    expect(prompt).not.toContain('Acceptance criteria');
  });
});

describe('buildQaPrompt', () => {
  const card = {
    title: 'Verify dark mode',
    description: 'The settings window gained a theme toggle.',
    qaUrl: 'http://localhost:5173',
    acceptanceCriteria: ['toggle switches theme', '  no console errors  ', ''],
  };

  it('carries title/description/url/criteria and the read-only browser contract', () => {
    const prompt = buildQaPrompt(card, 'C:\\artifacts\\c1\\a1-screens');
    expect(prompt).toContain('Verify dark mode');
    expect(prompt).toContain('theme toggle');
    expect(prompt).toContain('App URL: http://localhost:5173');
    expect(prompt).toContain('C:\\artifacts\\c1\\a1-screens');
    expect(prompt).toContain('1. toggle switches theme');
    expect(prompt).toContain('2. no console errors');
    expect(prompt).toContain('READ-ONLY');
    expect(prompt).toContain('take_screenshot');
    expect(prompt).toContain('filePath');
    // Screenshots must be embedded with markdown image syntax so the report
    // viewer can render them inline.
    expect(prompt).toContain('![');
    expect(prompt).toContain('STATUS: blocked');
  });

  it('a failing criterion is still a completed QA run — the contract says so', () => {
    const prompt = buildQaPrompt(card, '/tmp/screens');
    expect(prompt).toContain('pass OR fail');
  });

  it('flags a missing URL instead of omitting the line silently', () => {
    const prompt = buildQaPrompt({ ...card, qaUrl: null }, '/tmp/screens');
    expect(prompt).toContain('none set');
    expect(prompt).toContain('STATUS: blocked');
  });

  it('asks for derived checks when the card has no criteria', () => {
    const prompt = buildQaPrompt({ ...card, acceptanceCriteria: [] }, '/tmp/screens');
    expect(prompt).toContain('None were provided');
  });
});

describe('prompt attachments', () => {
  it('inlines attached files verbatim under an Attached files section', () => {
    const prompt = buildResearchPrompt(
      { title: 'T', description: 'd' },
      [{ filename: 'plan.md', content: '# Plan\nline two' }],
    );
    expect(prompt).toContain('## Attached files');
    expect(prompt).toContain('### plan.md');
    expect(prompt).toContain('# Plan\nline two');
  });

  it('omits the section entirely when there are no attachments', () => {
    expect(buildResearchPrompt({ title: 'T', description: 'd' }, [])).not.toContain('Attached files');
    expect(buildExecutionPrompt({ title: 'T', description: 'd', acceptanceCriteria: [] })).not.toContain('Attached files');
  });

  it('fences content longer than any internal backtick run so it cannot break out', () => {
    // Content contains a ``` fence — the wrapper must use a longer fence.
    const content = 'here is code:\n```\nconst x = 1;\n```\ndone';
    const prompt = buildExecutionPrompt(
      { title: 'T', description: 'd', acceptanceCriteria: [] },
      [{ filename: 'snippet.md', content }],
    );
    expect(prompt).toContain('````'); // 4+ backticks wrap the 3-backtick content
    expect(prompt).toContain(content);
  });
});

describe('buildCmdShimArgs', () => {
  it('wraps the whole command in one outer quote pair for /s /c', () => {
    const args = buildCmdShimArgs('C:\\Program Files\\nodejs\\claude.cmd', ['-p', '--output-format', 'json']);
    expect(args).toEqual(['/d', '/s', '/c', '""C:\\Program Files\\nodejs\\claude.cmd" -p --output-format json"']);
  });

  it('quotes each spaced arg — the resume-prompt case that broke /c', () => {
    const args = buildCmdShimArgs('C:\\Program Files\\nodejs\\claude.cmd', ['--resume', 'abc-123', 'Continue the task.']);
    expect(args[3]).toBe('""C:\\Program Files\\nodejs\\claude.cmd" --resume abc-123 "Continue the task.""');
  });

  it('leaves an unspaced bin and args unquoted inside the line', () => {
    const args = buildCmdShimArgs('C:\\npm\\claude.cmd', ['-p']);
    expect(args).toEqual(['/d', '/s', '/c', '"C:\\npm\\claude.cmd -p"']);
  });

  it('strips embedded double quotes defensively', () => {
    const args = buildCmdShimArgs('C:\\npm\\claude.cmd', ['a"b']);
    expect(args[3]).toBe('"C:\\npm\\claude.cmd ab"');
  });
});

// The string shape above is asserted exactly; this proves the shape actually
// survives cmd.exe on a real Windows box — a fake .cmd shim in a spaced dir
// echoes its argv back. Skipped on POSIX (no cmd.exe).
describe.skipIf(process.platform !== 'win32')('buildCmdShimArgs through real cmd.exe', () => {
  it('spaced bin + spaced arg both arrive intact', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { spawn } = await import('child_process');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse cmd '));
    const bin = path.join(dir, 'fakeclaude.cmd');
    fs.writeFileSync(bin, '@echo off\r\necho ARGS=[%*]\r\n');
    try {
      const out = await new Promise<string>((resolve, reject) => {
        const proc = spawn(
          process.env.ComSpec || 'cmd.exe',
          buildCmdShimArgs(bin, ['-p', '--resume', 'abc-123', 'Continue the task from where you left off.']),
          { windowsHide: true, windowsVerbatimArguments: true },
        );
        let stdout = '';
        proc.stdout.on('data', (d) => (stdout += d));
        proc.on('close', (code) => (code === 0 ? resolve(stdout) : reject(new Error(`exit ${code}: ${stdout}`))));
        proc.on('error', reject);
      });
      expect(out).toContain('ARGS=[-p --resume abc-123 "Continue the task from where you left off."]');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isUsageLimitError', () => {
  it('matches common usage-exhaustion wordings', () => {
    expect(isUsageLimitError('5-hour usage limit reached')).toBe(true);
    expect(isUsageLimitError('You have hit your rate limit')).toBe(true);
    expect(isUsageLimitError('Limit exceeded, resets at 4am')).toBe(true);
    expect(isUsageLimitError('out of credits')).toBe(true);
  });

  it('does not match ordinary failures', () => {
    expect(isUsageLimitError('module not found: ./foo')).toBe(false);
    expect(isUsageLimitError('claude exited with code 1: syntax error')).toBe(false);
    expect(isUsageLimitError(null)).toBe(false);
    expect(isUsageLimitError('')).toBe(false);
  });

  it('matches the real session-limit wording claude prints on exhaustion', () => {
    // Captured verbatim from a failed backlog run's transcript.
    expect(isUsageLimitError("You've hit your session limit — resets 3am (Asia/Calcutta)")).toBe(true);
  });
});

describe('classifyNonZeroExit', () => {
  // Regression: claude prints the session-limit notice to STDOUT and exits 1
  // before emitting the JSON result, leaving stderr empty. The old code only
  // scanned stderr, so usageLimit came back false and the card was blocked
  // (and cascaded) instead of paused-until-reset.
  it('flags a usage limit from stdout when stderr is empty', () => {
    const out = classifyNonZeroExit(1, "You've hit your session limit — resets 3am (Asia/Calcutta)", '');
    expect(out.usageLimit).toBe(true);
    expect(out.reason).toContain('session limit');
  });

  it('prefers stderr for the detail but still checks it for usage limits', () => {
    const out = classifyNonZeroExit(1, 'irrelevant stdout', 'usage limit reached, try again later');
    expect(out.usageLimit).toBe(true);
    expect(out.reason).toContain('usage limit reached');
  });

  it('reports a bare exit code with no usage flag for an ordinary crash', () => {
    const out = classifyNonZeroExit(1, '', '');
    expect(out).toEqual({ reason: 'claude exited with code 1', usageLimit: false });
  });

  it('does not mistake an ordinary stderr failure for a usage limit', () => {
    const out = classifyNonZeroExit(1, '', 'SyntaxError: Unexpected token');
    expect(out.usageLimit).toBe(false);
    expect(out.reason).toContain('SyntaxError');
  });
});

describe('isSafeSessionId', () => {
  it('accepts uuid-shaped ids and rejects argv-unsafe strings', () => {
    expect(isSafeSessionId('0e40aad9-6cf6-4014-8ab5-b48f79dd0b7c')).toBe(true);
    expect(isSafeSessionId('sess-123abc')).toBe(true);
    // cmd.exe metacharacters must never reach argv
    expect(isSafeSessionId('x && del *')).toBe(false);
    expect(isSafeSessionId('id;rm -rf')).toBe(false);
    expect(isSafeSessionId('short')).toBe(false); // below 8 chars
    expect(isSafeSessionId('')).toBe(false);
  });
});

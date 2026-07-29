import { describe, it, expect } from 'vitest';
import { encodeProjectDir, extractPlanFromTranscript } from '../plan-transcript';

/** One transcript line for an assistant turn carrying the given content parts. */
function line(parts: unknown[]): string {
  return JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: parts } });
}
const exitPlan = (plan: string) => ({ type: 'tool_use', name: 'ExitPlanMode', input: { plan } });
const text = (t: string) => ({ type: 'text', text: t });

describe('encodeProjectDir', () => {
  it('replaces the drive colon and backslashes with dashes (Windows)', () => {
    expect(encodeProjectDir('E:\\DDrive\\Github\\agent-pulse')).toBe('E--DDrive-Github-agent-pulse');
  });
  it('replaces forward slashes with dashes (POSIX)', () => {
    expect(encodeProjectDir('/home/user/proj')).toBe('-home-user-proj');
  });
});

describe('extractPlanFromTranscript', () => {
  it('returns the LAST ExitPlanMode plan when several were presented', () => {
    const content = [
      line([text('let me think')]),
      line([exitPlan('# Plan A')]),
      line([text('actually, revising')]),
      line([exitPlan('# Plan B (final)')]),
    ].join('\n');
    expect(extractPlanFromTranscript(content)).toBe('# Plan B (final)');
  });

  it('falls back to the last assistant text when no plan tool call is present', () => {
    const content = [line([text('first')]), line([text('second and final')])].join('\n');
    expect(extractPlanFromTranscript(content)).toBe('second and final');
  });

  it('prefers a plan over later assistant chatter', () => {
    const content = [line([exitPlan('# The Plan')]), line([text('ok done')])].join('\n');
    expect(extractPlanFromTranscript(content)).toBe('# The Plan');
  });

  it('ignores non-JSON lines and blank lines', () => {
    const content = ['warning: something', '', 'not json', line([exitPlan('# Plan')])].join('\n');
    expect(extractPlanFromTranscript(content)).toBe('# Plan');
  });

  it('returns null when there is nothing usable', () => {
    expect(extractPlanFromTranscript('')).toBeNull();
    expect(extractPlanFromTranscript(line([exitPlan('   ')]))).toBeNull();
    // A tool_use with the wrong name is not a plan.
    expect(extractPlanFromTranscript(line([{ type: 'tool_use', name: 'Read', input: { plan: 'x' } }]))).toBeNull();
  });
});

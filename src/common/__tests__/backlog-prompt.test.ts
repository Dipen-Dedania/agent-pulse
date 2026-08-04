import { describe, it, expect } from 'vitest';
import { buildPreviewPrompt, PREVIEW_SCREENSHOTS_DIR } from '../backlog-prompt';

// buildPreviewPrompt is the card editor's preview seam: it must dispatch to the
// same builder the runner (engine.ts) uses for each task type, so what the user
// previews is what will actually run.

const base = { title: 'Fix login', description: 'Make it work', acceptanceCriteria: [] as string[], qaUrl: null };

describe('buildPreviewPrompt', () => {
  it('routes research cards to the research contract', () => {
    const p = buildPreviewPrompt({ ...base, taskType: 'research' });
    expect(p).toContain('# Research task: Fix login');
    expect(p).toContain('READ-ONLY research task');
  });

  it('routes execution cards to the execution contract, numbering criteria', () => {
    const p = buildPreviewPrompt({
      ...base, taskType: 'execution', acceptanceCriteria: ['Logs in', 'No console errors'],
    });
    expect(p).toContain('# Task: Fix login');
    expect(p).toContain('CODE CHANGE task');
    expect(p).toContain('1. Logs in');
    expect(p).toContain('2. No console errors');
  });

  it('routes qa cards to the qa contract with the placeholder screenshots dir', () => {
    const p = buildPreviewPrompt({
      ...base, taskType: 'qa', qaUrl: 'http://localhost:5173', acceptanceCriteria: ['Theme toggles'],
    });
    expect(p).toContain('# QA task: Fix login');
    expect(p).toContain('App URL: http://localhost:5173');
    expect(p).toContain(PREVIEW_SCREENSHOTS_DIR);
    expect(p).toContain('READ-ONLY QA verification task');
  });

  it('inlines attachment bodies into the preview', () => {
    const p = buildPreviewPrompt(
      { ...base, taskType: 'research' },
      [{ filename: 'spec.md', content: 'hello world' }],
    );
    expect(p).toContain('## Attached files');
    expect(p).toContain('### spec.md');
    expect(p).toContain('hello world');
  });
});

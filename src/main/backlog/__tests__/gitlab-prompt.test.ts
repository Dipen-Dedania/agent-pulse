import { describe, it, expect } from 'vitest';
import { buildScoutPrompt, buildScoutResolvePrompt } from '../prompt';
import { fingerprintFor } from '../population-scheduler';

describe('buildScoutResolvePrompt', () => {
  it('names the project, host, get_project, and asks for a bare number', () => {
    const p = buildScoutResolvePrompt('gitlab.com', 'grp/sub/proj');
    expect(p).toContain('grp/sub/proj');
    expect(p).toContain('gitlab.com');
    expect(p).toContain('get_project');
    expect(p).toMatch(/bare number/i);
  });
});

describe('buildScoutPrompt', () => {
  it('assigned mode uses my_issues, state=opened, the project id, and the JSON contract', () => {
    const p = buildScoutPrompt(1234, { mode: 'assigned', labels: [] });
    expect(p).toContain('my_issues');
    expect(p).toContain('1234');
    expect(p).toContain('state=opened');
    expect(p).toMatch(/JSON array/i);
    expect(p).toContain('iid');
  });

  it('all mode uses list_issues over every open issue', () => {
    const p = buildScoutPrompt(1234, { mode: 'all', labels: [] });
    expect(p).toContain('list_issues');
    expect(p).toMatch(/ALL OPEN/);
  });

  it('bounds the scan: caps the issue count and previews the description', () => {
    const p = buildScoutPrompt(1234, { mode: 'all', labels: [] });
    expect(p).toMatch(/at most 50 issues/);
    expect(p).toMatch(/first 500 characters/);
  });

  it('label mode passes the configured labels to list_issues', () => {
    const p = buildScoutPrompt(1234, { mode: 'label', labels: ['bug', 'p1'] });
    expect(p).toContain('list_issues');
    expect(p).toContain('bug');
    expect(p).toContain('p1');
  });
});

describe('fingerprintFor', () => {
  it('keys on the numeric GitLab project id + issue iid', () => {
    expect(fingerprintFor(1234, 42)).toBe('gitlab:1234:42');
  });
});

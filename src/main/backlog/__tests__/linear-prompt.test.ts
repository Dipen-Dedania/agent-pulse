import { describe, it, expect } from 'vitest';
import { buildLinearTeamsPrompt, buildLinearProjectsPrompt, buildLinearScoutPrompt } from '../prompt';
import { linearFingerprintFor } from '../population-scheduler';

describe('buildLinearTeamsPrompt', () => {
  it('asks for list_teams and a JSON array with id/key/name', () => {
    const p = buildLinearTeamsPrompt();
    expect(p).toContain('list_teams');
    expect(p).toMatch(/JSON array/i);
    expect(p).toContain('key');
  });
});

describe('buildLinearProjectsPrompt', () => {
  it('asks for list_projects scoped to the team id via the team param, JSON id/name out', () => {
    const p = buildLinearProjectsPrompt('team-uuid');
    expect(p).toContain('list_projects');
    expect(p).toContain('team=team-uuid');
    expect(p).toMatch(/JSON array/i);
    expect(p).toMatch(/id and name/);
  });
});

describe('buildLinearScoutPrompt', () => {
  it('assigned mode names the team id, assignee = me, list_issues, and the JSON contract', () => {
    const p = buildLinearScoutPrompt('team-uuid', { mode: 'assigned', labels: [] });
    expect(p).toContain('team-uuid');
    expect(p).toContain('list_issues');
    expect(p).toMatch(/assigned to me/i);
    expect(p).toContain('identifier');
  });

  it('all mode lists every open issue', () => {
    const p = buildLinearScoutPrompt('team-uuid', { mode: 'all', labels: [] });
    expect(p).toMatch(/ALL OPEN/);
  });

  it('bounds the scan: caps the issue count and previews the description', () => {
    const p = buildLinearScoutPrompt('team-uuid', { mode: 'all', labels: [] });
    expect(p).toMatch(/at most 50 issues/);
    expect(p).toMatch(/first 500 characters/);
  });

  it('label mode passes the configured labels', () => {
    const p = buildLinearScoutPrompt('team-uuid', { mode: 'label', labels: ['FE', 'Bug'] });
    expect(p).toContain('FE');
    expect(p).toContain('Bug');
  });

  it('scopes to a Linear project via the `project` param when a projectId is given', () => {
    const p = buildLinearScoutPrompt('team-uuid', { mode: 'all', labels: [] }, 'proj-uuid');
    expect(p).toContain('project=proj-uuid');
    expect(p).toMatch(/Restrict to the Linear project/);
  });

  it('omits the project scope clause when no projectId is given', () => {
    const p = buildLinearScoutPrompt('team-uuid', { mode: 'all', labels: [] });
    expect(p).not.toMatch(/project=/);
    expect(p).not.toMatch(/Restrict to the Linear project/);
  });
});

describe('linearFingerprintFor', () => {
  it('keys on the team id + issue identifier', () => {
    expect(linearFingerprintFor('team-uuid', 'DEV-1036')).toBe('linear:team-uuid:DEV-1036');
  });
});

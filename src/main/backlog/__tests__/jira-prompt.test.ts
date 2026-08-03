import { describe, it, expect } from 'vitest';
import { buildJiraSitesPrompt, buildJiraProjectsPrompt, buildJiraScoutPrompt, isValidJiraProjectKey } from '../prompt';
import { jiraFingerprintFor } from '../population-scheduler';

describe('buildJiraSitesPrompt', () => {
  it('asks for getAccessibleAtlassianResources and a JSON array with cloudId/siteUrl/name', () => {
    const p = buildJiraSitesPrompt();
    expect(p).toContain('getAccessibleAtlassianResources');
    expect(p).toMatch(/JSON array/i);
    expect(p).toContain('cloudId');
    expect(p).toContain('siteUrl');
  });
});

describe('buildJiraProjectsPrompt', () => {
  it('asks for getVisibleJiraProjects scoped to the cloudId, values[] out, JSON key/name', () => {
    const p = buildJiraProjectsPrompt('cloud-1');
    expect(p).toContain('getVisibleJiraProjects');
    expect(p).toContain('cloudId=cloud-1');
    expect(p).toContain('expandIssueTypes=false');
    expect(p).toMatch(/values\[\]/);
    expect(p).toMatch(/key and name/);
  });
});

describe('buildJiraScoutPrompt', () => {
  it('assigned mode builds project-scoped JQL with assignee=currentUser and statusCategory!=Done', () => {
    const p = buildJiraScoutPrompt('cloud-1', 'DSOC', { mode: 'assigned', labels: [] });
    expect(p).toContain('searchJiraIssuesUsingJql');
    expect(p).toContain('cloudId=cloud-1');
    expect(p).toContain('project = DSOC AND assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC');
    expect(p).toContain('responseContentFormat="markdown"');
    expect(p).toContain('issues.nodes');
  });

  it('all mode lists every open issue, project-scoped', () => {
    const p = buildJiraScoutPrompt('cloud-1', 'DSOC', { mode: 'all', labels: [] });
    expect(p).toContain('project = DSOC AND statusCategory != Done ORDER BY updated DESC');
  });

  it('label mode quotes the labels into a JQL IN list and strips quotes/backslashes', () => {
    const p = buildJiraScoutPrompt('cloud-1', 'DSOC', { mode: 'label', labels: ['Data"Team', 'Bug'] });
    expect(p).toContain('labels IN ("DataTeam", "Bug")');
    expect(p).toContain('statusCategory != Done');
  });

  it('label mode with no labels falls back to the all-open JQL', () => {
    const p = buildJiraScoutPrompt('cloud-1', 'DSOC', { mode: 'label', labels: [] });
    expect(p).toContain('project = DSOC AND statusCategory != Done ORDER BY updated DESC');
    expect(p).not.toMatch(/labels IN/);
  });

  it('passes maxResults=50 (the tool clamps to a 50 minimum anyway)', () => {
    const p = buildJiraScoutPrompt('cloud-1', 'DSOC', { mode: 'all', labels: [] });
    expect(p).toContain('maxResults=50');
  });

  it('does NOT pass a fields restriction (the Rovo search tool ignores it)', () => {
    const p = buildJiraScoutPrompt('cloud-1', 'DSOC', { mode: 'all', labels: [] });
    expect(p).not.toMatch(/fields=/);
  });

  it('gives the two-branch contract: inline JSON array OR the OFFLOADED sentinel', () => {
    // A busy project offloads to a file; the model must emit OFFLOADED and stop so the
    // runner can read that file, rather than flailing to the timeout.
    const p = buildJiraScoutPrompt('cloud-1', 'DSOC', { mode: 'all', labels: [] });
    expect(p).toContain('OFFLOADED');
    expect(p).toMatch(/do NOT read the\s+file/i);
    expect(p).toContain('issues.nodes');
  });

  it('an invalid project key never reaches the JQL — a non-matching sentinel is used instead', () => {
    const p = buildJiraScoutPrompt('cloud-1', 'lower-case; DROP', { mode: 'all', labels: [] });
    expect(p).not.toContain('lower-case; DROP');
    expect(p).toContain('project = __INVALID__');
  });
});

describe('isValidJiraProjectKey', () => {
  it('accepts real Atlassian keys and rejects malformed ones', () => {
    expect(isValidJiraProjectKey('DSOC')).toBe(true);
    expect(isValidJiraProjectKey('AB')).toBe(true);
    expect(isValidJiraProjectKey('A_B1')).toBe(true);
    expect(isValidJiraProjectKey('a')).toBe(false);     // must start uppercase
    expect(isValidJiraProjectKey('A')).toBe(false);      // needs ≥2 chars
    expect(isValidJiraProjectKey('DSOC-482')).toBe(false); // hyphen not allowed
    expect(isValidJiraProjectKey('has space')).toBe(false);
  });
});

describe('jiraFingerprintFor', () => {
  it('keys on the cloudId + stable numeric issue id', () => {
    expect(jiraFingerprintFor('b890fdb7', '36893')).toBe('jira:b890fdb7:36893');
  });
});

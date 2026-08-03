import { describe, it, expect } from 'vitest';
import { parseJiraSites, parseJiraProjects, parseJiraIssues } from '../jira-scout';

describe('parseJiraSites', () => {
  it('parses cloudId/siteUrl/name and dedupes duplicate rows by id', () => {
    // getAccessibleAtlassianResources returns one row per scope group — same id.
    const out = parseJiraSites(JSON.stringify([
      { id: 'cloud-1', url: 'https://zuru.atlassian.net', name: 'zuru', scopes: ['read:jira-work'] },
      { id: 'cloud-1', url: 'https://zuru.atlassian.net', name: 'zuru', scopes: ['read:confluence-content'] },
      { id: 'cloud-2', url: 'https://other.atlassian.net', name: 'other', scopes: ['read:jira-work'] },
    ]));
    expect(out).toEqual([
      { cloudId: 'cloud-1', siteUrl: 'https://zuru.atlassian.net', name: 'zuru' },
      { cloudId: 'cloud-2', siteUrl: 'https://other.atlassian.net', name: 'other' },
    ]);
  });

  it('drops rows missing an id; accepts cloudId/siteUrl aliases', () => {
    expect(parseJiraSites('[{"url":"https://x","name":"noid"}]')).toEqual([]);
    expect(parseJiraSites('[{"cloudId":"c1","siteUrl":"https://x","name":"X"}]')).toEqual([
      { cloudId: 'c1', siteUrl: 'https://x', name: 'X' },
    ]);
  });

  it('tolerates a ```json fence / object wrapper; garbage → []', () => {
    expect(parseJiraSites('```json\n[{"id":"c1","url":"u","name":"n"}]\n```')).toHaveLength(1);
    expect(parseJiraSites('{"values":[{"id":"c1","url":"u","name":"n"}]}')).toHaveLength(1);
    expect(parseJiraSites('not json')).toEqual([]);
    expect(parseJiraSites(null)).toEqual([]);
  });
});

describe('parseJiraProjects', () => {
  it('reads .values[] and requires key + name, dropping partial rows', () => {
    const out = parseJiraProjects(JSON.stringify({
      values: [
        { id: '1', key: 'DSOC', name: 'Data - Sales Ops & Category' },
        { id: '2', key: 'NONAME' },
        { id: '3', name: 'No key' },
      ],
      total: 3, isLast: true,
    }));
    expect(out).toEqual([
      { key: 'DSOC', name: 'Data - Sales Ops & Category' },
      { key: 'NONAME', name: 'NONAME' }, // name falls back to key
    ]);
  });

  it('accepts a bare array and a ```json fence; garbage → []', () => {
    expect(parseJiraProjects('[{"key":"AB","name":"A B"}]')).toEqual([{ key: 'AB', name: 'A B' }]);
    expect(parseJiraProjects('```json\n{"values":[{"key":"CD","name":"C D"}]}\n```')).toEqual([{ key: 'CD', name: 'C D' }]);
    expect(parseJiraProjects('not json')).toEqual([]);
    expect(parseJiraProjects(null)).toEqual([]);
  });
});

describe('parseJiraIssues', () => {
  // Real envelope shape captured live from zuru.atlassian.net, project DSOC.
  const dsoc = JSON.stringify({
    issues: {
      nodes: [
        {
          id: '36893', key: 'DSOC-482',
          webUrl: 'https://zuru.atlassian.net/browse/DSOC-482',
          fields: {
            summary: 'UK Dunnhumby Quarterly Ingestion New Design',
            description: '# Context\n\nWe came to realize…',
            labels: ['DataTeamIndia'],
            status: { statusCategory: { key: 'new' } },
          },
        },
        {
          id: '36989', key: 'DSOC-498',
          webUrl: 'https://zuru.atlassian.net/browse/DSOC-498',
          fields: { summary: 'DE ROSSMANN - Toys Stock Data Ingestion', description: '1.Download historical data…', labels: [] },
        },
      ],
      pageInfo: { hasNextPage: true, endCursor: 'Ck11' },
    },
  });

  it('parses the raw offloaded envelope (full REST rep with issuetype/project/avatars junk)', () => {
    // The Rovo search tool ignores `fields` and returns the full node per issue; the
    // runner reads that offloaded file and hands it here verbatim. The parser must pick
    // out summary/labels/description/webUrl/id/key and ignore the surrounding metadata.
    const bloated = JSON.stringify({
      issues: {
        nodes: [
          {
            expand: 'renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations',
            id: '36970',
            self: 'https://api.atlassian.com/ex/jira/CLOUD/rest/api/3/issue/36970',
            key: 'DSOC-494',
            webUrl: 'https://zuru.atlassian.net/browse/DSOC-494',
            fields: {
              summary: 'Unify+ Login Failure in Superdrug Pipeline',
              issuetype: { self: 'https://api…', id: '10356', iconUrl: 'https://api…/avatar/10316', name: 'Subtask', subtask: true },
              project: { self: 'https://api…', id: '10264', key: 'DSOC', name: 'Data - Sales Ops & Category', avatarUrls: { '48x48': 'https://api…', '24x24': 'https://api…' } },
              description: '### Summary\n\nWorkflow is being blocked by a Unity+ login failure.',
              labels: ['DataTeamIndia'],
              reporter: { accountId: '712020:abc', avatarUrls: { '48x48': 'https://api…' } },
            },
          },
        ],
        webUrl: 'https://zuru.atlassian.net/browse/DSOC-494',
        pageInfo: { hasNextPage: true, endCursor: 'Ck11' },
      },
    });
    expect(parseJiraIssues(bloated)).toEqual([
      {
        issueId: '36970', issueKey: 'DSOC-494',
        title: 'Unify+ Login Failure in Superdrug Pipeline',
        webUrl: 'https://zuru.atlassian.net/browse/DSOC-494',
        labels: ['DataTeamIndia'],
        description: '### Summary\n\nWorkflow is being blocked by a Unity+ login failure.',
      },
    ]);
  });

  it('reads issues.nodes[] and maps id/key/summary/webUrl/labels/description', () => {
    expect(parseJiraIssues(dsoc)).toEqual([
      {
        issueId: '36893', issueKey: 'DSOC-482',
        title: 'UK Dunnhumby Quarterly Ingestion New Design',
        webUrl: 'https://zuru.atlassian.net/browse/DSOC-482',
        labels: ['DataTeamIndia'], description: '# Context\n\nWe came to realize…',
      },
      {
        issueId: '36989', issueKey: 'DSOC-498',
        title: 'DE ROSSMANN - Toys Stock Data Ingestion',
        webUrl: 'https://zuru.atlassian.net/browse/DSOC-498',
        labels: [], description: '1.Download historical data…',
      },
    ]);
  });

  it('accepts a numeric id and top-level aliases the scout may reshape to', () => {
    const flat = '[{"id":36893,"key":"DSOC-482","title":"T","webUrl":"u","labels":["a"],"description":"d"}]';
    expect(parseJiraIssues(flat)).toEqual([
      { issueId: '36893', issueKey: 'DSOC-482', title: 'T', webUrl: 'u', labels: ['a'], description: 'd' },
    ]);
  });

  it('tolerates a ```json fence and leading prose; object/garbage → []', () => {
    expect(parseJiraIssues('```json\n' + dsoc + '\n```')).toHaveLength(2);
    expect(parseJiraIssues('Here are the issues:\n' + dsoc)).toHaveLength(2);
    expect(parseJiraIssues('not json')).toEqual([]);
    expect(parseJiraIssues(null)).toEqual([]);
  });

  it('extracts the array past a prose preamble that itself contains a [bracket]', () => {
    // The cheap model narrates before the fence, and its preamble can carry a
    // stray bracket (a markdown [link]) — a naive indexOf('[') would slice from
    // there and fail. The balanced scanner skips it to the real array.
    const report = 'I searched [the DSOC project] and found 2 issues:\n```json\n' + dsoc + '\n```';
    expect(parseJiraIssues(report).map((i) => i.issueKey)).toEqual(['DSOC-482', 'DSOC-498']);
  });

  it('salvages the complete issues when a chatty model truncates the array mid-element', () => {
    // Observed DSOC failure: the model called the tool (10 issues), then hand-
    // reformatted them into its final message, which was cut off before the
    // closing ] (and the ```json fence never closes). We must recover the
    // complete elements, not lose all 10 to the one truncated tail object.
    const truncated =
      'Based on the first call with 3 issues, here is the formatted data:\n```json\n[\n' +
      '  {"id":"1","key":"DSOC-1","title":"one","description":"see [run](https://x/[y]) cc <custom data-id=\\"a\\">@X</custom>","webUrl":"u1","labels":["L1","L2"]},\n' +
      '  {"id":"2","key":"DSOC-2","title":"two","description":"[done]","webUrl":"u2","labels":[]},\n' +
      '  {"id":"3","key":"DSOC-3","title":"three","description":"Hi team, we have some issue about the data uploadin';
    expect(parseJiraIssues(truncated).map((i) => i.issueKey)).toEqual(['DSOC-1', 'DSOC-2']);
  });

  it('parses issues whose descriptions are full of markdown [links](urls)', () => {
    // JIRA/Confluence descriptions routinely contain [...] and [text](url); those
    // brackets live inside JSON strings and must not confuse span extraction.
    const brackety = JSON.stringify([
      { id: '1', key: 'X-1', title: 'a', webUrl: 'u', labels: [],
        description: 'see [run](https://x/[nested]) and [1], [2]' },
      { id: '2', key: 'X-2', title: 'b', webUrl: 'u', labels: [], description: '[done]' },
    ]);
    const report = 'Final JSON array [2 items]:\n' + brackety;
    expect(parseJiraIssues(report).map((i) => i.issueKey)).toEqual(['X-1', 'X-2']);
  });

  it('treats a leading [] (raw or fenced) as a genuine empty result, not a failure', () => {
    expect(parseJiraIssues('[]')).toEqual([]);
    expect(parseJiraIssues('```json\n[]\n```')).toEqual([]);
  });

  it('an empty labels array is never mistaken for an empty result', () => {
    // The [] here is a `labels` value mid-array — the real result has one issue.
    expect(parseJiraIssues('[{"id":"1","key":"X-1","title":"t","labels":[]}]')).toHaveLength(1);
  });

  it('drops rows missing issueId or title', () => {
    const out = parseJiraIssues('[{"key":"X-1","title":"no id"},{"id":"9","key":"X-2"},{"id":"10","key":"X-3","title":"ok"}]');
    expect(out).toEqual([{ issueId: '10', issueKey: 'X-3', title: 'ok', webUrl: '', labels: [], description: '' }]);
  });

  it('truncates an over-long description to the preview length (belt-and-braces)', () => {
    const long = 'x'.repeat(900);
    const desc = parseJiraIssues(`[{"id":"1","key":"X-1","title":"t","description":"${long}"}]`)[0].description;
    expect(desc.length).toBe(501); // 500 chars + the ellipsis
    expect(desc.endsWith('…')).toBe(true);
  });
});

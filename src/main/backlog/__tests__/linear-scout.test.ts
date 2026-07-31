import { describe, it, expect } from 'vitest';
import { parseLinearTeams, parseLinearProjects, parseLinearIssues } from '../linear-scout';

describe('parseLinearTeams', () => {
  it('parses id/key/name, defaults name to key, drops rows missing id', () => {
    const out = parseLinearTeams('[{"id":"u1","key":"DEV","name":"Development"},{"id":"u2","key":"DES"},{"key":"NOID"}]');
    expect(out).toEqual([
      { id: 'u1', key: 'DEV', name: 'Development' },
      { id: 'u2', key: 'DES', name: 'DES' },
    ]);
  });

  it('keeps keyless teams (list_teams returns only id + name)', () => {
    const out = parseLinearTeams('[{"id":"u1","name":"Development"},{"id":"u2","name":"Design"}]');
    expect(out).toEqual([
      { id: 'u1', name: 'Development' },
      { id: 'u2', name: 'Design' },
    ]);
    expect(out[0]).not.toHaveProperty('key');
  });

  it('tolerates a ```json fence and leading prose; non-array/garbage → []', () => {
    expect(parseLinearTeams('```json\n[{"id":"u1","key":"DEV","name":"D"}]\n```')).toHaveLength(1);
    expect(parseLinearTeams('Here are your teams:\n[{"id":"u1","key":"DEV"}]')).toHaveLength(1);
    expect(parseLinearTeams('{"id":"u1","key":"DEV"}')).toEqual([]);
    expect(parseLinearTeams('not json')).toEqual([]);
    expect(parseLinearTeams(null)).toEqual([]);
  });

  it('unwraps an object wrapper the agent sometimes emits ({ teams: [...] })', () => {
    expect(parseLinearTeams('{"teams":[{"id":"u1","key":"DEV","name":"Development"}]}')).toEqual([
      { id: 'u1', key: 'DEV', name: 'Development' },
    ]);
    expect(parseLinearTeams('```json\n{"data":[{"id":"u2","key":"DES"}]}\n```')).toHaveLength(1);
  });

  it('accepts teamKey / identifier aliases when key is absent', () => {
    expect(parseLinearTeams('[{"id":"u1","teamKey":"DEV"}]')[0].key).toBe('DEV');
    expect(parseLinearTeams('[{"id":"u2","identifier":"DES","name":"Design"}]')[0]).toEqual({ id: 'u2', key: 'DES', name: 'Design' });
  });
});

describe('parseLinearProjects', () => {
  it('parses id/name, dropping rows missing either', () => {
    const out = parseLinearProjects('[{"id":"p1","name":"Being"},{"id":"p2"},{"name":"NoId"}]');
    expect(out).toEqual([{ id: 'p1', name: 'Being' }]);
  });

  it('accepts a title alias for name and tolerates a ```json fence / object wrapper', () => {
    expect(parseLinearProjects('[{"id":"p1","title":"Rebuild"}]')).toEqual([{ id: 'p1', name: 'Rebuild' }]);
    expect(parseLinearProjects('```json\n{"projects":[{"id":"p2","name":"Design system"}]}\n```')).toEqual([
      { id: 'p2', name: 'Design system' },
    ]);
  });

  it('non-array / garbage / empty → []', () => {
    expect(parseLinearProjects('{"id":"p1","name":"obj"}')).toEqual([]);
    expect(parseLinearProjects('not json')).toEqual([]);
    expect(parseLinearProjects('')).toEqual([]);
    expect(parseLinearProjects(null)).toEqual([]);
  });
});

describe('parseLinearIssues', () => {
  const one = '[{"identifier":"DEV-1","title":"T","description":"d","url":"https://l/DEV-1","state":"Todo","labels":["FE"],"assignee":"R"}]';

  it('parses identifier/title/url/labels (ignoring state/assignee)', () => {
    expect(parseLinearIssues(one)).toEqual([
      { identifier: 'DEV-1', title: 'T', description: 'd', webUrl: 'https://l/DEV-1', labels: ['FE'] },
    ]);
  });

  it('accepts a webUrl alias for url', () => {
    expect(parseLinearIssues('[{"identifier":"X-2","title":"T","webUrl":"u"}]')[0].webUrl).toBe('u');
  });

  it('accepts a human-ref `id` as an identifier alias, but ignores a UUID id', () => {
    // list_issues returns the human ref (DEV-1036) under `id` when fields are projected.
    expect(parseLinearIssues('[{"id":"DEV-9","title":"T"}]')[0].identifier).toBe('DEV-9');
    // a raw UUID `id` with no title/identifier is not a valid ref → dropped.
    expect(parseLinearIssues('[{"id":"3f2b-uuid-99","title":"T"}]')).toEqual([]);
  });

  it('drops rows missing identifier or title; non-arrays → []', () => {
    expect(parseLinearIssues('[{"title":"no id"},{"identifier":"X-1"},{"identifier":"X-2","title":"ok"}]')).toEqual([
      { identifier: 'X-2', title: 'ok', description: '', webUrl: '', labels: [] },
    ]);
    expect(parseLinearIssues('{"identifier":"X","title":"obj"}')).toEqual([]);
    expect(parseLinearIssues('')).toEqual([]);
    expect(parseLinearIssues(null)).toEqual([]);
  });

  it('truncates an over-long description to the preview length (belt-and-braces)', () => {
    const long = 'x'.repeat(900);
    const desc = parseLinearIssues(`[{"identifier":"X-3","title":"t","description":"${long}"}]`)[0].description;
    expect(desc.length).toBe(501); // 500 chars + the ellipsis
    expect(desc.endsWith('…')).toBe(true);
  });
});

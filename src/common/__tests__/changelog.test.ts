import { describe, it, expect } from 'vitest';
import {
  parseChangelog,
  findEntry,
  sectionsBetween,
  renderSections,
  splitVersionSections,
} from '../changelog';

const FIXTURE = `# Changelog

All notable changes to this project are documented here.

## [Unreleased]

- Something not shipped yet

## [1.4.0] - 2026-10-05

### Added
- Release notes on the Updates tab
- A "What's new" card after updating

### Fixed
- Tray dot stuck after install

## 1.3.9 (2026-09-20)

### Changed
- Muse Code support

\`\`\`
## not a header, inside a fence
\`\`\`

## [1.3.5] - 2026-08-20
- Glowing border on waiting state
`;

describe('parseChangelog', () => {
  it('returns version sections newest first and skips [Unreleased] and preamble', () => {
    const entries = parseChangelog(FIXTURE);
    expect(entries.map((e) => e.version)).toEqual(['1.4.0', '1.3.9', '1.3.5']);
  });

  it('captures the date whether bracketed-dash or parenthesised', () => {
    const entries = parseChangelog(FIXTURE);
    expect(entries[0].date).toBe('2026-10-05');
    expect(entries[1].date).toBe('2026-09-20');
    expect(entries[2].date).toBe('2026-08-20');
  });

  it('keeps the body verbatim (subsections included) and trimmed', () => {
    const e = findEntry(parseChangelog(FIXTURE), '1.4.0')!;
    expect(e.body.startsWith('### Added')).toBe(true);
    expect(e.body).toContain('- Tray dot stuck after install');
    expect(e.body.endsWith('install')).toBe(true);
  });

  it('does not treat a ## line inside a code fence as a header', () => {
    const e = findEntry(parseChangelog(FIXTURE), '1.3.9')!;
    expect(e.body).toContain('## not a header, inside a fence');
    expect(parseChangelog(FIXTURE).some((x) => x.version.includes('not'))).toBe(false);
  });

  it('tolerates CRLF and a v-prefixed header', () => {
    const md = '## v2.0.0 - 2027-01-01\r\n- hi\r\n## [1.0.0]\r\n- old\r\n';
    const entries = parseChangelog(md);
    expect(entries.map((e) => e.version)).toEqual(['2.0.0', '1.0.0']);
    expect(entries[0].body).toBe('- hi');
    expect(entries[1].date).toBeNull();
  });

  it('returns [] for a file with no version headers', () => {
    expect(parseChangelog('# Changelog\n\nnothing yet\n')).toEqual([]);
  });
});

describe('sectionsBetween', () => {
  const entries = parseChangelog(FIXTURE);

  it('is half-open: excludes from, includes to', () => {
    expect(sectionsBetween(entries, '1.3.5', '1.4.0').map((e) => e.version)).toEqual(['1.4.0', '1.3.9']);
  });

  it('returns [] for an empty or inverted range', () => {
    expect(sectionsBetween(entries, '1.4.0', '1.4.0')).toEqual([]);
    expect(sectionsBetween(entries, '1.4.0', '1.3.5')).toEqual([]);
  });

  it('treats null bounds as open', () => {
    expect(sectionsBetween(entries, null, '1.3.9').map((e) => e.version)).toEqual(['1.3.9', '1.3.5']);
    expect(sectionsBetween(entries, '1.3.5', null).map((e) => e.version)).toEqual(['1.4.0', '1.3.9']);
  });
});

describe('renderSections / splitVersionSections', () => {
  it('round-trips through ## headers', () => {
    const entries = parseChangelog(FIXTURE);
    const md = renderSections(entries);
    expect(md.startsWith('## 1.4.0 (2026-10-05)')).toBe(true);
    const back = splitVersionSections(md, '0.0.0');
    expect(back.map((e) => e.version)).toEqual(['1.4.0', '1.3.9', '1.3.5']);
    expect(back[0].body).toBe(entries[0].body);
  });

  it('wraps a header-less blob as a single entry for the fallback version', () => {
    const back = splitVersionSections('- just some notes\n- more', '1.4.0');
    expect(back).toEqual([{ version: '1.4.0', date: null, body: '- just some notes\n- more' }]);
    expect(splitVersionSections('   \n', '1.4.0')).toEqual([]);
  });
});

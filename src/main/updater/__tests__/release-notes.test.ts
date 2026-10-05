import { describe, it, expect } from 'vitest';
import { normalizeReleaseNotes, toMarkdown } from '../release-notes';

const GITHUB_HTML = `<h2>What's Changed</h2>
<ul>
<li>feat: release notes on the Updates tab by <a class="user-mention" href="https://github.com/Dipen-Dedania">@Dipen-Dedania</a> in <a href="https://github.com/Dipen-Dedania/agent-pulse/pull/42">https://github.com/Dipen-Dedania/agent-pulse/pull/42</a></li>
<li>fix: tray dot &amp; <code>latest.yml</code> ordering &lt;edge case&gt;</li>
</ul>
<p><strong>Full Changelog</strong>: <a href="https://github.com/Dipen-Dedania/agent-pulse/compare/v1.3.9...v1.4.0">v1.3.9...v1.4.0</a></p>`;

describe('toMarkdown (HTML → Markdown)', () => {
  it('passes Markdown through untouched', () => {
    const md = '## 1.4.0\n\n- a *b* `c`';
    expect(toMarkdown(md)).toBe(md);
  });

  it('converts GitHub release-body HTML into headings, bullets, links and code', () => {
    const md = toMarkdown(GITHUB_HTML);
    expect(md).toContain("## What's Changed");
    expect(md).toContain('- feat: release notes on the Updates tab by [@Dipen-Dedania](https://github.com/Dipen-Dedania) in https://github.com/Dipen-Dedania/agent-pulse/pull/42');
    expect(md).toContain('- fix: tray dot & `latest.yml` ordering <edge case>');
    expect(md).toContain('**Full Changelog**: [v1.3.9...v1.4.0](https://github.com/Dipen-Dedania/agent-pulse/compare/v1.3.9...v1.4.0)');
    expect(md).not.toMatch(/<\/?(h\d|ul|ol|li|a|p|strong|em|code|pre)\b/i);
  });

  it('handles ordered lists, pre/code, br, entities and strips unknown tags', () => {
    const html = '<ol><li>one</li><li>two &#39;x&#39; &#x41;</li></ol><pre><code>a &lt; b\n</code></pre><span>tail<br>line</span><!-- hidden -->';
    const md = toMarkdown(html);
    expect(md).toContain('1. one\n2. two \'x\' A');
    expect(md).toContain('```\na < b\n```');
    expect(md).toContain('tail\nline');
    expect(md).not.toContain('hidden');
  });

  it('caps blank runs at one line and trims', () => {
    const md = toMarkdown('<p>a</p><p></p><p>b</p>');
    expect(md).toBe('a\n\nb');
  });
});

describe('normalizeReleaseNotes', () => {
  const MULTI = [
    '## 1.4.0 (2026-10-05)', '', '- new thing', '',
    '## 1.3.9 (2026-09-20)', '', '- older thing', '',
    '## 1.3.5 (2026-08-20)', '', '- oldest thing',
  ].join('\n');

  it('keeps only sections newer than the current version', () => {
    const out = normalizeReleaseNotes(MULTI, '1.3.9', '1.4.0')!;
    expect(out).toContain('## 1.4.0');
    expect(out).toContain('- new thing');
    expect(out).not.toContain('1.3.9');
    expect(out).not.toContain('oldest');
  });

  it('keeps every unseen section when several versions were skipped', () => {
    const out = normalizeReleaseNotes(MULTI, '1.3.1', '1.4.0')!;
    expect(out.indexOf('## 1.4.0')).toBeLessThan(out.indexOf('## 1.3.9'));
    expect(out.indexOf('## 1.3.9')).toBeLessThan(out.indexOf('## 1.3.5'));
  });

  it('returns null when nothing is newer than current', () => {
    expect(normalizeReleaseNotes(MULTI, '1.4.0', '1.4.0')).toBeNull();
    expect(normalizeReleaseNotes(MULTI, '2.0.0', '1.4.0')).toBeNull();
  });

  it('wraps a header-less blob under the latest version header', () => {
    const out = normalizeReleaseNotes('- just notes', '1.3.9', '1.4.0')!;
    expect(out).toBe('## 1.4.0\n\n- just notes');
  });

  it('converts GitHub HTML and attributes it to the latest version', () => {
    const out = normalizeReleaseNotes(GITHUB_HTML, '1.3.9', '1.4.0')!;
    expect(out.startsWith('## 1.4.0')).toBe(true);
    expect(out).toContain("## What's Changed");
    expect(out).toContain('- fix: tray dot & `latest.yml`');
  });

  it('handles the fullChangelog array shape, newest first, dropping seen versions', () => {
    const arr = [
      { version: '1.3.9', note: '<ul><li>old</li></ul>' },
      { version: '1.4.0', note: '<ul><li>new</li></ul>' },
      { version: '1.4.1', note: '<p>newer</p>' },
    ];
    const out = normalizeReleaseNotes(arr, '1.3.9', '1.4.1')!;
    expect(out.indexOf('## 1.4.1')).toBeLessThan(out.indexOf('## 1.4.0'));
    expect(out).toContain('- new');
    expect(out).toContain('newer');
    expect(out).not.toContain('old');
  });

  it('returns null for empty, "No content." (already blanked to ""), undefined and junk', () => {
    expect(normalizeReleaseNotes('', '1.3.9', '1.4.0')).toBeNull();
    expect(normalizeReleaseNotes('   \n', '1.3.9', '1.4.0')).toBeNull();
    expect(normalizeReleaseNotes(undefined, '1.3.9')).toBeNull();
    expect(normalizeReleaseNotes(null, '1.3.9')).toBeNull();
    expect(normalizeReleaseNotes(42, '1.3.9')).toBeNull();
    expect(normalizeReleaseNotes([{ version: '1.4.0', note: '' }], '1.3.9', '1.4.0')).toBeNull();
  });
});

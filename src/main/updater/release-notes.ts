// Turns whatever electron-updater hands us as `releaseNotes` into one
// Markdown string the renderer can hand straight to <Markdown>.
//
// Shapes seen in the wild:
//  - generic (Firebase) provider: the `releaseNotes` string from latest.yml,
//    which our build writes from CHANGELOG.md as Markdown with `## x.y.z`
//    section headers (several versions, newest first);
//  - GitHub provider, fullChangelog=false: the latest release body as HTML
//    (the atom feed's <content>), or "" when the release has no body;
//  - GitHub provider, fullChangelog=true: Array<{ version, note: html }>.
//
// Output: Markdown, `## x.y.z` sections, with any section for a version the
// user already has removed. A blob with no version headers is kept whole.

import { compareVersions } from '../../common/version';
import { renderSections, splitVersionSections, type ChangelogEntry } from '../../common/changelog';

export function normalizeReleaseNotes(raw: unknown, currentVersion: string, latestVersion?: string): string | null {
  let entries: ChangelogEntry[] = [];

  if (typeof raw === 'string') {
    const md = toMarkdown(raw);
    entries = splitVersionSections(md, latestVersion ?? currentVersion);
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') {
        entries.push(...splitVersionSections(toMarkdown(item), latestVersion ?? currentVersion));
        continue;
      }
      const rec = item as { version?: unknown; note?: unknown } | null;
      const note = typeof rec?.note === 'string' ? toMarkdown(rec.note) : '';
      const version = typeof rec?.version === 'string' ? rec.version : latestVersion ?? currentVersion;
      if (note.trim()) entries.push({ version: version.replace(/^v/i, ''), date: null, body: note.trim() });
    }
    entries.sort((a, b) => compareVersions(b.version, a.version));
  } else {
    return null;
  }

  const unseen = entries.filter((e) => compareVersions(e.version, currentVersion) > 0);
  if (unseen.length === 0) return null;
  const md = renderSections(unseen);
  return md || null;
}

/** HTML in, Markdown out. Non-HTML strings pass through untouched. */
export function toMarkdown(s: string): string {
  if (!looksLikeHtml(s)) return s;
  return htmlToMarkdown(s);
}

function looksLikeHtml(s: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(s);
}

// Small, purpose-built converter for GitHub release bodies. Handles the
// tags GitHub's Markdown renderer emits for typical notes (headings, lists,
// links, code, emphasis, paragraphs). Everything else is stripped to text.
// Not a general-purpose HTML converter and doesn't try to be.
function htmlToMarkdown(html: string): string {
  let s = html.replace(/\r\n?/g, '\n');

  // Drop comments and anything we never want to render.
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');

  // Fenced code first so inner markup is preserved verbatim. Entities stay
  // encoded here and everywhere below: a literal `<` can only appear in HTML
  // as `&lt;`, so decoding once at the very end (after the last tag strip) is
  // what keeps `&lt;edge case&gt;` from being eaten as a tag.
  s = s.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_m, code: string) =>
    `\n\n\`\`\`\n${code.replace(/\n$/, '')}\n\`\`\`\n\n`);
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code: string) =>
    `\n\n\`\`\`\n${stripTags(code).replace(/\n$/, '')}\n\`\`\`\n\n`);

  // Headings.
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, lvl: string, inner: string) =>
    `\n\n${'#'.repeat(Number(lvl))} ${inlineToMd(inner).trim()}\n\n`);

  // Lists: items become "- " / "1. " lines. Nested lists flatten; fine for notes.
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_m, inner: string) => {
    let n = 0;
    return '\n\n' + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_mm, li: string) =>
      `${++n}. ${inlineToMd(li).trim()}\n`) + '\n';
  });
  s = s.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_m, inner: string) =>
    '\n\n' + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_mm, li: string) =>
      `- ${inlineToMd(li).trim()}\n`) + '\n');
  // Stray <li> outside a list wrapper.
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, li: string) => `\n- ${inlineToMd(li).trim()}\n`);

  // Blockquotes and horizontal rules.
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) =>
    '\n\n' + inlineToMd(inner).trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n');
  s = s.replace(/<hr\s*\/?>/gi, '\n\n---\n\n');

  // Paragraph-ish containers become blank-line separated blocks.
  s = s.replace(/<\/?(p|div|section|article|details|summary|table|thead|tbody|tr)[^>]*>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');

  // Whatever's left is inline; then the one and only entity decode.
  s = decodeEntities(inlineToMd(s));

  // Collapse whitespace: trim line ends, cap blank runs at one.
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function inlineToMd(s: string): string {
  let out = s;
  out = out.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
    const t = stripTags(text).trim();
    const h = href.trim();
    if (!t) return h;
    if (t === h) return h; // GitHub autolinks: keep bare URL (renderer autolinks it)
    return `[${t}](${h})`;
  });
  out = out.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_m, c: string) => `\`${stripTags(c)}\``);
  out = out.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t: string, c: string) => `**${stripTags(c).trim()}**`);
  out = out.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t: string, c: string) => `_${stripTags(c).trim()}_`);
  out = out.replace(/<(del|s|strike)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t: string, c: string) => `~~${stripTags(c).trim()}~~`);
  out = out.replace(/<img\s+[^>]*alt=["']([^"']*)["'][^>]*\/?>/gi, (_m, alt: string) => (alt ? `[${alt}]` : ''));
  return stripTags(out);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', copy: '©', trade: '™', reg: '®',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1].toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    }
    return NAMED[ent.toLowerCase()] ?? m;
  });
}

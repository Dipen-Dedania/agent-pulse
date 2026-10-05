// Keep-a-Changelog parser shared by the release script (which slices the
// section for the version being shipped into the update manifest and the
// GitHub Release body) and the main process (which slices the sections a
// user just skipped over for the post-install "What's new" card).
//
// Recognised shape:
//
//   # Changelog
//   ## [Unreleased]
//   ## [1.4.0] - 2026-10-05
//   ### Added
//   - …
//   ## 1.3.9 (2026-09-20)        <- brackets / date are optional
//
// Anything above the first `## ` header is ignored. `[Unreleased]` (or any
// header that doesn't parse as a version) is dropped. Section bodies are
// returned verbatim, trimmed, so they can be re-emitted as Markdown.

import { compareVersions, isVersionLike, normalizeVersion } from './version';

export interface ChangelogEntry {
  version: string;        // normalized, no leading `v`
  date: string | null;    // as written (usually YYYY-MM-DD)
  body: string;           // markdown under the header, trimmed
}

const HEADER_RE = /^##\s+(?:\[([^\]]+)\]|(\S+))(?:\s*[-–—(]\s*([^)\n]*?)\)?\s*)?$/;

export function parseChangelog(md: string): ChangelogEntry[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const entries: ChangelogEntry[] = [];
  let current: { version: string; date: string | null; buf: string[] } | null = null;
  let inFence = false;

  const flush = () => {
    if (!current) return;
    entries.push({ version: current.version, date: current.date, body: current.buf.join('\n').trim() });
    current = null;
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence ? HEADER_RE.exec(line) : null;
    if (m) {
      flush();
      const label = (m[1] ?? m[2] ?? '').trim();
      if (!isVersionLike(label)) {
        // [Unreleased] or a prose header: skip until the next version header.
        current = null;
        continue;
      }
      current = { version: normalizeVersion(label), date: m[3]?.trim() || null, buf: [] };
      continue;
    }
    if (current) current.buf.push(line);
  }
  flush();

  // Newest first regardless of file order.
  return entries.sort((a, b) => compareVersions(b.version, a.version));
}

/** The entry for exactly `version`, or null. */
export function findEntry(entries: ChangelogEntry[], version: string): ChangelogEntry | null {
  const v = normalizeVersion(version);
  return entries.find((e) => compareVersions(e.version, v) === 0) ?? null;
}

/**
 * Entries in the half-open range `(from, to]`, newest first. `from` null
 * means "everything up to and including `to`". `to` null means "everything
 * above `from`".
 */
export function sectionsBetween(
  entries: ChangelogEntry[],
  from: string | null,
  to: string | null,
): ChangelogEntry[] {
  return entries.filter((e) => {
    if (from !== null && compareVersions(e.version, from) <= 0) return false;
    if (to !== null && compareVersions(e.version, to) > 0) return false;
    return true;
  });
}

/** Re-emit entries as Markdown with a `## x.y.z` header per section. */
export function renderSections(entries: ChangelogEntry[]): string {
  return entries
    .map((e) => {
      const head = e.date ? `## ${e.version} (${e.date})` : `## ${e.version}`;
      return e.body ? `${head}\n\n${e.body}` : head;
    })
    .join('\n\n')
    .trim();
}

/**
 * Split a Markdown blob that may already carry `## x.y.z` section headers
 * (the shape `renderSections` emits, and the shape electron-updater hands us
 * from a multi-version manifest) back into entries. A blob with no version
 * headers comes back as a single entry with `version` = `fallbackVersion`.
 */
export function splitVersionSections(md: string, fallbackVersion: string): ChangelogEntry[] {
  const parsed = parseChangelog(md);
  if (parsed.length > 0) return parsed;
  const body = md.trim();
  return body ? [{ version: normalizeVersion(fallbackVersion), date: null, body }] : [];
}

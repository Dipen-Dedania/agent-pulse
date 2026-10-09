// Minimal, table-aware editing of ~/.codex/config.toml without a TOML library
// (the project has none, and the two existing writers — enableCodexHooksFlag
// and the secret-protection managed block — are regex/line based too).
//
// Scope: upsert / remove ONE `key = value` line inside ONE `[table]`. Enough for
// `[tui] status_line = [...]`, and deliberately nothing more: we never reflow
// the rest of the file, so every other line survives byte for byte. CRLF and a
// BOM are preserved; the output always ends with a newline.

export interface TomlTableSpan {
  /** Line index of the `[table]` header. */
  header: number;
  /** Last line index belonging to the table (inclusive). */
  end: number;
}

export interface TomlKeySpan {
  /** First line index of the `key = …` entry. */
  start: number;
  /** Last line index (inclusive) — later than `start` for a multi-line array. */
  end: number;
  /** Everything after the `=` across the span, comments stripped, trimmed. */
  valueText: string;
  /** The raw first line. */
  line: string;
}

export const CODEX_MANAGED_MARK = '# agent-pulse';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function headerRe(table: string): RegExp {
  return new RegExp(`^\\s*\\[\\s*${escapeRe(table)}\\s*\\]\\s*(#.*)?$`);
}

const ANY_HEADER = /^\s*\[/;

export function splitLines(content: string): { bom: string; eol: string; lines: string[] } {
  const bom = content.startsWith('﻿') ? '﻿' : '';
  const body = bom ? content.slice(1) : content;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  return { bom, eol, lines: body.split(/\r?\n/) };
}

function joinLines(bom: string, eol: string, lines: string[]): string {
  // Guarantee exactly one trailing newline.
  const trimmed = [...lines];
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
  return bom + trimmed.join(eol) + eol;
}

/** Find `[table]` and the extent of its body (up to the next header). */
export function findTable(lines: string[], table: string): TomlTableSpan | null {
  const re = headerRe(table);
  const header = lines.findIndex((l) => re.test(l));
  if (header < 0) return null;
  let end = lines.length - 1;
  for (let i = header + 1; i < lines.length; i++) {
    if (ANY_HEADER.test(lines[i])) { end = i - 1; break; }
  }
  return { header, end };
}

/** Strip a trailing `# comment`, respecting quoted strings. */
function stripComment(line: string): string {
  let inStr: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\' && inStr === '"') { i++; continue; }
      if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Net `[` minus `]` on a line, ignoring brackets inside strings and comments. */
function bracketBalance(line: string): number {
  const code = stripComment(line);
  let inStr: '"' | "'" | null = null;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (inStr) {
      if (ch === '\\' && inStr === '"') { i++; continue; }
      if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === '[') depth++;
    else if (ch === ']') depth--;
  }
  return depth;
}

/** Locate `key = …` inside the table body (comment lines skipped). */
export function findKeyInTable(lines: string[], table: string, key: string): TomlKeySpan | null {
  const tbl = findTable(lines, table);
  return tbl ? findKeyInSpan(lines, tbl, key) : null;
}

/** `findKeyInTable` for a table span the caller already located. */
export function findKeyInSpan(lines: string[], tbl: TomlTableSpan, key: string): TomlKeySpan | null {
  const keyRe = new RegExp(`^\\s*${escapeRe(key)}\\s*=`);
  for (let i = tbl.header + 1; i <= tbl.end; i++) {
    const line = lines[i];
    if (/^\s*#/.test(line)) continue;
    if (!keyRe.test(line)) continue;
    // Multi-line arrays: extend until brackets balance (or the table ends).
    let end = i;
    let depth = bracketBalance(line.slice(line.indexOf('=') + 1));
    while (depth > 0 && end < tbl.end) {
      end++;
      depth += bracketBalance(lines[end]);
    }
    const parts = [stripComment(line).slice(line.indexOf('=') + 1).trimEnd()];
    for (let j = i + 1; j <= end; j++) parts.push(stripComment(lines[j]).trimEnd());
    return { start: i, end, valueText: parts.join('\n').trim(), line };
  }
  return null;
}

/**
 * Insert or replace `key = valueText` inside `[table]`, creating the table at
 * EOF when absent. Returns the new content (identical to the input when
 * nothing needed to change).
 */
export function upsertKeyInTable(
  content: string,
  table: string,
  key: string,
  valueText: string,
  mark: string = CODEX_MANAGED_MARK,
): string {
  const { bom, eol, lines } = splitLines(content);
  const newLine = `${key} = ${valueText}  ${mark}`;
  const tbl = findTable(lines, table);
  if (!tbl) {
    const out = [...lines];
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    if (out.length > 0) out.push('');
    out.push(`[${table}]`, newLine);
    return joinLines(bom, eol, out);
  }
  const span = findKeyInTable(lines, table, key);
  const out = [...lines];
  if (span) {
    if (lines[span.start] === newLine && span.end === span.start) return content;
    out.splice(span.start, span.end - span.start + 1, newLine);
  } else {
    out.splice(tbl.header + 1, 0, newLine);
  }
  return joinLines(bom, eol, out);
}

/**
 * Remove `key` from `[table]`. Drops the header too when the table was left
 * with nothing but blank lines (i.e. we created it). Untouched otherwise.
 */
export function removeKeyFromTable(content: string, table: string, key: string): string {
  const { bom, eol, lines } = splitLines(content);
  const span = findKeyInTable(lines, table, key);
  if (!span) return content;
  const out = [...lines];
  out.splice(span.start, span.end - span.start + 1);
  const tbl = findTable(out, table);
  if (tbl) {
    const bodyEmpty = out.slice(tbl.header + 1, tbl.end + 1).every((l) => l.trim() === '');
    if (bodyEmpty) {
      out.splice(tbl.header, tbl.end - tbl.header + 1);
      // Collapse the blank line we added above the header on creation.
      if (tbl.header > 0 && out[tbl.header - 1] === '' && (out[tbl.header] === '' || tbl.header === out.length)) {
        out.splice(tbl.header - 1, 1);
      }
    }
  }
  return joinLines(bom, eol, out);
}

// ── Whole-table editing ──────────────────────────────────────────────────────
// For tables we own (`[mcp_servers.agent-pulse]`): the table is matched by key
// path, so `[mcp_servers."agent-pulse"]` and spacing variants are the same
// table. An upsert rewrites only the keys we write; keys the user added (say
// `enabled = false`) stay. A sub-table named after one of our keys
// (`[mcp_servers.agent-pulse.env]`) is dropped — next to our inline `env = {…}`
// it would be a duplicate key Codex refuses to load. Removal takes the table
// and every sub-table.

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** TOML basic string. JSON's escapes are a subset of TOML's, so this is valid as-is. */
export function tomlString(s: string): string {
  return JSON.stringify(s);
}

function formatKey(k: string): string {
  return BARE_KEY.test(k) ? k : tomlString(k);
}

/** Parse a single TOML string literal (basic or literal); null for anything else. */
export function parseTomlString(text: string): string | null {
  const t = text.trim();
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1);
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try { return JSON.parse(t); } catch { return null; }
  }
  return null;
}

/** Strings of a one-dimensional string array (single- or multi-line); null when not an array. */
export function parseTomlStringArray(text: string): string[] | null {
  const t = text.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  const out: string[] = [];
  for (const m of t.slice(1, -1).matchAll(/"(?:[^"\\]|\\.)*"|'[^']*'/g)) {
    const s = parseTomlString(m[0]);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}

/** Key path of a `[a . "b" . 'c']` header; null for non-headers and `[[array]]` headers. */
export function parseTableHeader(line: string): string[] | null {
  const t = stripComment(line).trim();
  if (!t.startsWith('[') || t.startsWith('[[') || !t.endsWith(']')) return null;
  const inner = t.slice(1, -1);
  const keys: string[] = [];
  let i = 0;
  for (;;) {
    while (inner[i] === ' ' || inner[i] === '\t') i++;
    let key: string | null = null;
    if (inner[i] === '"') {
      const m = /^"(?:[^"\\]|\\.)*"/.exec(inner.slice(i));
      if (m) { key = parseTomlString(m[0]); i += m[0].length; }
    } else if (inner[i] === "'") {
      const end = inner.indexOf("'", i + 1);
      if (end > i) { key = inner.slice(i + 1, end); i = end + 1; }
    } else {
      const m = /^[A-Za-z0-9_-]+/.exec(inner.slice(i));
      if (m) { key = m[0]; i += m[0].length; }
    }
    if (key === null) return null;
    keys.push(key);
    while (inner[i] === ' ' || inner[i] === '\t') i++;
    if (i >= inner.length) return keys;
    if (inner[i] !== '.') return null;
    i++;
  }
}

const isPrefix = (prefix: string[], keys: string[]) =>
  keys.length >= prefix.length && prefix.every((k, i) => k === keys[i]);

/** The table at `keyPath` plus all of its sub-tables, in file order. */
export function findTablesUnder(lines: string[], keyPath: string[]): Array<TomlTableSpan & { exact: boolean }> {
  const spans: Array<TomlTableSpan & { exact: boolean }> = [];
  for (let i = 0; i < lines.length; i++) {
    const keys = parseTableHeader(lines[i]);
    if (!keys || !isPrefix(keyPath, keys)) continue;
    let end = lines.length - 1;
    for (let j = i + 1; j < lines.length; j++) {
      if (ANY_HEADER.test(lines[j])) { end = j - 1; break; }
    }
    spans.push({ header: i, end, exact: keys.length === keyPath.length });
  }
  return spans;
}

/**
 * Last line of the span holding a key or value. Trailing blanks and comments
 * stay put: they usually introduce the NEXT table, not this one.
 */
function lastContentLine(lines: string[], span: TomlTableSpan): number {
  for (let i = span.end; i > span.header; i--) {
    if (lines[i].trim() !== '' && !/^\s*#/.test(lines[i])) return i;
  }
  return span.header;
}

function cutSpans(lines: string[], spans: TomlTableSpan[]): string[] {
  // Ranges come from the untouched input and are cut bottom-up, so earlier
  // cuts never shift a range still to be cut.
  const ranges = spans
    .map((s) => ({ at: s.header, last: lastContentLine(lines, s) }))
    .sort((a, b) => b.at - a.at);
  const out = [...lines];
  for (const { at, last } of ranges) {
    out.splice(at, last - at + 1);
    // Collapse the blank separator we added above the header on creation.
    if (at > 0 && out[at - 1].trim() === '' && (at === out.length || out[at].trim() === '')) {
      out.splice(at - 1, 1);
    }
  }
  return out;
}

/**
 * Write `body` (one `key = value` per line) into `[keyPath]`. An existing table
 * has those keys replaced and placed first under the header, and any other
 * keys left alone; sub-tables named after a body key are removed. Without a
 * table, one is appended at EOF.
 */
export function upsertTable(content: string, keyPath: string[], body: string[]): string {
  const { bom, eol, lines } = splitLines(content);
  const keys = body.map((l) => l.slice(0, l.indexOf('=')).trim());
  const clashes = findTablesUnder(lines, keyPath).filter((s) => {
    if (s.exact) return false;
    const child = parseTableHeader(lines[s.header])?.[keyPath.length];
    return child !== undefined && keys.includes(child);
  });
  let out = cutSpans(lines, clashes);
  const exact = findTablesUnder(out, keyPath).find((s) => s.exact);
  if (exact) {
    // Drop our keys' current lines bottom-up so earlier spans stay valid,
    // then put the fresh ones right under the header.
    const spans = keys
      .map((k) => findKeyInSpan(out, exact, k))
      .filter((s): s is TomlKeySpan => s !== null)
      .sort((a, b) => b.start - a.start);
    for (const s of spans) out.splice(s.start, s.end - s.start + 1);
    out.splice(exact.header + 1, 0, ...body);
  } else {
    const block = [`[${keyPath.map(formatKey).join('.')}]`, ...body];
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    if (out.length > 0) out.push('');
    out = [...out, ...block];
  }
  const next = joinLines(bom, eol, out);
  return next === content ? content : next;
}

/** Remove `[keyPath]` and its sub-tables; every other line survives byte for byte. */
export function removeTable(content: string, keyPath: string[]): string {
  const { bom, eol, lines } = splitLines(content);
  const spans = findTablesUnder(lines, keyPath);
  if (spans.length === 0) return content;
  return joinLines(bom, eol, cutSpans(lines, spans));
}

/**
 * A root-level dotted key under the table (`tui.<anything> = …`) or an inline
 * table (`tui = { … }`) defines `tui` implicitly, and TOML then forbids a
 * later `[tui]` header for the same table. Detect so the installer can refuse
 * instead of writing a config.toml Codex will not load. Only the root scope
 * matters: `tui.x = 1` under some other `[section]` is `section.tui.x`.
 * `_key` is kept for call-site clarity; any dotted key conflicts, not just ours.
 */
export function hasInlineTableConflict(content: string, table: string, _key?: string): boolean {
  const { lines } = splitLines(content);
  const dotted = new RegExp(`^\\s*${escapeRe(table)}\\s*\\.`);
  const inline = new RegExp(`^\\s*${escapeRe(table)}\\s*=\\s*\\{`);
  for (const l of lines) {
    if (ANY_HEADER.test(l)) break; // root scope ends at the first table header
    if (/^\s*#/.test(l)) continue;
    if (dotted.test(l) || inline.test(l)) return true;
  }
  return false;
}

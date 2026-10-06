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
  if (!tbl) return null;
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

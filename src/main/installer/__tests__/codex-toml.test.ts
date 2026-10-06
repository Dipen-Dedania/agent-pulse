import { describe, it, expect } from 'vitest';
import {
  CODEX_MANAGED_MARK,
  findKeyInTable,
  findTable,
  hasInlineTableConflict,
  removeKeyFromTable,
  splitLines,
  upsertKeyInTable,
} from '../codex-toml';

const VALUE = '["model-with-reasoning", "git-branch"]';
const LINE = `status_line = ${VALUE}  ${CODEX_MANAGED_MARK}`;

// Shape of the real ~/.codex/config.toml on this machine: no [tui] table, many
// quoted sub-tables that must not be mistaken for the end/start of [tui].
const REAL = [
  'model = "gpt-6-astra"',
  'model_reasoning_effort = "medium"',
  '',
  '[windows]',
  'sandbox = "elevated"',
  '',
  "[projects.'E:\\DDrive\\Github\\agent-pulse']",
  'trust_level = "trusted"',
  '',
  '[features]',
  'hooks = true',
  '',
  "[hooks.state.'C:\\Users\\x\\.codex\\hooks.json:stop:0:0']",
  'trusted_hash = "sha256:abc"',
  '',
  '[plugins."documents@openai-primary-runtime"]',
  'enabled = true',
  '',
].join('\n');

describe('findTable / findKeyInTable', () => {
  it('finds a table and bounds it at the next header of any kind', () => {
    const lines = ['[tui]', 'theme = "dark"', '', '[[servers]]', 'x = 1'];
    expect(findTable(lines, 'tui')).toEqual({ header: 0, end: 2 });
    expect(findTable(lines, 'servers')).toBeNull(); // [[servers]] is an array header, not [servers]
  });

  it('does not match sub-tables or quoted keys that merely contain the name', () => {
    const lines = ['[tui.colors]', 'x = 1', "[projects.'tui']", 'y = 2'];
    expect(findTable(lines, 'tui')).toBeNull();
  });

  it('returns the key span and comment-stripped value, skipping commented keys', () => {
    const lines = ['[tui]', '# status_line = ["old"]', 'status_line = ["a", "b"] # note', 'other = 1'];
    expect(findKeyInTable(lines, 'tui', 'status_line')).toEqual({
      start: 2, end: 2, valueText: '["a", "b"]', line: 'status_line = ["a", "b"] # note',
    });
  });

  it('spans a multi-line array by bracket balance, ignoring brackets in strings and comments', () => {
    const lines = ['[tui]', 'status_line = [', '  "a[0]", # ]', "  'b',", ']', 'other = 1'];
    const span = findKeyInTable(lines, 'tui', 'status_line')!;
    expect(span.start).toBe(1);
    expect(span.end).toBe(4);
    expect(span.valueText).toBe('[\n  "a[0]",\n  \'b\',\n]');
  });
});

describe('upsertKeyInTable', () => {
  it('creates the table at EOF when the file is empty', () => {
    expect(upsertKeyInTable('', 'tui', 'status_line', VALUE)).toBe(`[tui]\n${LINE}\n`);
  });

  it('appends [tui] after existing tables, leaving every other line intact', () => {
    const out = upsertKeyInTable(REAL, 'tui', 'status_line', VALUE);
    expect(out.startsWith(REAL.trimEnd() + '\n\n[tui]\n')).toBe(true);
    expect(out.endsWith(`${LINE}\n`)).toBe(true);
    // + blank separator + [tui] + our line, then the trailing newline's empty tail.
    expect(out.split('\n').length).toBe(REAL.trimEnd().split('\n').length + 4);
  });

  it('inserts under an existing [tui] header that lacks the key', () => {
    const src = '[tui]\ntheme = "dark"\n\n[features]\nhooks = true\n';
    expect(upsertKeyInTable(src, 'tui', 'status_line', VALUE)).toBe(
      `[tui]\n${LINE}\ntheme = "dark"\n\n[features]\nhooks = true\n`,
    );
  });

  it('replaces a single-line key in place', () => {
    const src = '[tui]\nstatus_line = ["old"]\ntheme = "dark"\n';
    expect(upsertKeyInTable(src, 'tui', 'status_line', VALUE)).toBe(`[tui]\n${LINE}\ntheme = "dark"\n`);
  });

  it('replaces a multi-line array as one span', () => {
    const src = '[tui]\nstatus_line = [\n  "old",\n]\ntheme = "dark"\n';
    expect(upsertKeyInTable(src, 'tui', 'status_line', VALUE)).toBe(`[tui]\n${LINE}\ntheme = "dark"\n`);
  });

  it('replaces the documented `null` literal and ignores a commented-out key', () => {
    const src = '[tui]\n# status_line = ["x"]\nstatus_line = null\n';
    expect(upsertKeyInTable(src, 'tui', 'status_line', VALUE)).toBe(`[tui]\n# status_line = ["x"]\n${LINE}\n`);
  });

  it('is idempotent and preserves CRLF and a BOM', () => {
    const src = '\uFEFF[features]\r\nhooks = true\r\n';
    const once = upsertKeyInTable(src, 'tui', 'status_line', VALUE);
    expect(once).toBe(`\uFEFF[features]\r\nhooks = true\r\n\r\n[tui]\r\n${LINE}\r\n`);
    expect(upsertKeyInTable(once, 'tui', 'status_line', VALUE)).toBe(once);
    expect(splitLines(once).eol).toBe('\r\n');
  });
});

describe('removeKeyFromTable', () => {
  it('removes only our key and leaves a populated table alone', () => {
    const src = `[tui]\n${LINE}\ntheme = "dark"\n`;
    expect(removeKeyFromTable(src, 'tui', 'status_line')).toBe('[tui]\ntheme = "dark"\n');
  });

  it('drops the table we created and restores the original file byte for byte', () => {
    const installed = upsertKeyInTable(REAL, 'tui', 'status_line', VALUE);
    expect(removeKeyFromTable(installed, 'tui', 'status_line')).toBe(REAL);
  });

  it('is a no-op when the key is absent', () => {
    expect(removeKeyFromTable(REAL, 'tui', 'status_line')).toBe(REAL);
  });
});

describe('hasInlineTableConflict', () => {
  it('flags root-level dotted keys and inline tables, not the [tui] form', () => {
    expect(hasInlineTableConflict('tui.status_line = ["a"]\n', 'tui', 'status_line')).toBe(true);
    expect(hasInlineTableConflict('tui = { status_line = ["a"] }\n', 'tui', 'status_line')).toBe(true);
    expect(hasInlineTableConflict('[tui]\nstatus_line = ["a"]\n', 'tui', 'status_line')).toBe(false);
  });

  it('flags any root-level dotted key under the table, not just ours', () => {
    // `tui.notifications` already defines `tui`; a later `[tui]` header is invalid TOML.
    expect(hasInlineTableConflict('model = "x"\ntui.notifications = true\n', 'tui', 'status_line')).toBe(true);
    expect(hasInlineTableConflict('tui . theme = "dark"\n', 'tui', 'status_line')).toBe(true);
  });

  it('ignores dotted keys under another table, comments, and similarly named tables', () => {
    // Inside [features] this is `features.tui.x`, which does not touch root `tui`.
    expect(hasInlineTableConflict('[features]\ntui.x = 1\n', 'tui', 'status_line')).toBe(false);
    expect(hasInlineTableConflict('# tui.status_line = ["a"]\n', 'tui', 'status_line')).toBe(false);
    expect(hasInlineTableConflict('tuix.y = 1\ntui_other = { a = 1 }\n', 'tui', 'status_line')).toBe(false);
    expect(hasInlineTableConflict(REAL, 'tui', 'status_line')).toBe(false);
  });
});

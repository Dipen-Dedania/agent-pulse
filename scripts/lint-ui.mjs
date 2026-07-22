#!/usr/bin/env node
// UI component-reuse guard. Fails the build when renderer code hand-rolls a
// primitive that already exists in src/renderer/components/Shared. Keeps the
// shared library the single source of truth. No dependencies — plain Node.
//
//   npm run lint:ui
//
// Add new rules to HARD_RULES (block) or SOFT_RULES (warn) below.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIR = join(ROOT, 'src', 'renderer');

// Paths (normalized with '/') skipped entirely: the library itself, tests, and
// known dead code.
const SKIP = [
  'src/renderer/components/Shared/',
  'src/renderer/components/Settings/Settings.tsx', // dead code, no importers
];
const SKIP_SEGMENTS = ['__tests__'];

// Hard rules block the build (exit 1).
const HARD_RULES = [
  {
    id: 'no-native-select',
    // native <select> element (not a comment mentioning it — see stripComments)
    test: (line) => /<select[\s/>]/.test(line),
    hint: 'Use <Select> from components/Shared instead of a native <select>.',
  },
  {
    id: 'no-native-dialog',
    test: (line) => /\bwindow\.(confirm|alert)\s*\(/.test(line) || /(?<![.\w])(confirm|alert)\s*\(/.test(line),
    hint: 'Use appConfirm / appAlert from components/Shared instead of window.confirm/alert.',
  },
  {
    id: 'no-handrolled-toggle',
    test: (line) => /role=['"]switch['"]/.test(line),
    hint: 'Use <GlassToggle> from components/Shared instead of a hand-rolled switch.',
  },
];

// Soft rules print a warning but do not fail (known tech debt / judgment calls).
const SOFT_RULES = [
  {
    id: 'handrolled-glass',
    test: (line) => /backdrop-blur-md/.test(line) && /(bg-glass|rounded-2xl)/.test(line),
    hint: 'Prefer the <Card> component or the .glass-primary/secondary/modal utilities.',
  },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (SKIP_SEGMENTS.includes(name)) continue;
      walk(full, out);
    } else if (name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

function isSkipped(relPath) {
  const norm = relPath.split(sep).join('/');
  return SKIP.some((s) => (s.endsWith('/') ? norm.startsWith(s) : norm === s));
}

// Blank out // line comments and /* */ block comments so a rule never fires on
// prose (e.g. the word "confirm(" inside a doc comment). Preserves line count.
function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  return out;
}

const hard = [];
const soft = [];

for (const file of walk(SCAN_DIR)) {
  const rel = relative(ROOT, file);
  if (isSkipped(rel)) continue;
  const lines = stripComments(readFileSync(file, 'utf8')).split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of HARD_RULES) if (rule.test(line)) hard.push({ rel, ln: i + 1, rule });
    for (const rule of SOFT_RULES) if (rule.test(line)) soft.push({ rel, ln: i + 1, rule });
  });
}

const fmt = (v) => `  ${v.rel.split(sep).join('/')}:${v.ln}  [${v.rule.id}]\n      ${v.rule.hint}`;

if (soft.length) {
  console.log(`\n⚠  lint:ui — ${soft.length} advisory (not blocking):`);
  soft.forEach((v) => console.log(fmt(v)));
}

if (hard.length) {
  console.error(`\n✖ lint:ui — ${hard.length} violation(s) — use the shared components:`);
  hard.forEach((v) => console.error(fmt(v)));
  console.error('\nShared library: src/renderer/components/Shared (import from "../Shared").\n');
  process.exit(1);
}

console.log(`✔ lint:ui — no component-reuse violations${soft.length ? ` (${soft.length} advisory above)` : ''}.`);

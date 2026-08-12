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
    // native <select> element (not a comment mentioning it — see stripComments).
    // `(?![\w-])` so a bare `<select` at end of a line (attributes on the next
    // line) is still caught, while `<Select`/`<selectFoo` are not.
    test: (line) => /<select(?![\w-])/.test(line),
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
  {
    id: 'no-handrolled-scrim',
    // A `fixed inset-0` overlay painted with a raw black tint is a hand-rolled
    // modal backdrop: it skips the themed --ap-scrim (60% black is right in dark
    // mode, far too heavy over the light theme's pastel mesh) and usually comes
    // attached to a hand-rolled dialog missing Escape/focus-trap/aria-modal.
    test: (line) => /fixed inset-0/.test(line) && /bg-black\//.test(line),
    hint: 'Use <Modal> from components/Shared, or the .glass-scrim utility for a bespoke overlay.',
  },
  {
    id: 'no-native-checkbox',
    // `type='checkbox'` may sit on its own line (JSX attr), so match the attr
    // rather than requiring <input on the same line. Shared/ is skipped, so the
    // Checkbox primitive's own native input never trips this.
    test: (line) => /type=['"]checkbox['"]/.test(line),
    hint: 'Use <Checkbox> from components/Shared instead of a native checkbox.',
  },
];

// Matches a Tailwind class as a whole token. A class list is usually quoted or
// interpolated, so a plain `\s` boundary silently misses the FIRST class in
// `className='w-7 h-7 …'` — which is exactly where a hand-rolled component
// tends to put its shape. Quotes, backticks, and `{`/`}` all count as edges.
// `cls('w-6','w-7')` → matches either as a standalone class anywhere on a line.
// Names are regex-escaped, so `h-1.5` and `text-[10px]` can be written as-is.
const cls = (...names) => {
  const alts = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?:^|[\\s'"\`{}])(?:${alts})(?:[\\s'"\`{}]|$)`);
};

// Soft rules print a warning but do not fail (known tech debt / judgment calls).
const SOFT_RULES = [
  {
    id: 'handrolled-glass',
    test: (line) => /backdrop-blur-md/.test(line) && /(bg-glass|rounded-2xl)/.test(line),
    hint: 'Prefer the <Card> component or the .glass-primary/secondary/modal utilities.',
  },
  {
    id: 'handrolled-input',
    // The three shells inputs were hand-rolled with before <Input> existed: a
    // flat `bg-glass/NN border border-edge`, a flat `bg-control/NN` pill, and
    // `.glass-secondary` (the sub-card tier) misapplied to a control. All three
    // read as a different material from the `Select` sitting next to them.
    //
    // Gated on a field affordance (`placeholder:` or a focus ring), because the
    // same surfaces legitimately dress buttons, chips, and <pre> blocks — and
    // the class often sits on its own line, so we can't look for `<input`.
    test: (line) => {
      const surface =
        /bg-glass\/\d+\s+border\s+border-edge/.test(line) ||
        /bg-control\/\d+/.test(line) ||
        /glass-secondary/.test(line);
      const field = /placeholder:/.test(line) || /focus:(outline-none|border-blue)/.test(line);
      return surface && field;
    },
    hint: 'Use <Input> / <Textarea> from components/Shared (they carry .glass-control).',
  },
  {
    id: 'handrolled-badge',
    // A small bordered pill at label size is a status chip. A dozen of these
    // sat across Settings while <Badge> already existed — same five tones,
    // spelled out five different ways. Requires the border, so the many
    // borderless `px-2 rounded` chips (project tags, filters) stay quiet.
    test: (line) =>
      cls('rounded-full').test(line) &&
      cls('px-2', 'px-2.5', 'px-3').test(line) &&
      cls('border').test(line) &&
      cls('text-xs', 'text-[10px]', 'text-[11px]').test(line),
    hint: 'Use <Badge> from components/Shared for status pills / chips.',
  },
  {
    id: 'handrolled-tooltip',
    // Four tooltip implementations existed before the panel + placement were
    // extracted into Shared/tooltipPanel; three of them re-derived the same
    // portal and glass card at drifting paddings. Shared/ is skipped by this
    // scan, so the legitimate ones never trip it.
    test: (line) => /role=['"]tooltip['"]/.test(line) || /glass-modal/.test(line) && /px-2\.5 py-1\.5|px-3 py-2\.5/.test(line),
    hint: 'Use <Tooltip> / <InfoTooltip> / useChartTip from components/Shared.',
  },
  {
    id: 'handrolled-icon-button',
    // A fixed square box that centers its content is an icon button. Eleven of
    // these existed in three sizes, two radii, and five hover treatments before
    // <IconButton>. The interactivity check (`cursor-pointer` / a hover state)
    // is what separates them from the same-shaped *non*-interactive tiles that
    // hold a tool icon or an avatar.
    test: (line) =>
      cls('w-6', 'w-7', 'w-9').test(line) &&
      cls('h-6', 'h-7', 'h-9').test(line) &&
      /flex items-center justify-center/.test(line) &&
      cls('rounded-full', 'rounded-md', 'rounded-lg').test(line) &&
      /cursor-pointer|hover:/.test(line),
    hint: 'Use <IconButton> from components/Shared for single-glyph buttons.',
  },
  {
    id: 'handrolled-meter',
    // A rounded, clipped track at bar height is a progress/quota bar. Seven of
    // these had drifted apart (five of them verbatim copies inside Bubble.tsx)
    // before <Meter>. `overflow-hidden` is what separates a track from the many
    // legitimate `h-2 rounded-full` status dots and pills. The bubble's bars
    // size themselves in px, so an inline `height:` counts as a bar height too.
    test: (line) =>
      cls('rounded-full').test(line) &&
      cls('overflow-hidden').test(line) &&
      (cls('h-1', 'h-1.5', 'h-2', 'h-2.5', 'h-3').test(line) || /height:/.test(line)),
    hint: 'Use <Meter> from components/Shared for progress / quota bars.',
  },
  {
    id: 'handrolled-segmented',
    // A `layoutId` sliding indicator outside Shared/ is the signature of a
    // hand-rolled segmented control or tab row. The only legitimate ones live
    // in Shared/Segmented + Shared/Tabs (which this scan skips).
    test: (line) => /layoutId=/.test(line),
    hint: 'Sliding pill/tab indicator — use <Segmented> or <Tabs> from components/Shared.',
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

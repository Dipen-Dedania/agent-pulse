# Light/Dark/Auto Theme System for Agent Pulse

## Context

Agent Pulse is currently dark-only: ~1,050 hardcoded slate/white Tailwind utility classes across 43 renderer files, no semantic color layer, no theme state. The user wants a full **Light / Dark / Auto** theme system delivered in one effort, covering **all windows** (Settings, transparent Bubble windows, tooltip, tour), with the choice persisted in config and a toggle in Settings. Dark mode must remain **pixel-identical** after migration.

Two design constraints make this tractable:
- **Tailwind 4 CSS-first** (`@theme` in `src/renderer/index.css`, no config file) supports variable-backed semantic tokens natively.
- **Electron `nativeTheme.themeSource`** forces `prefers-color-scheme` in every renderer, so the existing `matchMedia`-based dark detection becomes the single resolved-theme source with zero renderer IPC for visuals.

## Architecture

1. **Resolution**: Main process sets `nativeTheme.themeSource = 'system' | 'light' | 'dark'` from config. Every renderer's `matchMedia('(prefers-color-scheme: dark)')` then reflects the *resolved* theme (auto = OS pass-through) and fires change events live in all windows — including transparent bubbles.
2. **Application**: A tiny module stamps `data-theme="light"|"dark"` on `<html>` (all windows share one Vite entry, so every window gets it). Semantic tokens flip under `[data-theme='light']`.
3. **Tokens**: `@theme inline` tokens referencing `--ap-*` custom properties. Tokens hold **opaque colors** so existing `/60`, `/70` opacity modifiers keep working via Tailwind's `color-mix` compilation — dark mode stays pixel-identical and ~80% of the migration is a pure prefix rewrite.
4. **Sync**: Config persisted via existing `loadConfig`/`saveConfig`; IPC follows the exact existing idiom (`appearance:update-config` handler + `appearance:config-updated` broadcast — broadcast only syncs the Settings control, not visuals).

---

## Phase 1 — Infrastructure (app builds & works at every step)

### 1.1 `src/common/types.ts` — new types
```ts
export type ThemeMode = 'light' | 'dark' | 'auto';
export interface AppearanceConfig { theme: ThemeMode; }
```

### 1.2 `src/main/user-config.ts` — config schema
- Add `appearance: AppearanceConfig;` to `UserConfig` (line ~119 block) and `DEFAULTS.appearance = { theme: 'auto' }` (preserves today's behavior).
- Add + export `migrateAppearance(raw)` following the `migrateTour` idiom (line 547): validates `theme`, falls back to `'auto'`.
- Wire into **both** `loadConfig()` branches: happy path (~line 764) and corrupt-file fallback (~line 811). Old config files without the key load as `'auto'` — no version bump.

### 1.3 `src/main/index.ts` — nativeTheme + IPC
- Import `nativeTheme`; add helper:
  ```ts
  private applyThemeSource() {
    const t = this.userConfig.appearance.theme;
    nativeTheme.themeSource = t === 'auto' ? 'system' : t;
  }
  ```
- Call it in `init()`'s `whenReady` block **before** `bubbleManager.init()` so no window is created under the wrong theme (this also eliminates FOUC — `prefers-color-scheme` is already correct during the pre-JS paint).
- Add `appearance:update-config` handler next to `analytics:update-config` (~line 769), exactly matching the existing merge → `saveConfig` → `applyThemeSource()` → broadcast-to-all-windows idiom. Run the merged partial through `migrateAppearance` (an invalid string would throw on the `themeSource` setter).

### 1.4 `src/renderer/hooks/useTheme.ts` — new file (creates `hooks/`)
Since `themeSource` makes `matchMedia` authoritative, no IPC or context needed:
- `getEffectiveTheme(): 'light' | 'dark'` — reads matchMedia.
- `initThemeAttribute()` — stamps `document.documentElement.dataset.theme` now and on every matchMedia `change`. Window-lifetime, no teardown.
- `useIsDark(): boolean` — drop-in replacement for Bubble's local `useDarkMode` (same matchMedia subscription, extracted).

### 1.5 `src/renderer/index.tsx`
Call `initThemeAttribute()` before `createRoot`. All four window types (settings, bubble, tooltip, tour) share this entry → covered automatically.

### 1.6 `src/renderer/components/Bubble/Bubble.tsx`
Delete local `useDarkMode` (lines 76–87), import `useIsDark` from the shared hook, swap the call (~line 511). The ~15 `isDark ? darkRgba : lightRgba` inline-style ternaries **already have tuned light values** — no value changes, just the new source of truth. Bubbles now honor forced light/dark, not only OS.

### 1.7 `src/renderer/components/Settings/SettingsPanel.tsx` — toggle UI
- New `AppearanceCard`: card shell copied from `GeneralSection` (glass card recipe), segmented 3-way pill **Light / Dark / Auto** reusing the `SubTabPill` idiom (lines 207–233).
- Rendered on the Hooks tab immediately after `<GeneralSection />` (~line 717) — theme is an app-level pref like "Launch on startup".
- Wiring per the Bubble.tsx 557–583 pattern: `invoke('get-config')` on mount → `cfg.appearance?.theme ?? 'auto'`; subscribe to `appearance:config-updated`; optimistic local set + `invoke('appearance:update-config', { theme })` on click.

### 1.8 Optional polish: `src/main/windows/settings-window.ts`
`backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f172a' : '#f8fafc'` in BrowserWindow options (line ~33) to avoid a blank-window flash. Skip for transparent windows.

---

## Phase 2 — Token layer (`src/renderer/index.css`)

Commit this alone first — **zero visual change in dark mode** (verify by launching before proceeding).

Add below the existing `@theme` keyframes block (leave it untouched; multiple `@theme` blocks are legal). Dark values must be copied verbatim from Tailwind 4's oklch slate palette (`node_modules/tailwindcss/theme.css`) for pixel identity:

```css
/* ── Semantic theme tokens: dark = current slate palette, light = frosted-light ── */
:root, [data-theme='dark'] {
  /* surfaces */
  --ap-base:           oklch(20.8% 0.042 265.755);  /* slate-900 — page bg */
  --ap-glass:          oklch(27.9% 0.041 260.031);  /* slate-800 — cards */
  --ap-inset:          oklch(20.8% 0.042 265.755);  /* slate-900 — wells */
  --ap-overlay:        oklch(20.8% 0.042 265.755);  /* slate-900 — popovers */
  --ap-control:        oklch(37.2% 0.044 257.287);  /* slate-700 — buttons */
  --ap-control-strong: oklch(44.6% 0.043 257.281);  /* slate-600 — hover/track */
  /* borders */
  --ap-edge:           oklch(37.2% 0.044 257.287);  /* slate-700 */
  --ap-edge-strong:    oklch(44.6% 0.043 257.281);  /* slate-600 */
  /* text */
  --ap-strong:  #ffffff;
  --ap-primary: oklch(92.9% 0.013 255.508);  /* slate-200 */
  --ap-body:    oklch(86.9% 0.022 252.894);  /* slate-300 */
  --ap-muted:   oklch(70.4% 0.04 256.788);   /* slate-400 */
  --ap-faint:   oklch(55.4% 0.046 257.417);  /* slate-500 */
  --ap-ghost:   oklch(44.6% 0.043 257.281);  /* slate-600 */
  /* status text (300-level pastels) */
  --ap-ok:     oklch(84.5% 0.143 164.978);  /* emerald-300 */
  --ap-warn:   oklch(87.9% 0.169 91.605);   /* amber-300 */
  --ap-danger: oklch(80.8% 0.114 19.571);   /* red-300 */
  --ap-info:   oklch(80.9% 0.105 251.813);  /* blue-300 */
}

[data-theme='light'] {
  --ap-base: #f1f5f9;  --ap-glass: #ffffff;  --ap-inset: #94a3b8;
  --ap-overlay: #ffffff;  --ap-control: #e2e8f0;  --ap-control-strong: #cbd5e1;
  --ap-edge: #cbd5e1;  --ap-edge-strong: #94a3b8;
  --ap-strong: #0f172a;  --ap-primary: #1e293b;  --ap-body: #334155;
  --ap-muted: #64748b;  --ap-faint: #94a3b8;  --ap-ghost: #cbd5e1;
  --ap-ok: #047857;  --ap-warn: #b45309;  --ap-danger: #b91c1c;  --ap-info: #1d4ed8;
}

@theme inline {
  --color-base: var(--ap-base);           --color-glass: var(--ap-glass);
  --color-inset: var(--ap-inset);         --color-overlay: var(--ap-overlay);
  --color-control: var(--ap-control);     --color-control-strong: var(--ap-control-strong);
  --color-edge: var(--ap-edge);           --color-edge-strong: var(--ap-edge-strong);
  --color-strong: var(--ap-strong);       --color-primary: var(--ap-primary);
  --color-body: var(--ap-body);           --color-muted: var(--ap-muted);
  --color-faint: var(--ap-faint);         --color-ghost: var(--ap-ghost);
  --color-ok: var(--ap-ok);               --color-warn: var(--ap-warn);
  --color-danger: var(--ap-danger);       --color-info: var(--ap-info);
}
```

Key mechanics:
- **`@theme inline`** embeds `var(--ap-*)` directly into generated utilities so values resolve per-element at runtime and flip with `data-theme` — the documented Tailwind 4 pattern for variable-backed tokens.
- **Opaque tokens + opacity modifiers**: `bg-glass/60` compiles to `color-mix(in oklab, var(--ap-glass) 60%, transparent)` — pixel-identical to `bg-slate-800/60` in dark mode; existing `/NN` modifiers survive migration verbatim.
- Do NOT disable the default palette — accent colors and long-tail slate stay available.
- Design notes: light `--ap-inset` is slate-400 because dominant well usages are `bg-slate-900/40`/`60` — slate-400 at those alphas over white gives the recessed-input gray. Light `--ap-glass` white at `/60` over the slate-100 page + `backdrop-blur-md` = frosted-light glass.

Also in index.css:
- **Light scrollbar**: `[data-theme='light'] .apple-scroll` overrides (current thumbs are white-rgba, invisible on light) — `rgba(0,0,0,0.22)` thumb, `0.38` hover.
- **Light diff viewer**: `[data-theme='light'] .ap-diff { ... }` block overriding the react-diff-view variables (lines 53–106) with light values (light insert/delete tints, `#334155` text) plus a light Prism token palette (purple keywords, green strings, sky functions, etc. — full values in the design; apply as specified during implementation).

---

## Phase 3 — Class migration (~1,050 replacements, scripted)

**Method**: one-off Node script (`scripts/migrate-theme.mjs`, ~60 lines) walking `src/renderer/**/*.{ts,tsx}` (**excluding `App.tsx`** — see exemptions), applying an **ordered** rule array, then manual triage of a skip-report. No clsx/cva in this repo (verified) — plain template-literal strings, so string/regex replacement is safe. Variant prefixes (`hover:`, `disabled:`) ride along for free since only the color part is rewritten.

### Order-sensitive rules first — slate-900 splits by alpha
| Old (exact) | New | ~Count |
|---|---|---|
| `bg-slate-900/95` | `bg-overlay/95` | 10 |
| `bg-slate-900/70`,`/60`,`/50`,`/40`,`/30` | `bg-inset/70`…`/30` | 92 |
| `bg-slate-950/60` | `bg-inset/60` (verify in context) | 1 |
| `bg-slate-900` bare — regex `bg-slate-900(?![\d/])` | `bg-base` | 3 |

### Prefix rewrites — `/NN` modifier and variants preserved (guard `(?!\d)`)
| Old prefix | New prefix | ~Count |
|---|---|---|
| `bg-slate-800` | `bg-glass` | 45 |
| `bg-slate-700` | `bg-control` | 135 |
| `bg-slate-600` | `bg-control-strong` | 60 |
| `border-slate-700` | `border-edge` | 155 |
| `border-slate-600`, `border-slate-500` | `border-edge-strong` (deliberate collapse) | 35 |
| `text-slate-100`, `text-slate-200` | `text-primary` | 72 |
| `text-slate-300` | `text-body` | 64 |
| `text-slate-400` | `text-muted` | 177 |
| `text-slate-500` | `text-faint` | 189 |
| `text-slate-600` | `text-ghost` | 8 |
| `text-emerald-300` | `text-ok` | 29 |
| `text-amber-300` | `text-warn` | 43 |
| `text-red-300` | `text-danger` | 26 |
| `text-blue-300` | `text-info` | 8 |

### Conditional rule — `text-white` (x173, the one unsafe replacement)
- → `text-strong` only when the same className string has **no accent background** (`bg-(blue|red|green|emerald|amber|rose|violet|orange|indigo|sky|cyan)-`). ~131 lines (headings, active segments).
- ~35 lines pair it with accent buttons/chips (`bg-blue-600 … text-white`) — **keep literal**; white-on-accent is correct in both themes.
- `hover:text-white` (x24) → `hover:text-strong` (they sit on ghost buttons).
- Script emits every skipped/ambiguous line to a report file; manually check multi-line JSX where accent bg lives in a different template fragment.

### Long-tail manual bucket (~25 occurrences)
`border-slate-400`, `ring-slate-300/60` hover rings (→ `edge-strong` or invert manually), `bg-slate-500` x1, `text-green-300` x1 (→ `text-ok`), `divide-slate-700/40` (covered by prefix rule), etc.

### Post-script guard
`grep -rn 'slate-' src/renderer` — every remaining hit must be exempt or triaged. Run the test suite. One migration commit, then per-subsystem QA fix-up commits.

---

## Phase 4 — Inline-style light branches (not class migration)

Keep the `isDark ? dark : light` ternary pattern; source `isDark` from `useIsDark`:
- **Bubble.tsx** — light rgba branches already exist and are tuned; hook swap only (Phase 1.6).
- **`src/renderer/components/Tooltip/TooltipOverlay.tsx`** (lines 60–67) — add isDark branch: light glass `rgba(255,255,255,0.92)` bg, `rgba(0,0,0,0.10)` border, softer shadow.
- **`src/renderer/components/Tour/TourCard.tsx`** (lines 117–121, 160) — same treatment; progress-dot rgba is legible on white, keep.
- **`src/renderer/components/Settings/analytics/HeatmapCard.tsx`** — `EMPTY_BG` (line 24) needs a light branch `'rgb(148 163 184 / 0.25)'`; the blue alpha ramp works on white, keep.

## Explicit exemptions (do NOT migrate)
- All **accent backgrounds/borders** (`bg-blue-600` buttons x79, amber/emerald/red tinted chips and their `/10–/30` tints).
- **Chart palettes** (ToolMixCard `COLORS`, project-colors.ts hex values) — 400-level fills read on white.
- **`bg-white` toggle knobs** (~30) — correct iOS style on both themes.
- **`bg-black/60` modal scrims** (x7) — dark scrims are correct on light themes.
- **`App.tsx` welcome screen** — dark-branded hero (white-gradient headline, `bg-white/[0.03]` cards); exclude from the script.
- **Mascot SVGs** and Bubble state colors (`colorsFor` etc. — already dual-theme via isDark).

---

## Verification

1. **Dark-mode pixel regression** (most important): before/after screenshots of each Settings tab in dark mode must be identical — the whole token scheme is designed for this.
2. **Live switching**: toggle Light/Dark/Auto in Settings → Settings chrome + all open bubbles flip instantly, no restart. In Auto, flip the OS theme → all windows follow.
3. **Persistence**: restart → saved mode applied before any window paints (no flash). Delete `appearance` from `~/.claude/agent-pulse-config.json` → loads as `auto`.
4. **Subsystem QA in light mode** (and auto-switch): Settings shell + every tab (Hooks, Bubble, Usage, Backlog, Analytics, Guardrails, Updates); analytics cards + info popovers + heatmap; Backlog board / CardEditorModal / diff viewer (insert/delete rows, gutters, Prism tokens); Bubble over light and dark wallpapers (glass + mascot modes, usage bars, attention ring); tooltip window; tour; `.apple-scroll` scrollbars.
5. **Tests**: `npm test` (Vitest) — Bubble tests assert zero slate classes today; suite must stay green. `npm run build:main` + renderer build clean.

## Files touched (summary)
**New**: `src/renderer/hooks/useTheme.ts`, `scripts/migrate-theme.mjs` (throwaway).
**Modified (infra)**: `src/common/types.ts`, `src/main/user-config.ts`, `src/main/index.ts`, `src/renderer/index.tsx`, `src/renderer/index.css`, `src/renderer/components/Settings/SettingsPanel.tsx`, `src/main/windows/settings-window.ts` (optional).
**Modified (migration)**: ~40 files under `src/renderer/components/` via script + 4 inline-style files (Bubble, TooltipOverlay, TourCard, HeatmapCard).

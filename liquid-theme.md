# Liquid Glass Theme — Implementation Plan

## Context

Settings panel currently uses `bg-glass/60 backdrop-blur-md border-edge/70` copy-pasted ~40+ times.
Bubble already has `blur(14px)`. This plan upgrades the Settings panel to Apple Liquid Glass.

## Three Missing Ingredients

| Ingredient                  | Current                                        | Fix                                                                  |
| --------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| Background layer            | Flat solid `bg-base` — nothing to blur against | Rich gradient "wallpaper" per theme                                  |
| ~~Refraction / distortion~~ | ~~None~~                                       | ❌ **ABANDONED — see warning below**                                 |
| Specular highlight          | None                                           | `::after` pseudo with radial gradient glint + inset rim `box-shadow` |

> ⚠️ **Do NOT implement the SVG `feDisplacementMap` refraction (Phase 2).**
> A CSS `filter` applies to the element's _own_ rendered content, so the
> displacement map warped every label/icon inside each card into grainy,
> wavy mush. You cannot displace only the backdrop on the web
> (`backdrop-filter` has no displacement support in Chromium). The convincing
> glass look comes entirely from `backdrop-filter: blur() saturate()`, a
> specular `::after` highlight, an inset top-edge rim `box-shadow`, and a soft
> floating drop shadow. Phase 2 is kept below only as a record of what failed.

---

## Phase 1 — Background Gradient Layer

Replace solid `bg-base` on the root `<div className='h-screen ... bg-base'>` in `SettingsPanel.tsx`.

**Dark mode:**

```css
background: radial-gradient(
  ellipse at 20% 10%,
  oklch(30% 0.08 265) 0%,
  oklch(20% 0.04 260) 40%,
  oklch(13% 0.02 258) 100%
);
```

**Light mode:**

```css
background: radial-gradient(
  ellipse at 25% 15%,
  #f8faff 0%,
  #eef2ff 50%,
  #e8f0fe 100%
);
```

Add a subtle SVG noise texture as a `::before` pseudo at `opacity: 0.03` (dark) / `0.02` (light) to break up flatness.
Use a `--ap-noise-opacity` CSS token so it can be tuned per theme.

---

## Phase 2 — SVG Liquid Glass Filter ❌ ABANDONED (DO NOT IMPLEMENT)

**This phase was implemented and reverted — it destroys text legibility.** See the
warning at the top. The block below is retained only so the failed approach is
documented. Skip straight to Phase 3.

Add a hidden `<svg>` at the top of `SettingsPanel.tsx` (or in `App.tsx`) with reusable filter defs:

```svg
<svg style="display:none" aria-hidden="true">
  <defs>
    <filter id="liquid-glass" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9 0.6"
                    numOctaves="2" seed="2" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise"
                         scale="4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <filter id="liquid-glass-subtle" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9 0.6"
                    numOctaves="2" seed="2" result="noise"/>
      <feDisplacementMap in="SourceGraphic" in2="noise"
                         scale="2" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>
```

- `scale="4"` → section cards, tab bar, modal
- `scale="2"` → toggle rows, inputs, smaller sub-elements
- Skip on pure text, images, icons (apply to container shell only)

---

## Phase 3 — Unified Glass Utility Classes (`index.css`)

Add to `@layer components`:

```css
/* Tier 1 — Section cards, tab bar */
.glass-primary {
  @apply relative overflow-hidden rounded-2xl shadow-xl;
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  background: rgba(255, 255, 255, 0.07);
  border: 1px solid rgba(255, 255, 255, 0.14);
}
.glass-primary::after {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 35% 18%,
    rgba(255, 255, 255, 0.18) 0%,
    transparent 65%
  );
  pointer-events: none;
  border-radius: inherit;
}

/* Tier 2 — Toggle rows, sub-cards, modal inner sections */
.glass-secondary {
  @apply relative overflow-hidden rounded-xl;
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.glass-secondary::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 30% 15%,
    rgba(255, 255, 255, 0.12) 0%,
    transparent 60%
  );
  pointer-events: none;
  border-radius: inherit;
}

/* Tier 3 — Modal window */
.glass-modal {
  @apply relative overflow-hidden rounded-2xl shadow-2xl;
  backdrop-filter: blur(28px) saturate(200%);
  -webkit-backdrop-filter: blur(28px) saturate(200%);
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
.glass-modal::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 35% 18%,
    rgba(255, 255, 255, 0.22) 0%,
    transparent 65%
  );
  pointer-events: none;
  border-radius: inherit;
}

/* Light mode overrides */
[data-theme='light'] .glass-primary {
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.9);
}
[data-theme='light'] .glass-primary::after {
  background: radial-gradient(
    ellipse at 35% 18%,
    rgba(255, 255, 255, 0.8) 0%,
    transparent 65%
  );
}
[data-theme='light'] .glass-secondary {
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.75);
}
[data-theme='light'] .glass-modal {
  background: rgba(255, 255, 255, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.95);
}
```

---

## Phase 4 — Component Migration

Swap the copy-pasted pattern across all Settings components:

| Old pattern                                                                | New class                                    | Files                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl shadow-xl` | `glass-primary`                              | BubbleSection, GeneralSection, GuardrailsTab, SecretProtectionTab, UsageSection, AttentionSection |
| `bg-glass/60 backdrop-blur-md border border-edge/70 rounded-xl shadow-lg`  | `glass-primary rounded-xl` (override radius) | Tab bar in SettingsPanel                                                                          |
| `bg-glass/60 border border-edge/60 rounded-xl`                             | `glass-secondary`                            | Toggle rows, webhook rows, position picker                                                        |
| `bg-overlay/95 border border-edge/70 rounded-2xl shadow-2xl`               | `glass-modal`                                | HookInfoModal                                                                                     |
| `bg-glass border border-edge rounded-lg`                                   | `glass-secondary rounded-lg`                 | Text inputs (AttentionSection)                                                                    |

Keep all other classes (`flex`, `gap-4`, `p-6`, text/icon colors) unchanged — only the surface declaration swaps.
Check each card for `overflow-hidden` compatibility — the `::after` highlight requires it.

---

## Phase 5 — Interactive Polish

Add Framer Motion hover on section cards:

```tsx
whileHover={{ scale: 1.003 }}
transition={{ duration: 0.15, ease: 'easeOut' }}
```

Toggle pill: Change inactive `bg-control-strong` to `rgba(255,255,255,0.15)` with a specular shimmer so it reads as glass, not flat gray.

Scrollbar: Update `apple-scroll` thumb to `rgba(255,255,255,0.12)` dark / `rgba(0,0,0,0.18)` light (slightly more visible against new gradient bg).

---

## What Stays Unchanged

- All `--ap-*` CSS tokens (drive text/icon colors, not glass surfaces)
- `data-theme` dark/light mechanism
- Bubble component (already has its own blur)
- `blue-600` accent for interactive elements

---

## Effort

| Phase                   | Time        | Risk                                   |
| ----------------------- | ----------- | -------------------------------------- |
| 1 — Background gradient | 1 hr        | Low                                    |
| ~~2 — SVG filter~~      | ❌          | **Abandoned — breaks text legibility** |
| 3 — CSS utility classes | 1–2 hr      | Low                                    |
| 4 — Component migration | 2–3 hr      | Medium (overflow-hidden checks)        |
| 5 — Motion polish       | 1 hr        | Low                                    |
| **Total**               | **~6–7 hr** |                                        |

Phases 1–3 are the CSS foundation (no visual regressions). Phase 4 is the visible sweep.

---

## Implementation Prompt

```
Implement the Apple Liquid Glass theme for the Agent Pulse settings panel
as described in liquid-theme.md. Work through the phases in order:

Phase 1: Replace the solid `bg-base` on the root container in
  src/renderer/components/Settings/SettingsPanel.tsx with the dark/light
  radial-gradient backgrounds defined in the plan. Add a noise ::before
  pseudo via index.css using --ap-noise-opacity token.

Phase 2: SKIP. The SVG feDisplacementMap filter warps the cards' own text
  into unreadable mush and cannot be scoped to the backdrop on the web.
  Do not add it.

Phase 3: Add the .glass-primary, .glass-secondary, and .glass-modal utility
  classes to src/renderer/index.css under @layer components. Include the
  ::after specular highlights, and for [data-theme='light'] add an inset
  top-edge rim box-shadow + a soft floating drop shadow (that rim light is
  what sells "glass" in light mode — not a whiter fill). Do NOT add any
  `filter: url(...)` line.

Phase 4: In each Settings component, swap the copy-pasted glass pattern
  for the appropriate utility class per the migration table in the plan.
  Files: SettingsPanel.tsx, BubbleSection.tsx, GeneralSection.tsx (or
  equivalent), GuardrailsTab.tsx, SecretProtectionTab.tsx, UsageSection.tsx,
  AttentionSection.tsx, HookInfoModal. Keep all non-surface classes intact.
  Verify overflow-hidden is present on every migrated element.

Phase 5: Add Framer Motion whileHover={{ scale: 1.003 }} on section cards.
  Update the toggle inactive color and apple-scroll thumb per the plan.

After each phase, confirm no TypeScript errors. Do not change Bubble.tsx,
the --ap-* CSS token values, or the data-theme switching logic.
```

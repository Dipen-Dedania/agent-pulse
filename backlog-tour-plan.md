# Backlog Planner — Guided Tour Plan

> Status: **draft / to refine**. Consolidates the research + refinement decisions
> for an in-panel guided tour of the Backlog planner. No code written yet.

## 1. Decision summary

- **Approach:** Option D — hybrid. An in-panel **spotlight/coachmark tour** anchored
  to the real Backlog-tab DOM, plus a real-state **checklist** (SetupChecklist-style).
  Custom implementation (no tour library), consistent with the existing glass kit.
- **Trigger:** **Both** — auto-run once on first visit to the Backlog tab, and a
  manual "Tour this board" trigger that stays re-runnable.
- **Cross-tab:** **Live across tab** — the tour continues into `Usage → Claude Code`
  to walk the Scheduler + Population config (not just a hand-off callout).
- **Tour shape depends on project count** — do not fight the empty state.
- **Reuse, don't invent:** extend the existing `TourConfig` persistence/IPC and reuse
  the glass card / `ClawdMascot` / progress-dots / Framer Motion visual language and
  the positioning mechanics already in `Shared/Tooltip.tsx`.

## 2. Code-grounded findings (verified, correct the original research)

1. **Card actions are NOT in a hover/overflow menu.** `▶ Run` and `✨ Refine` are
   always-visible inline `ActionButton`s in the card footer
   (`CardTile.tsx:260,266,285,317`). Spotlighting them is trivial. **But** the action
   set differs by card type across three render branches — so the tour must choose
   *which* card to anchor (see §5).

2. **Cross-tab is two state jumps, not one.** The Scheduler/Population sections
   (`SettingsPanel.tsx:1040`, `:1047`) only render when the Usage sub-tab
   `active === 'claude-code'` (`:1022`) — a *second* local state, `usageSubTab`, with a
   fallback that silently switches away from claude-code if its config hasn't loaded
   (`:996`). Each section is itself conditionally rendered on its config
   (`{backlogSchedulerConfig && …}`). A live cross-tab step must drive **both**
   `setActiveTab('usage')` **and** `setUsageSubTab('claude-code')`, then wait for an
   async-loaded anchor that may never appear if Claude Code isn't configured.

3. **Tab switch fully unmounts.** `SettingsPanel` uses `<AnimatePresence mode='wait'>`
   keyed on `activeTab` (`:816-818`), so switching tabs unmounts the board and waits
   for the exit animation before the next tab mounts. `activeTab` (`:359`) and
   `usageSubTab` are local `useState` — URL params can't reach them.

## 3. Structural requirements this locks in

1. **Overlay hoisted to `SettingsPanel` level** — the scrim + callout render as a
   sibling of the `<AnimatePresence>` (`:816`), never inside a tab, so they survive
   tab swaps.
2. **Tour controller lives inside `SettingsPanel`** — it owns/receives both
   `activeTab`/`setActiveTab` and `usageSubTab`/`setUsageSubTab`. No lifting to App.
3. **Steps carry `{ tab, subTab?, selector, placement }`.** On entering a step whose
   `tab`/`subTab` ≠ current, the controller sets them, then **awaits the anchor**
   (rAF / MutationObserver poll with a timeout) before positioning — never measures
   immediately (exit animation + async config load). Then `scrollIntoView` before the
   spotlight.
4. **Degrade path** when an anchor never shows (Claude Code not configured → section
   never mounts): after the timeout, drop to a **centered, unanchored callout**
   ("Scheduling & auto-population live under Usage → Claude Code") rather than hanging
   or skipping silently. *(← last open call, see §7.)*

## 4. State / persistence / IPC (reuse existing tour plumbing)

- Extend `TourConfig` (`user-config.ts:119-123`) with `hasSeenBacklogTour: boolean`
  (and optionally `backlogSetupDismissed: boolean`); add defaults (`:241`) and handle
  in `migrateTour()` (`:622-631`).
- Extend the `TourState` renderer slice (`types.ts:117`) and `projectTourState()`
  (`index.ts:874`).
- Add IPC `backlog-tour:set-seen` mirroring `tour:set-setup-dismissed`
  (`index.ts:842`); reuse existing `tour:get-state` / `tour:state-updated` broadcast.
- **No new BrowserWindow, no `TourManager` changes** — the floating first-run tour is
  untouched. Guard so the backlog tour never runs while the first-run tour is active.

## 5. Anchoring & the "which card" decision

- **Anchoring strategy:** `data-tour="…"` attributes on real elements (board +
  Usage), controller resolves via `querySelector`. Less prop churn than refs.
- **Which card:** spotlight the **first Refinement-column card** (so `✨ Refine` is
  present to teach the highest-value action); fall back to the first card of any
  column if Refinement is empty.
- **Anchor inventory** (add `data-tour`):
  - Board: `glance` line, `+ Add project`, `+ New card`, issue-source import actions,
    the four column headers, one card's `▶ Run` / `✨ Refine`.
  - Usage: `BacklogSchedulerSection`, `BacklogPopulationSection`.

## 6. Step sequence

**≥1 project:**
1. Glance line (autorun windows / queue state)
2. `+ Add project` (cards belong to a repo folder)
3. `+ New card` + import sources (populate from GitLab/Linear)
4. The four flow columns — the mental model; note **In Progress is engine-only**, not
   a drop target
5. A real card's `▶ Run` / `✨ Refine`
6. **[jump → Usage / Claude Code]** Scheduler
7. Population
8. End

**0 projects:** stop after step 3 and hand off to an enriched "Add your first project"
empty state (checklist territory). Don't spotlight cards that don't exist.

## 7. Open items to refine later

- **§3.4 degrade path** — confirm: degrade-to-centered callout when Claude Code isn't
  configured (recommended) vs. skip-silently.
- Checklist ↔ tour division of labor: checklist tracks *real-state completion*
  (add project ✓ / create-or-import card ✓ / run one ✓) and offers "Tour this board";
  tour does the *conceptual walk*. Keep them non-overlapping.
- Whether the tour returns to Backlog after Usage, or ends on Usage (leaning: ends on
  Usage).
- Reduce-motion handling for the scrim/callout transitions (respect global handling in
  `App.tsx`).

## 8. UX / consistency notes

- Glass surfaces via `.glass-primary` / `.glass-modal`; reuse `Card` / `Button` from
  `../Shared`. `npm run lint:ui` enforces this.
- Keep `ClawdMascot` + short one-idea-per-step kicker/title/body voice and progress
  dots from `TourCard.tsx` for continuity.
- Skippable (Skip link + Esc), re-runnable, never a gate.
- Theme-aware (`data-theme` + semantic tokens + `light:` variants).
- Reuse `Tooltip.tsx` positioning mechanics: `createPortal`, `position: fixed`,
  `getBoundingClientRect()`, viewport clamping, above/below flip, reposition on
  scroll/resize.

## 9. Key file references

- `src/renderer/components/Backlog/BacklogBoardTab.tsx` — board, columns, empty states
- `src/renderer/components/Backlog/CardTile.tsx` — inline card actions
- `src/renderer/components/Settings/SettingsPanel.tsx` — tabs, `activeTab`/`usageSubTab`,
  `AnimatePresence`, Usage → Scheduler/Population
- `src/renderer/components/Settings/SetupChecklist.tsx` — checklist precedent
- `src/renderer/components/Tour/TourCard.tsx` — visual language, step model
- `src/renderer/components/Shared/Tooltip.tsx` — positioning engine to reuse
- `src/main/user-config.ts` / `src/common/types.ts` / `src/main/index.ts` — tour
  state, persistence, IPC

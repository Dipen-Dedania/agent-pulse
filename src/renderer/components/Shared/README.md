# Shared component library

The single home for reusable renderer UI primitives. **Import from the barrel**, not
from individual files or by hand-rolling an equivalent:

```ts
import { GlassToggle, Select, appConfirm, Card } from '../Shared';
```

`npm run lint:ui` (part of `npm test`) blocks new native `<select>`, hand-rolled
toggles (`role="switch"`), `window.confirm`/`alert`, and hand-rolled modal scrims,
and warns on copy-pasted glass card shells and hand-rolled input shells. Add a
primitive here + export it from `index.ts` rather than duplicating markup elsewhere.

## Catalog

| Export | Kind | Purpose / key props |
|---|---|---|
| `Button` | component | Glass button. `variant?: 'primary'\|'secondary'\|'success'\|'danger'\|'ghost'` (default `primary`; `success` is the green "go" for installing an update / a passed webhook test), `size?: 'xs'\|'sm'\|'md'` (default `md`), plus all native `<button>` props. Filled variants always use white text; `size` owns padding (don't override px/py via `className`). Never hand-roll `px-4 py-2 rounded-lg …` shells. |
| `IconButton` | component | Square/circular button holding one glyph — dismiss ✕, reorder ↑↓, refresh ↻, copy, back (eleven of these were hand-rolled in three box sizes, two radii, and five hover treatments). `size?: 'sm'\|'md'\|'lg'` (24/28/36px, default `md`) owns the box, `shape?: 'circle'\|'square'` (default `circle`), `tone?: 'neutral'\|'danger'\|'ghost'\|'outline'` (`danger` is neutral at rest and red on hover; `ghost` has no resting fill; `outline` is rimmed glass), required `aria-label`, plus all native `<button>` props. Put only layout in `className`. Wrap in `Tooltip` when the glyph needs explaining. |
| `GlassToggle` | component | Spring-animated switch. `checked`, `onChange(next)`, `size?: 'sm'\|'md'\|'lg'`, `disabled?`, `label?`, `className?`. |
| `Checkbox` | component | Glass checkbox replacing native `<input type="checkbox">` (whose unstyled box inherits the OS accent colour). `checked`, `onChange(next)`, `indeterminate?` (partial/dash state), `disabled?`, `label?`, `ariaLabel?`, `size?: 'sm'\|'md'`, `className?`. |
| `Radio` | component | Glass radio button (single-select counterpart to `Checkbox`). `checked`, `onChange(next)`, `name?` (share across a group for mutual exclusion), `disabled?`, `label?`, `ariaLabel?`, `size?: 'sm'\|'md'`, `className?`. Omit `label` when a wrapping `<label>` already covers the row. |
| `Select` | component | Glass dropdown replacing native `<select>`; portal-rendered so it's never clipped. `value`, `options: SelectOption[]`, `onChange(value)`, `className?`, `ariaLabel?`. `SelectOption = { value, label, swatch?, disabled?, group? }` — `disabled` renders a non-selectable placeholder, `group` inserts a section header before the first option of each named group. |
| `Input` | component | Glass text/number/time field on `.glass-control` — never hand-roll `bg-glass/60 border border-edge/70 rounded-lg …` (a flat fill with no blur or rim, which reads as a different material from the `Select` beside it). `size?: 'xs'\|'sm'\|'md'` (default `md`) owns padding + text-size, `invalid?` (red rim + `aria-invalid`), plus all native `<input>` props **except** `size` (the numeric attribute is omitted — the name is taken by the glass tier). Put only layout in `className` (`w-16`, `text-right`, `font-mono`). |
| `Textarea` | component | Multi-line counterpart to `Input`; same `size`/`invalid` props, adds `resize-y leading-relaxed`. |
| `Modal` | component | The app's dialog shell — never hand-roll a `fixed inset-0` overlay (each copy re-derived the chrome and dropped some of the a11y this provides: `role="dialog"` + `aria-modal`, Escape-to-close, Tab focus trap, first-field autofocus, backdrop-click dismiss). `title`, `onClose`, `children`, `eyebrow?`, `footer?` (usually Cancel/Save), `maxWidthClass?` (default `max-w-lg`), `maxHeightClass?` (default `max-h-[85vh]`), `panelClass?` (one-off panel styling, appended last), `zClass?` (default `z-50`; raise for a modal opening *over* another modal), `portal?` (render into `document.body` — **required** when mounted inside another Modal's panel, whose scale animation is a containing block for `position: fixed`). Wrap the mount in `<AnimatePresence>` so the exit animation plays. |
| `appAlert` | function | `appAlert(message, title?)` → styled alert; resolves when dismissed. |
| `appConfirm` | function | `appConfirm({ title, message, confirmLabel?, cancelLabel?, danger? })` → `Promise<boolean>`. |
| `AppDialogHost` | component | Renders the active alert/confirm. Mount **once** per window root, after all other content. |
| `TooltipOverlay` | component | The bubble tooltip overlay (glass card that follows bubble tooltip events). Mount once at the app root. |
| `Tooltip` | component | Hover/focus tooltip replacing native `title=`. Wraps a single element: `<Tooltip content="…"><button/></Tooltip>`. `content` accepts JSX; a falsy `content` (or `disabled`) renders the child untouched. Portal-rendered + viewport-clamped, 300ms open delay, closes on leave. |
| `InfoTooltip` | component | The "i" affordance that reveals a popover of **prose** — for explaining how a number is computed, where `Tooltip`'s one-line label won't do. `label?` (the button's accessible name, default "More info"), body as children. Opens with no delay and the panel is hoverable with an 80ms close grace, so the cursor can reach it to select text. |
| `useChartTip` | hook | Cursor-following tooltip for chart marks — the one case `Tooltip` doesn't cover (tracks the pointer; one hook serves hundreds of marks). `const { tipHandlers, tipOverlay } = useChartTip()`, then spread `tipHandlers(content)` onto each mark and render `tipOverlay` once. |
| `Badge` | component | Small labeled chip/pill (never hand-roll `inline-flex … px-2 py-0.5 rounded-… border`). `tone?: 'neutral'\|'info'\|'ok'\|'warn'\|'danger'`, `variant?: 'tag'\|'pill'` (rounded-md vs rounded-full), `dot?` (leading status dot), `uppercase?`, `size?: 'xs'\|'sm'\|'md'` (owns font size **and** horizontal padding: 10/11/12px at px-2/px-2/px-2.5), `weight?: 'medium'\|'semibold'` (omit to inherit — that's what `InfoPill`/`StatePill` do), `className?`. Backs `InfoPill` and `StatePill`. |
| `Card` | component | Titled `.glass-primary` section panel. `title`, `subtitle?`, `right?`, `children`. |
| `Meter` | component | Horizontal progress / quota bar — a rounded track with a left-anchored fill (never hand-roll `rounded-full overflow-hidden` + an inner `h-full` div; seven copies had drifted, five of them verbatim inside `Bubble.tsx`). `value` (0–100, clamped), `size?: 'xs'\|'sm'\|'md'\|'lg'` (h-1/1.5/2/3), `fillClass?`/`trackClass?` **or** `fillColor?`/`trackColor?` (CSS values, for the bubble's computed rgba — these win), `width?`/`height?` (numbers → px, for pixel-exact bars), `animate?` (framer-motion width spring instead of a CSS transition), `minWidthPct?` (floor so a nearly-empty bar stays visible; `value` 0 still renders empty), `ariaLabel?`. Reports `role="progressbar"`. Knows nothing about quota tiers — keep the colour scale in `quotaFillClass` / `Bubble/quota.ts`. |
| `EmptyState` | component | "Nothing to show" block. `message?` (or `children`), `boxed?` (wrap in a `.glass-secondary` panel), `className?`. Default is a centered muted line (`py-8`); `boxed` is for pick-lists / modal scroll regions. |
| `Spinner` | component | Glass-blue loading ring (never hand-roll `border-t-blue-400 … animate-spin`). `size?: 'xs'\|'sm'\|'md'` (12/14/16px, default `sm`), `ariaLabel?` (default "Loading"), `className?`. Ring only — keep your own row markup (label/gap/colour) and swap just the ring. |
| `Segmented` | component | Compact glass segmented control (in-form mode switches). `options: {value,label,hint?,dot?}[]` (`hint` = per-option tooltip, `dot` = leading Tailwind `bg-*` colour dot), `value`, `onChange(next)`, `size?: 'sm'\|'md'` (default `sm`), `className?`. Never hand-roll a row of active-pill buttons. |
| `Tabs` | component | Section / page navigation pills with a sliding active indicator — the larger counterpart to `Segmented`. Renders `role="tablist"`/`role="tab"`. `tabs: {value,label,icon?,badge?}[]` (`label`/`icon` are `ReactNode`s; `icon` renders at 16px before the label; `badge: true` renders a red attention dot after it, a number renders a count pill), `value`, `onChange(next)`, `tone?: 'glass'\|'blue'` (default `glass`; `blue` for prominent sub-tab rows), `fill?` (stretch to container width, equal-width centred pills), `className?` (put surface/margins/width/`flex-wrap` here), `ariaLabel?`. |

## Glass surfaces

Surfaces use CSS utilities in `src/renderer/index.css`, not per-component styles:
`.glass-control` (small controls — select triggers, text/number inputs; `rounded-lg`,
light blur, no sheen so it doesn't wash small labels), `.glass-primary` (section
shells), `.glass-secondary` (sub-cards/panels), `.glass-modal` (modals, popovers,
tooltips), `.glass-scrim` (modal backdrops). Use these — or the `Card` / `Input` /
`Modal` components — instead of copy-pasting `bg-glass/… backdrop-blur-md … rounded-2xl`.

Pair `.glass-modal` with a `bg-overlay/70`–`/80` utility on anything holding text over
arbitrary content (dropdown menus, modals): the tier's 10% fill alone leaves labels
competing with whatever sits behind the portal. `Modal` already does this.

`.glass-scrim` is `fixed inset-0` + centering + a themed veil (`--ap-scrim`) + blur.
Never hand-roll `fixed inset-0 … bg-black/60 backdrop-blur-sm`: a 60% black veil is
right in dark mode and far too heavy over the light theme's pastel backdrop. The
tour's spotlight cutout uses the heavier `--ap-scrim-strong`. It sets no `z-index` —
callers supply their own.

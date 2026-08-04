# Shared component library

The single home for reusable renderer UI primitives. **Import from the barrel**, not
from individual files or by hand-rolling an equivalent:

```ts
import { GlassToggle, Select, appConfirm, Card } from '../Shared';
```

`npm run lint:ui` (part of `npm test`) blocks new native `<select>`, hand-rolled
toggles (`role="switch"`), and `window.confirm`/`alert`, and warns on copy-pasted
glass card shells. Add a primitive here + export it from `index.ts` rather than
duplicating markup elsewhere.

## Catalog

| Export | Kind | Purpose / key props |
|---|---|---|
| `Button` | component | Glass button. `variant?: 'primary'\|'secondary'\|'danger'\|'ghost'` (default `primary`), `size?: 'xs'\|'sm'\|'md'` (default `md`), plus all native `<button>` props. Filled variants always use white text; `size` owns padding (don't override px/py via `className`). Never hand-roll `px-4 py-2 rounded-lg …` shells. |
| `GlassToggle` | component | Spring-animated switch. `checked`, `onChange(next)`, `size?: 'sm'\|'md'\|'lg'`, `disabled?`, `label?`, `className?`. |
| `Checkbox` | component | Glass checkbox replacing native `<input type="checkbox">` (whose unstyled box inherits the OS accent colour). `checked`, `onChange(next)`, `indeterminate?` (partial/dash state), `disabled?`, `label?`, `ariaLabel?`, `size?: 'sm'\|'md'`, `className?`. |
| `Radio` | component | Glass radio button (single-select counterpart to `Checkbox`). `checked`, `onChange(next)`, `name?` (share across a group for mutual exclusion), `disabled?`, `label?`, `ariaLabel?`, `size?: 'sm'\|'md'`, `className?`. Omit `label` when a wrapping `<label>` already covers the row. |
| `Select` | component | Glass dropdown replacing native `<select>`; portal-rendered so it's never clipped. `value`, `options: SelectOption[]`, `onChange(value)`, `className?`, `ariaLabel?`. `SelectOption = { value, label, swatch?, disabled?, group? }` — `disabled` renders a non-selectable placeholder, `group` inserts a section header before the first option of each named group. |
| `appAlert` | function | `appAlert(message, title?)` → styled alert; resolves when dismissed. |
| `appConfirm` | function | `appConfirm({ title, message, confirmLabel?, cancelLabel?, danger? })` → `Promise<boolean>`. |
| `AppDialogHost` | component | Renders the active alert/confirm. Mount **once** per window root, after all other content. |
| `TooltipOverlay` | component | The bubble tooltip overlay (glass card that follows bubble tooltip events). Mount once at the app root. |
| `Tooltip` | component | Hover/focus tooltip replacing native `title=`. Wraps a single element: `<Tooltip content="…"><button/></Tooltip>`. `content` accepts JSX; a falsy `content` renders the child untouched. Portal-rendered + viewport-clamped. |
| `Badge` | component | Small labeled chip/pill (never hand-roll `inline-flex … px-2 py-0.5 rounded-… border`). `tone?: 'neutral'\|'info'\|'ok'\|'warn'\|'danger'`, `variant?: 'tag'\|'pill'` (rounded-md vs rounded-full), `dot?` (leading status dot), `uppercase?`, `size?: 'xs'\|'sm'`, `className?`. Backs `InfoPill` and `StatePill`. |
| `Card` | component | Titled `.glass-primary` section panel. `title`, `subtitle?`, `right?`, `children`. |
| `EmptyState` | component | "Nothing to show" block. `message?` (or `children`), `boxed?` (wrap in a `.glass-secondary` panel), `className?`. Default is a centered muted line (`py-8`); `boxed` is for pick-lists / modal scroll regions. |
| `Spinner` | component | Glass-blue loading ring (never hand-roll `border-t-blue-400 … animate-spin`). `size?: 'xs'\|'sm'\|'md'` (12/14/16px, default `sm`), `ariaLabel?` (default "Loading"), `className?`. Ring only — keep your own row markup (label/gap/colour) and swap just the ring. |
| `Segmented` | component | Compact glass segmented control (in-form mode switches). `options: {value,label,hint?,dot?}[]` (`hint` = per-option tooltip, `dot` = leading Tailwind `bg-*` colour dot), `value`, `onChange(next)`, `size?: 'sm'\|'md'` (default `sm`), `className?`. Never hand-roll a row of active-pill buttons. |
| `Tabs` | component | Section / page navigation pills with a sliding active indicator — the larger counterpart to `Segmented`. Renders `role="tablist"`/`role="tab"`. `tabs: {value,label}[]` (`label` is a `ReactNode`, so icons work), `value`, `onChange(next)`, `tone?: 'glass'\|'blue'` (default `glass`; `blue` for prominent sub-tab rows), `className?` (put surface/margins/width/`flex-wrap` here), `ariaLabel?`. |

## Glass surfaces

Surfaces use CSS utilities in `src/renderer/index.css`, not per-component styles:
`.glass-primary` (section shells), `.glass-secondary` (sub-cards/panels),
`.glass-modal` (popovers/tooltips). Use these — or the `Card` component — instead of
copy-pasting `bg-glass/… backdrop-blur-md … rounded-2xl`.

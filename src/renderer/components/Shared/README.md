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
| `Select` | component | Glass dropdown replacing native `<select>`; portal-rendered so it's never clipped. `value`, `options: SelectOption[]`, `onChange(value)`, `className?`, `ariaLabel?`. `SelectOption = { value, label, swatch? }`. |
| `appAlert` | function | `appAlert(message, title?)` → styled alert; resolves when dismissed. |
| `appConfirm` | function | `appConfirm({ title, message, confirmLabel?, cancelLabel?, danger? })` → `Promise<boolean>`. |
| `AppDialogHost` | component | Renders the active alert/confirm. Mount **once** per window root, after all other content. |
| `TooltipOverlay` | component | The bubble tooltip overlay (glass card that follows bubble tooltip events). Mount once at the app root. |
| `Tooltip` | component | Hover/focus tooltip replacing native `title=`. Wraps a single element: `<Tooltip content="…"><button/></Tooltip>`. `content` accepts JSX; a falsy `content` renders the child untouched. Portal-rendered + viewport-clamped. |
| `Card` | component | Titled `.glass-primary` section panel. `title`, `subtitle?`, `right?`, `children`. |
| `Segmented` | component | Compact glass segmented control. `options: {value,label}[]`, `value`, `onChange(next)`. |

## Glass surfaces

Surfaces use CSS utilities in `src/renderer/index.css`, not per-component styles:
`.glass-primary` (section shells), `.glass-secondary` (sub-cards/panels),
`.glass-modal` (popovers/tooltips). Use these — or the `Card` component — instead of
copy-pasting `bg-glass/… backdrop-blur-md … rounded-2xl`.

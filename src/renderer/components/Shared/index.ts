// Agent Pulse shared component library — the single import surface for reusable
// renderer UI primitives. Import from here (e.g. `from '../Shared'`) instead of
// reaching into individual files or hand-rolling equivalents. See README.md.
//
// `npm run lint:ui` enforces that new code uses these instead of native
// <select>, hand-rolled toggles, window.confirm/alert, or copy-pasted glass.

export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export {
  IconButton,
  type IconButtonProps,
  type IconButtonShape,
  type IconButtonSize,
  type IconButtonTone,
} from './IconButton';
export { GlassToggle } from './GlassToggle';
export { Select, type SelectOption } from './Select';
export { Input, Textarea, type InputProps, type TextareaProps, type InputSize } from './Input';
export { Checkbox } from './Checkbox';
export { Radio } from './Radio';
export { appAlert, appConfirm, AppDialogHost, type ConfirmOptions } from './AppDialog';
export { TooltipOverlay } from './TooltipOverlay';
export { Tooltip } from './Tooltip';
export { InfoTooltip } from './InfoTooltip';
export { useChartTip } from './useChartTip';
export { Badge, type BadgeTone, type BadgeVariant, type BadgeSize, type BadgeWeight } from './Badge';
export { Card } from './Card';
export { EmptyState } from './EmptyState';
export { Meter, type MeterProps, type MeterSize } from './Meter';
export { Spinner } from './Spinner';
export { Modal } from './Modal';
export { Segmented, type SegmentedOption } from './Segmented';
export { Tabs, type TabItem } from './Tabs';
export { AnimatedNumber } from './AnimatedNumber';
export { Markdown } from './Markdown';

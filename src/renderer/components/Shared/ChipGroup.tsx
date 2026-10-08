import React, { useRef } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';
import { snappy } from '../../motion';
import { projectColor } from '../Backlog/project-colors';

/**
 * Chip / ChipGroup — the selectable-pill primitive for filtering and
 * multi-select (project filter, weekday toggles, mascot picker). The sibling
 * of <Segmented> (which picks a single value for content above/beside it) and
 * <Tabs> (which switches the body below it) — see Shared/README's "Choosing a
 * switcher". Nothing else should render a row of active-pill buttons.
 *
 * `Chip` is the single pill: a toggle button that reads as a `Badge`-shaped
 * glass surface idle, and a blue (or `hue`-tinted) fill when selected. `hue` is
 * a key understood by `project-colors.ts` (typically a project id) — it swaps
 * the default blue selected/idle tint for that project's accent, matching the
 * project filter chips on the Backlog board. `leading` is a 16px icon slot;
 * `trailing` is an action slot (e.g. a ✕ `IconButton`) whose clicks are kept
 * from toggling the chip.
 *
 * With no `trailing`, the whole pill is one `motion.button` carrying the shell
 * classes directly. With a `trailing`, the DOM must never put a button inside a
 * button (a real `IconButton` is commonly passed as `trailing`), so the shell
 * becomes a non-interactive `<span>` and the selectable part is an inner
 * `motion.button` (label + `leading`, unstyled layout only) with `trailing`
 * rendered as that button's *sibling*, not its descendant.
 *
 * `ChipGroup` renders a row of `Chip`s from `options` and owns the
 * single/`multiple` selection semantics and roving-focus keyboard nav for the
 * single-select (radiogroup) case, mirroring `Segmented`.
 */

// Visual-only shell (no interactivity assumptions — applied to a <button> when
// there's no trailing action, or to the wrapping <span> when there is).
const CHIP_SHELL = 'inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors';

// Solo form (no trailing): padding lives on the button itself.
const CHIP_SIZE = {
  md: 'pl-2.5 pr-3 py-1 text-xs',
  sm: 'px-2 py-0.5 text-[11px]',
} as const;

// With a trailing action: the shell keeps the left/vertical padding; the right
// side gets a smaller pad of its own so the trailing slot doesn't float flush
// against the pill's edge.
const CHIP_SIZE_WITH_TRAILING = {
  md: 'pl-2.5 pr-1.5 py-1 text-xs',
  sm: 'pl-2 pr-1 py-0.5 text-[11px]',
} as const;

export interface ChipProps extends Omit<HTMLMotionProps<'button'>, 'onClick' | 'className' | 'children'> {
  selected: boolean;
  onToggle: () => void;
  /** Project (or other) key resolved through `project-colors.ts`'s `projectColor()`. */
  hue?: string;
  /** Leading 16px icon slot. */
  leading?: React.ReactNode;
  /** Trailing action slot (e.g. a remove `IconButton`) — rendered as a sibling of the selectable button, never a descendant, so it never toggles the chip and never nests button-in-button. */
  trailing?: React.ReactNode;
  size?: keyof typeof CHIP_SIZE;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  (
    {
      selected,
      onToggle,
      hue,
      leading,
      trailing,
      size = 'md',
      disabled = false,
      className = '',
      children,
      role = 'button',
      ...rest
    },
    ref,
  ) => {
    const hueColors = hue ? projectColor(hue) : null;
    const toneClass = hueColors
      ? selected
        ? hueColors.filterActive
        : hueColors.filter
      : selected
        ? 'bg-blue-500/15 border-blue-500/50 text-strong'
        : 'glass-control text-muted hover:text-strong';
    // The hue tint classes (project-colors.ts) carry no border colour of their
    // own (the project filter chips are borderless) — keep the shell's `border`
    // transparent so it doesn't draw a mismatched default edge.
    const borderClass = hueColors ? 'border-transparent' : '';

    const button = (
      <motion.button
        ref={ref}
        type='button'
        role={role}
        aria-pressed={role === 'button' ? selected : undefined}
        disabled={disabled}
        onClick={disabled ? undefined : onToggle}
        whileTap={disabled ? undefined : { scale: 0.97 }}
        transition={snappy}
        className={
          trailing
            ? 'inline-flex items-center gap-1.5 min-w-0 cursor-pointer disabled:cursor-default'
            : `${CHIP_SHELL} ${CHIP_SIZE[size]} ${borderClass} ${toneClass} cursor-pointer disabled:opacity-40 disabled:cursor-default ${className}`
        }
        {...rest}
      >
        {leading && (
          <span aria-hidden='true' className='shrink-0 w-4 h-4 [&>svg]:w-full [&>svg]:h-full'>
            {leading}
          </span>
        )}
        <span className='truncate'>{children}</span>
      </motion.button>
    );

    if (!trailing) return button;

    // Non-interactive shell holds the visual pill classes; the button and the
    // trailing action are siblings inside it, never nested.
    return (
      <span
        className={`${CHIP_SHELL} ${CHIP_SIZE_WITH_TRAILING[size]} ${borderClass} ${toneClass} ${
          disabled ? 'opacity-40' : ''
        } ${className}`}
      >
        {button}
        <span onClick={(e) => e.stopPropagation()} className='shrink-0 flex items-center'>
          {trailing}
        </span>
      </span>
    );
  },
);

Chip.displayName = 'Chip';

export interface ChipGroupOption {
  value: string;
  label: React.ReactNode;
  hue?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  disabled?: boolean;
}

export const ChipGroup: React.FC<{
  options: ChipGroupOption[];
  value: string | string[];
  onChange: (next: string | string[]) => void;
  multiple?: boolean;
  size?: keyof typeof CHIP_SIZE;
  /** Accessible name for the group/radiogroup track. */
  ariaLabel: string;
  className?: string;
}> = ({ options, value, onChange, multiple = false, size = 'md', ariaLabel, className = 'flex flex-wrap gap-2' }) => {
  const chipRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedValues = multiple && Array.isArray(value) ? value : null;
  const singleValue = !multiple && typeof value === 'string' ? value : undefined;

  const isSelected = (v: string) => (selectedValues ? selectedValues.includes(v) : v === singleValue);

  const toggle = (v: string) => {
    if (selectedValues) {
      const set = new Set(selectedValues);
      if (set.has(v)) set.delete(v);
      else set.add(v);
      // Preserve option order rather than toggle/insertion order.
      onChange(options.filter((o) => set.has(o.value)).map((o) => o.value));
    } else {
      onChange(v);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (multiple) return; // roving nav only applies to the single-select radiogroup
    const idx = options.findIndex((o) => o.value === singleValue);
    if (idx === -1) return;
    let nextIdx = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (idx + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (idx - 1 + options.length) % options.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = options.length - 1;
    else return;
    e.preventDefault();
    const next = options[nextIdx];
    if (!next) return;
    onChange(next.value);
    chipRefs.current[nextIdx]?.focus();
  };

  const anySelected = options.some((o) => isSelected(o.value));
  const firstEnabledIdx = Math.max(0, options.findIndex((o) => !o.disabled));
  return (
    <div
      role={multiple ? 'group' : 'radiogroup'}
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={className}
    >
      {options.map((opt, i) => {
        const selected = isSelected(opt.value);
        // Roving tab stop: the selected chip, or — when nothing in this group
        // is selected (e.g. two groups sharing one value) — the first enabled
        // chip, so the group never becomes unreachable by keyboard.
        const tabStop = selected || (!anySelected && i === firstEnabledIdx);
        const roleProps = multiple
          ? ({ role: 'button', 'aria-pressed': selected } as const)
          : ({ role: 'radio', 'aria-checked': selected, tabIndex: tabStop ? 0 : -1 } as const);
        return (
          <Chip
            key={opt.value}
            ref={(el) => { chipRefs.current[i] = el; }}
            selected={selected}
            onToggle={() => toggle(opt.value)}
            hue={opt.hue}
            leading={opt.leading}
            trailing={opt.trailing}
            size={size}
            disabled={opt.disabled}
            {...roleProps}
          >
            {opt.label}
          </Chip>
        );
      })}
    </div>
  );
};

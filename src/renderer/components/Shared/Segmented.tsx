import React, { useId, useRef } from 'react';
import { motion } from 'framer-motion';
import { snappy } from '../../motion';
import { Tooltip } from './Tooltip';

/**
 * Segmented — a compact glass segmented control (mutually-exclusive pills).
 * Use for small in-place mode switches instead of a native <select> or a
 * hand-rolled row of buttons. For larger section/page navigation, use <Tabs>.
 * ChipGroup is the sibling for filters / multi-select.
 *
 * The active fill is a single shared layer that slides between pills (spring),
 * and each pill gives a small press dip on tap. `useId` scopes the sliding
 * indicator so multiple Segmented controls on one screen never animate into
 * each other.
 *
 * Per-option extras:
 *  - `hint`  wraps the pill in a <Tooltip> (hover help for the option). Required
 *            when the option is icon-only (no `label`) — it doubles as the
 *            accessible name.
 *  - `dot`   renders a small leading colour dot (Tailwind bg-* class), e.g. a
 *            risk-tier swatch.
 *  - `icon`  renders a 16px leading icon before the label. `label` becomes
 *            optional once `icon` is set — an icon-only pill falls back to
 *            `hint` as its visible tooltip and `aria-label`.
 *
 * A11y: the track is `role='radiogroup'`, each pill is `role='radio'` with
 * `aria-checked` and a roving `tabIndex` (only the active pill is tab-stop 0).
 * Arrow Right/Down moves to the next option, Left/Up to the previous, Home/End
 * jump to the first/last — matching the radiogroup pattern `Tabs` uses for its
 * tablist. Moving the selection with the keyboard calls `onChange` and moves
 * focus to the newly active pill.
 */
export type SegmentedOption = { value: string; dot?: string } & (
  | { label: string; icon?: React.ReactNode; hint?: React.ReactNode }
  | { icon: React.ReactNode; label?: string; hint: React.ReactNode }
);

const SIZES = {
  xs: 'px-2 py-0.5 text-[11px]',
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-1.5 text-sm',
} as const;

export const Segmented: React.FC<{
  options: SegmentedOption[];
  value: string;
  onChange: (next: string) => void;
  size?: keyof typeof SIZES;
  /** Allow the pill row to wrap onto multiple lines instead of overflowing. */
  wrap?: boolean;
  /** Accessible name for the radiogroup track (e.g. "Theme"). */
  ariaLabel?: string;
  className?: string;
}> = ({ options, value, onChange, size = 'sm', wrap = false, ariaLabel, className = '' }) => {
  const groupId = useId();
  const pillRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (nextIdx: number) => {
    const next = options[nextIdx];
    if (!next) return;
    onChange(next.value);
    pillRefs.current[nextIdx]?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = options.findIndex((o) => o.value === value);
    if (idx === -1) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      move((idx + 1) % options.length);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      move((idx - 1 + options.length) % options.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      move(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      move(options.length - 1);
    }
  };

  const hasActive = options.some((o) => o.value === value);
  return (
    <div
      role='radiogroup'
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={`inline-flex gap-1 p-1 bg-glass/60 border border-edge/60 rounded-lg ${wrap ? 'flex-wrap' : ''} ${className}`}
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        // Roving tab stop: the active pill, or — when `value` matches nothing
        // (e.g. a "custom" state with no option lit) — the first pill, so the
        // group never becomes unreachable by keyboard.
        const tabStop = active || (!hasActive && i === 0);
        const iconOnly = Boolean(opt.icon) && !opt.label;
        const pill = (
          <motion.button
            key={opt.value}
            ref={(el) => { pillRefs.current[i] = el; }}
            role='radio'
            aria-checked={active}
            aria-label={iconOnly && typeof opt.hint === 'string' ? opt.hint : undefined}
            tabIndex={tabStop ? 0 : -1}
            onClick={() => onChange(opt.value)}
            whileTap={{ scale: 0.95 }}
            transition={snappy}
            className={`relative rounded-md font-medium cursor-pointer transition-colors ${SIZES[size]} ${
              active ? 'text-strong' : 'text-muted hover:text-strong'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`segmented-${groupId}`}
                className='absolute inset-0 rounded-md bg-control'
                transition={snappy}
              />
            )}
            <span className='relative z-10 flex items-center gap-1.5'>
              {opt.icon && (
                <span aria-hidden='true' className='shrink-0 w-4 h-4 [&>svg]:w-full [&>svg]:h-full'>
                  {opt.icon}
                </span>
              )}
              {opt.dot && <span className={`w-2 h-2 rounded-full ${opt.dot}`} />}
              {opt.label}
            </span>
          </motion.button>
        );
        return opt.hint ? (
          <Tooltip key={opt.value} content={opt.hint}>
            {pill}
          </Tooltip>
        ) : (
          pill
        );
      })}
    </div>
  );
};

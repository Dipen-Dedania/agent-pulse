import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { snappy } from '../../motion';

/**
 * Checkbox — the single glass-styled checkbox used across the app. Replaces
 * raw <input type="checkbox">, whose unstyled box inherits the OS accent colour
 * (which reads as an off-brand red on some Windows themes). Checked state is
 * brand blue, matching GlassToggle; `indeterminate` renders a dash for the
 * partial "some of N selected" case.
 *
 * The box is liquid glass, not flat paint: the off-state is the same frosted
 * translucency as `.toggle-glass-off`, the on-state a blued-glass fill with a
 * top sheen and soft glow (both in index.css, theme-aware). Toggling on springs
 * the box with a quick scale "pop" and draws the tick in via `pathLength`, so it
 * moves like the rest of the glass surface — all gated by the app-root
 * `<MotionConfig reducedMotion="user">`, which collapses it to instant on demand.
 *
 * A real (visually-hidden) native input drives semantics, focus and keyboard;
 * the visible box is a sibling styled from props. `label` wraps both in a
 * <label> so the text is clickable; omit it when an ancestor <label> already
 * covers the row.
 */

type CheckboxSize = 'sm' | 'md';

const BOX: Record<CheckboxSize, string> = {
  sm: 'w-4 h-4',
  md: 'w-[18px] h-[18px]',
};

interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Render the partial (dash) state. Ignored while `checked` is true. */
  indeterminate?: boolean;
  disabled?: boolean;
  label?: React.ReactNode;
  ariaLabel?: string;
  size?: CheckboxSize;
  className?: string;
}

export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  indeterminate = false,
  disabled = false,
  label,
  ariaLabel,
  size = 'md',
  className = '',
}) => {
  const ref = useRef<HTMLInputElement>(null);
  const partial = indeterminate && !checked;
  // `indeterminate` is a DOM property, not an attribute — set it imperatively.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);

  const on = checked || partial;

  const control = (
    <span className={`relative inline-flex ${BOX[size]} shrink-0`}>
      <input
        ref={ref}
        type='checkbox'
        checked={checked}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
        className='peer absolute inset-0 z-10 m-0 opacity-0 cursor-pointer disabled:cursor-not-allowed'
      />
      {/* pointer-events-none keeps clicks flowing through to the input above,
          even though the transform here establishes a stacking context. The
          scale keyframe only plays on the transition into the "on" variant. */}
      <motion.span
        aria-hidden
        initial={false}
        animate={on ? 'on' : 'off'}
        variants={{ on: { scale: [1, 0.86, 1] }, off: { scale: 1 } }}
        transition={{ duration: 0.26, ...(on ? {} : snappy) }}
        className={`pointer-events-none inline-flex ${BOX[size]} items-center justify-center rounded-[5px] border transition-colors duration-200 ${
          on ? 'checkbox-glass-on border-transparent text-white' : 'checkbox-glass-off border-edge-strong'
        } peer-focus-visible:ring-2 peer-focus-visible:ring-blue-400/70`}
      >
        <AnimatePresence initial={false} mode='wait'>
          {partial ? (
            <motion.svg
              key='dash'
              viewBox='0 0 16 16'
              className='w-3 h-3'
              fill='none'
              stroke='currentColor'
              strokeWidth={2.5}
              strokeLinecap='round'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <path d='M4 8h8' />
            </motion.svg>
          ) : checked ? (
            <motion.svg
              key='check'
              viewBox='0 0 16 16'
              className='w-3 h-3'
              fill='none'
              stroke='currentColor'
              strokeWidth={2.5}
              strokeLinecap='round'
              strokeLinejoin='round'
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.path
                d='M3.5 8.5l3 3 6-6'
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={snappy}
              />
            </motion.svg>
          ) : null}
        </AnimatePresence>
      </motion.span>
    </span>
  );

  if (label == null) {
    return <span className={className}>{control}</span>;
  }
  return (
    <label className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${className}`}>
      {control}
      <span className='text-xs text-muted'>{label}</span>
    </label>
  );
};

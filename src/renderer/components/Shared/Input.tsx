import React from 'react';

/**
 * Input / Textarea — the app's text-entry primitives, on the same `.glass-control`
 * material as the `Select` trigger. Use these instead of hand-rolling
 * `<input className='bg-glass/60 border border-edge/70 rounded-lg …'>`, which is a
 * flat painted fill: no blur, no specular rim, no light-theme branch — so a
 * hand-rolled field sitting next to a `Select` in the same row reads as a
 * different material.
 *
 *   <Input value={title} onChange={…} placeholder='Card title' />
 *   <Input size='sm' type='time' value={slot.time} onChange={…} />
 *   <Input size='xs' className='w-16 text-right' type='number' … />
 *   <Textarea rows={5} value={description} onChange={…} />
 *
 * `size` is the glass size tier, NOT the native numeric `size` attribute (which
 * is deliberately omitted from the props — it has no use here and the names
 * collide). As with `Button`, the tier owns padding + text-size: put only layout
 * (`w-*`, `text-right`, `font-mono`) in `className`, because with no
 * tailwind-merge a conflicting padding utility wins or loses by stylesheet order,
 * not attribute order.
 */

export type InputSize = 'xs' | 'sm' | 'md';

// Three tiers cover every field in the app; near-neighbour paddings (py-1 vs
// py-1.5) normalize onto these on purpose, same as Button's scale.
const SIZES: Record<InputSize, string> = {
  xs: 'px-2 py-1 text-xs', // statusline segment fields, inline issue filters
  sm: 'px-2 py-1 text-sm', // time pickers, small numeric limits
  md: 'px-3 py-1.5 text-sm', // card editor, templates, search palette
};

// Deliberately no width: fields in a `flex flex-col` label already stretch to
// fill the cross axis, and the inline ones (time pickers, `w-16` numerics) must
// stay content-sized. Add `w-full` / `w-*` per call site.
const BASE =
  'glass-control text-strong placeholder:text-ghost transition-colors ' +
  'focus:outline-none focus:border-blue-500/60 hover:border-edge-strong ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

// Invalid state: a red rim rather than a red fill, so the glass material holds.
const INVALID = 'border-red-500/50 focus:border-red-500/70';

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  /** Marks the field as failing validation (red rim + `aria-invalid`). */
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'md', invalid = false, className = '', ...rest }, ref) => (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`${BASE} ${SIZES[size]} ${invalid ? INVALID : ''} ${className}`}
      {...rest}
    />
  ),
);

Input.displayName = 'Input';

export interface TextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  size?: InputSize;
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ size = 'md', invalid = false, className = '', ...rest }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      // apple-scroll because a textarea scrolls its own content: without it the
      // overflow falls back to the chunky Windows scrollbar (track + arrow
      // buttons), which the app's overlay scrollbar exists to replace.
      className={`${BASE} ${SIZES[size]} apple-scroll resize-y leading-relaxed ${invalid ? INVALID : ''} ${className}`}
      {...rest}
    />
  ),
);

Textarea.displayName = 'Textarea';

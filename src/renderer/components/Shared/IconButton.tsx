import React from 'react';

/**
 * IconButton — the square/circular glass button that holds a single glyph or
 * icon: dismiss ✕, reorder ↑↓, refresh ↻, copy, back. Eleven of these were
 * hand-rolled across Settings and the Backlog board in three box sizes, two
 * radii, and five different hover treatments; this is the one implementation.
 *
 *   <IconButton tone='danger' aria-label='Remove slot' onClick={remove}>✕</IconButton>
 *   <IconButton shape='square' size='sm' tone='ghost' aria-label='Copy'>{icon}</IconButton>
 *
 * `size` owns the box (like `Button`'s size owns padding) — put only layout in
 * `className` (`shrink-0`, `ml-auto`), not `w-`/`h-`/colour, which can't reliably
 * override a utility of the same specificity. Wrap in `<Tooltip>` when the
 * glyph needs explaining; `aria-label` is required either way.
 */

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonShape = 'circle' | 'square';
export type IconButtonTone = 'neutral' | 'danger' | 'ghost' | 'outline';

const SIZES: Record<IconButtonSize, string> = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-7 h-7 text-sm',
  lg: 'w-9 h-9 text-sm',
};

const TONES: Record<IconButtonTone, string> = {
  // Resting glass fill; the default for dismiss/replay affordances.
  neutral: 'bg-control/60 hover:bg-control-strong text-muted hover:text-strong',
  // Neutral at rest, red on hover — destructive actions announce themselves on
  // approach rather than shouting from a resting red fill.
  danger: 'bg-control/50 hover:bg-red-500/30 text-muted hover:text-danger',
  // No resting fill — for buttons that sit inside dense rows (diff headers,
  // list items) where a fill per row would read as noise.
  ghost: 'bg-transparent hover:bg-control/50 text-faint hover:text-primary',
  // Rimmed glass — for buttons on their own against a panel background.
  outline: 'bg-glass/60 border border-edge/60 hover:bg-control hover:border-edge-strong/70 text-body hover:text-strong',
};

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  shape?: IconButtonShape;
  tone?: IconButtonTone;
  /** Required — the glyph carries no accessible name of its own. */
  'aria-label': string;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', shape = 'circle', tone = 'neutral', className = '', type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`flex items-center justify-center shrink-0 cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-default ${
        shape === 'circle' ? 'rounded-full' : 'rounded-md'
      } ${SIZES[size]} ${TONES[tone]} ${className}`}
      {...rest}
    />
  ),
);

IconButton.displayName = 'IconButton';

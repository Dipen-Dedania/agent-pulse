import React from 'react';

/**
 * Badge — the single small labeled chip/pill primitive. Consolidates the two
 * hand-rolled pills that predated it: `InfoPill` (analytics) and `StatePill`
 * (usage), both of which now render a Badge internally. Reach for this instead
 * of a fresh `inline-flex … px-2 py-0.5 rounded-… border …` span.
 *
 * Two shapes via `variant`:
 *   - `tag`  (default) — `rounded-md`, for inline labels (InfoPill).
 *   - `pill` — `rounded-full`, for status pills (StatePill); pair with `dot`.
 *
 * `tone` owns colour (background / text / border + the dot colour); `uppercase`
 * adds the tracked small-caps treatment; `size` is the font size. Colour comes
 * from the shared semantic tokens, so both themes are handled by those tokens.
 */

export type BadgeTone = 'neutral' | 'info' | 'ok' | 'warn' | 'danger';
export type BadgeVariant = 'tag' | 'pill';
export type BadgeSize = 'xs' | 'sm' | 'md';
export type BadgeWeight = 'medium' | 'semibold';

// chip = bg/text/border triplet; dot = the leading status-dot colour. Values are
// the exact classes StatePill/InfoPill used, so wrapping them is pixel-stable.
const TONE: Record<BadgeTone, { chip: string; dot: string }> = {
  neutral: { chip: 'bg-control/40 text-body border-edge-strong/60', dot: 'bg-faint' },
  info: { chip: 'bg-blue-500/10 text-info border-blue-500/30', dot: 'bg-blue-400' },
  ok: { chip: 'bg-emerald-500/15 text-ok border-emerald-500/30', dot: 'bg-ok' },
  warn: { chip: 'bg-amber-500/15 text-warn border-amber-500/40', dot: 'bg-warn' },
  danger: { chip: 'bg-red-500/15 text-danger border-red-500/40', dot: 'bg-danger' },
};

// Size owns font size *and* horizontal padding. `xs`/`sm` keep the original
// `px-2` so the InfoPill/StatePill wrappers stay pixel-stable; `md` is the 12px
// tier the Settings header pills were hand-rolling at `px-2.5`.
const SIZE: Record<BadgeSize, string> = {
  xs: 'text-[10px] px-2',
  sm: 'text-[11px] px-2',
  md: 'text-xs px-2.5',
};

// Spelled out (not `font-${weight}`) — Tailwind only generates classes it can
// find as complete strings in the source.
const WEIGHT: Record<BadgeWeight, string> = {
  medium: 'font-medium',
  semibold: 'font-semibold',
};

interface BadgeProps {
  tone?: BadgeTone;
  variant?: BadgeVariant;
  /** Leading status dot in the tone colour (the state-pill look). */
  dot?: boolean;
  /** Tracked small-caps (`uppercase tracking-wider font-medium`). */
  uppercase?: boolean;
  size?: BadgeSize;
  /**
   * Font weight. Omitted → inherited, which is what the pre-existing
   * `InfoPill`/`StatePill` callers render, so leaving it off is pixel-stable.
   * `semibold` is the guardrail/secret decision pills.
   */
  weight?: BadgeWeight;
  className?: string;
  role?: string;
  'aria-live'?: 'off' | 'polite' | 'assertive';
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({
  tone = 'neutral',
  variant = 'tag',
  dot = false,
  uppercase = false,
  size = 'sm',
  weight,
  className = '',
  role,
  'aria-live': ariaLive,
  children,
}) => {
  const t = TONE[tone];
  return (
    <span
      role={role}
      aria-live={ariaLive}
      className={`inline-flex items-center gap-1.5 py-0.5 border ${
        variant === 'pill' ? 'rounded-full' : 'rounded-md'
      } ${t.chip} ${SIZE[size]}${weight ? ` ${WEIGHT[weight]}` : ''}${
        uppercase ? ' uppercase tracking-wider font-medium' : ''
      } ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} aria-hidden />}
      {children}
    </span>
  );
};

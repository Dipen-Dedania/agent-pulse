import React from 'react';
import { motion } from 'framer-motion';
import { smooth } from '../../motion';

/**
 * Meter — the single horizontal progress/quota bar: a rounded track with a fill
 * that grows from the left. Replaces the seven hand-rolled
 * `rounded-full overflow-hidden` + inner `h-full` pairs that had drifted apart
 * across the bubble, the usage sections, analytics, and the updater.
 *
 * Two ways to colour it, because the two halves of the app work differently:
 *
 *   // Settings / analytics — Tailwind classes off the semantic tokens.
 *   <Meter value={pct} size='sm' fillClass={quotaFillClass(pct)} />
 *
 *   // Bubble — a transparent always-on-top window that computes its own rgba
 *   // (see components/Bubble/quota.ts) and sizes bars in exact pixels.
 *   <Meter
 *     value={remaining}
 *     width={bar.width}
 *     height={bar.height}
 *     minWidthPct={2}
 *     fillColor={fillColorForRemaining(remaining, isDark)}
 *     trackColor={quotaTrackColor(isDark)}
 *   />
 *
 * `Meter` knows nothing about quotas or tiers — callers keep owning the colour
 * scale (`quotaFillClass` in usage/UsageShared.tsx, `fillColorForRemaining` in
 * Bubble/quota.ts), so a threshold change stays in one place.
 */

export type MeterSize = 'xs' | 'sm' | 'md' | 'lg';

/** The size owns the track height; `height` overrides it for pixel-exact callers. */
const SIZES: Record<MeterSize, string> = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3',
};

export interface MeterProps {
  /** Percent filled, 0–100. Clamped, so callers can pass raw arithmetic. */
  value: number;
  size?: MeterSize;
  /** Fill colour as a Tailwind class (e.g. `bg-blue-500`). */
  fillClass?: string;
  /** Track colour as a Tailwind class. */
  trackClass?: string;
  /** Fill colour as a CSS value — wins over `fillClass`. */
  fillColor?: string;
  /** Track colour as a CSS value — wins over `trackClass`. */
  trackColor?: string;
  /** Explicit track width (number → px). Default: fills its container. */
  width?: number | string;
  /** Explicit track height (number → px). Overrides `size`. */
  height?: number | string;
  /** Spring the fill's width (framer-motion) instead of a CSS transition. */
  animate?: boolean;
  /**
   * Floor, in percent, for a non-zero `value` — keeps a nearly-empty bar
   * visible instead of collapsing it to a hairline. A `value` of exactly 0
   * still renders an empty track.
   */
  minWidthPct?: number;
  /** Layout only (margins, `flex-1`, …) — not colour or height. */
  className?: string;
  /** Accessible name. The bar always reports `role='progressbar'`. */
  ariaLabel?: string;
}

export const Meter: React.FC<MeterProps> = ({
  value,
  size = 'sm',
  fillClass = '',
  trackClass = 'bg-control/40',
  fillColor,
  trackColor,
  width,
  height,
  animate = false,
  minWidthPct = 0,
  className = '',
  ariaLabel,
}) => {
  const pct = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const widthPct = pct > 0 ? Math.max(minWidthPct, pct) : 0;

  // A CSS colour wins over the class so the two styling modes can't fight: the
  // class stays in `className` (harmless) while the inline style paints.
  const trackStyle: React.CSSProperties = {};
  if (width !== undefined) trackStyle.width = width;
  if (height !== undefined) trackStyle.height = height;
  if (trackColor) trackStyle.background = trackColor;

  const fillStyle: React.CSSProperties = { width: `${widthPct}%` };
  if (fillColor) fillStyle.background = fillColor;

  // Transition lives on the CSS class unless framer-motion is driving width.
  const fillClasses = `h-full rounded-full ${
    animate ? '' : 'transition-all duration-500 motion-reduce:transition-none'
  } ${fillClass}`;

  return (
    <div
      role='progressbar'
      aria-label={ariaLabel}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`relative rounded-full overflow-hidden ${height === undefined ? SIZES[size] : ''} ${
        width === undefined ? 'w-full' : ''
      } ${trackClass} ${className}`}
      style={trackStyle}
    >
      {animate ? (
        <motion.div
          className={fillClasses}
          animate={{ width: `${widthPct}%` }}
          transition={smooth}
          style={fillStyle}
        />
      ) : (
        <div className={fillClasses} style={fillStyle} />
      )}
    </div>
  );
};

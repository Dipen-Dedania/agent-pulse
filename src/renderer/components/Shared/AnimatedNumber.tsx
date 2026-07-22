import React, { useEffect, useRef } from 'react';
import { useReducedMotion, useSpring } from 'framer-motion';

/**
 * AnimatedNumber — a value that springs to its target instead of snapping, so
 * counts/totals feel alive when the underlying data updates. Apple-style: the
 * number eases up and settles rather than flipping instantly.
 *
 * Renders plain text (no layout wrapper) so it drops into any heading or stat
 * without disturbing spacing. Honors prefers-reduced-motion — the value is set
 * instantly when the user asks for reduced motion.
 */
interface AnimatedNumberProps {
  value: number;
  /** Decimal places to render. Default 0. */
  decimals?: number;
  /** Prepended to the formatted value (e.g. '$'). */
  prefix?: string;
  /** Appended to the formatted value (e.g. '%', ' tok'). */
  suffix?: string;
  /** Group thousands with locale separators. Default true. */
  group?: boolean;
  /**
   * Custom formatter for the interpolated value. When provided it fully
   * overrides decimals/prefix/suffix/group — pass the same helper the static
   * label used (e.g. a compact `$3.4M` / `1.2k` formatter) so the animated
   * value matches the rest of the UI exactly.
   */
  format?: (value: number) => string;
  className?: string;
}

export const AnimatedNumber: React.FC<AnimatedNumberProps> = ({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  group = true,
  format: formatProp,
  className,
}) => {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  // A soft, slightly-damped spring: quick enough to feel responsive, gentle
  // enough that large jumps count up rather than teleport.
  const spring = useSpring(value, { stiffness: 90, damping: 20, mass: 1 });

  useEffect(() => {
    if (reduce) {
      spring.jump(value);
    } else {
      spring.set(value);
    }
  }, [value, reduce, spring]);

  useEffect(() => {
    const format =
      formatProp ??
      ((n: number) => {
        const fixed = Number(n.toFixed(decimals));
        const body = group
          ? fixed.toLocaleString(undefined, {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            })
          : fixed.toFixed(decimals);
        return `${prefix}${body}${suffix}`;
      });
    // Paint the initial frame synchronously so there's no flash of "0".
    if (ref.current) ref.current.textContent = format(spring.get());
    const unsub = spring.on('change', (latest) => {
      if (ref.current) ref.current.textContent = format(latest);
    });
    return unsub;
  }, [spring, decimals, prefix, suffix, group, formatProp]);

  return <span ref={ref} className={className} />;
};

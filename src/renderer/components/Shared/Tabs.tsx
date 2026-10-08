import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { snappy } from '../../motion';
import { Badge } from './Badge';
import { Tooltip } from './Tooltip';

/**
 * Tabs — section / page navigation pills with a sliding active indicator.
 * The larger counterpart to <Segmented> (which is for compact in-form mode
 * switches). Use this for top-level nav bars and in-panel sub-tab rows.
 *
 * Renders proper ARIA (role="tablist" + role="tab" + aria-selected). The active
 * fill is a single layer that springs between pills; `useId` scopes it so
 * multiple Tabs rows on one screen never animate into each other — no manual
 * group id needed.
 *
 * `tone` picks the active fill:
 *  - 'glass' — subtle frosted fill (`glass-tab-active`), for the primary nav.
 *  - 'blue'  — prominent blue fill, for sub-tab rows that need to stand out.
 *
 * Pass surface / margin / width / wrap via `className` on the track (e.g.
 * `glass-primary rounded-xl mb-8 w-fit` or `glass-secondary flex-wrap mb-2`).
 *
 * `fill` stretches the track to the full width of its container and lets the
 * pills share it (centred labels), for full-width nav bars. Each pill keeps
 * its natural content width as its flex basis and only the *spare* space is
 * split evenly, so a long label ("Plans & Limits") is never clipped to make
 * room for a short one — labels never truncate or wrap.
 *
 * Narrow tracks: when the row of pills would overflow its track, every pill
 * that has an `icon` collapses to icon-only (the label stays in the DOM as
 * `sr-only` so the tab keeps its accessible name, and a `Tooltip` shows it on
 * hover / focus). The row expands again once the track is wide enough for the
 * full labels. Tabs without an icon always keep their label. Measurement uses
 * a ResizeObserver; where that is unavailable (tests) the row stays expanded.
 *
 * Each tab may carry an `icon` (ReactNode) rendered before its label and a
 * `badge` (dot or count) after it for "something new here" signalling.
 */
export interface TabItem {
  value: string;
  label: React.ReactNode;
  /** Optional leading icon (rendered at 16px, inherits text colour). */
  icon?: React.ReactNode;
  /**
   * Attention badge after the label. `true` renders a small red dot (with
   * screen-reader text), a number renders a count pill. Falsy renders nothing.
   */
  badge?: boolean | number;
}

const TONES = {
  glass: { fill: 'glass-tab-active', text: 'text-strong' },
  blue: { fill: 'bg-blue-600 shadow', text: 'text-white' },
} as const;

export const Tabs: React.FC<{
  tabs: TabItem[];
  value: string;
  onChange: (next: string) => void;
  tone?: keyof typeof TONES;
  /** Stretch to the container width and let the pills share it. */
  fill?: boolean;
  className?: string;
  ariaLabel?: string;
}> = ({ tabs, value, onChange, tone = 'glass', fill = false, className = '', ariaLabel }) => {
  const groupId = useId();
  const toneStyle = TONES[tone];

  // Icon-only collapse (see the header comment). `fullWidth` remembers the
  // natural width of the expanded row, captured at the moment it overflowed,
  // so the row only re-expands once the track can actually hold it — without
  // that hysteresis the collapsed row (which fits) would immediately expand
  // again and oscillate.
  const trackRef = useRef<HTMLDivElement>(null);
  const fullWidth = useRef<number | null>(null);
  const [compact, setCompact] = useState(false);
  const collapsible = tabs.some((t) => t.icon);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!collapsible || !el || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      if (!compact) {
        if (el.scrollWidth > el.clientWidth + 1) {
          fullWidth.current = el.scrollWidth;
          setCompact(true);
        }
      } else if (fullWidth.current !== null && el.clientWidth >= fullWidth.current) {
        setCompact(false);
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, collapsible, tabs.length]);

  return (
    <div
      ref={trackRef}
      role='tablist'
      aria-label={ariaLabel}
      className={`flex gap-1 p-1 ${fill ? 'w-full' : ''} ${className}`}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        const iconOnly = compact && Boolean(tab.icon);
        const button = (
          <motion.button
            key={tab.value}
            role='tab'
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            whileTap={{ scale: 0.97 }}
            transition={snappy}
            className={`relative ${iconOnly ? 'px-3' : 'px-4'} py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
              fill ? 'flex-auto' : ''
            } ${active ? toneStyle.text : 'text-muted hover:text-strong'}`}
          >
            {active && (
              <motion.span
                layoutId={`tabs-${groupId}`}
                className={`absolute inset-0 rounded-lg ${toneStyle.fill}`}
                transition={snappy}
              />
            )}
            <span
              className={`relative z-10 inline-flex items-center gap-2 ${fill ? 'justify-center w-full' : ''}`}
            >
              {tab.icon && (
                <span aria-hidden='true' className='shrink-0 w-4 h-4 [&>svg]:w-full [&>svg]:h-full'>
                  {tab.icon}
                </span>
              )}
              <span className={iconOnly ? 'sr-only' : 'whitespace-nowrap'}>{tab.label}</span>
              {tab.badge === true && (
                <>
                  <span
                    aria-hidden='true'
                    data-testid='tab-badge-dot'
                    className='shrink-0 w-1.5 h-1.5 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(255,255,255,0.6)]'
                  />
                  <span className='sr-only'>(new)</span>
                </>
              )}
              {typeof tab.badge === 'number' && tab.badge > 0 && (
                <Badge tone='danger' variant='pill' size='xs' weight='semibold' className='shrink-0'>
                  {tab.badge}
                </Badge>
              )}
            </span>
          </motion.button>
        );
        // Icon-only pills get the label back as a hover / focus tooltip.
        return iconOnly ? (
          <Tooltip key={tab.value} content={tab.label}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
};

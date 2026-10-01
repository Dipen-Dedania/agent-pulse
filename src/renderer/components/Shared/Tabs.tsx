import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { snappy } from '../../motion';
import { Badge } from './Badge';

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
 * `fill` stretches the track to the full width of its container and gives
 * every pill an equal share of it (centred label), for full-width nav bars.
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
  /** Stretch to the container width and give each pill an equal share. */
  fill?: boolean;
  className?: string;
  ariaLabel?: string;
}> = ({ tabs, value, onChange, tone = 'glass', fill = false, className = '', ariaLabel }) => {
  const groupId = useId();
  const toneStyle = TONES[tone];
  return (
    <div
      role='tablist'
      aria-label={ariaLabel}
      className={`flex gap-1 p-1 ${fill ? 'w-full' : ''} ${className}`}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <motion.button
            key={tab.value}
            role='tab'
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            whileTap={{ scale: 0.97 }}
            transition={snappy}
            className={`relative px-4 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
              fill ? 'flex-1 min-w-0' : ''
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
              <span className='truncate'>{tab.label}</span>
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
      })}
    </div>
  );
};

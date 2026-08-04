import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { snappy } from '../../motion';

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
 */
export interface TabItem {
  value: string;
  label: React.ReactNode;
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
  className?: string;
  ariaLabel?: string;
}> = ({ tabs, value, onChange, tone = 'glass', className = '', ariaLabel }) => {
  const groupId = useId();
  const toneStyle = TONES[tone];
  return (
    <div role='tablist' aria-label={ariaLabel} className={`flex gap-1 p-1 ${className}`}>
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
              active ? toneStyle.text : 'text-muted hover:text-strong'
            }`}
          >
            {active && (
              <motion.span
                layoutId={`tabs-${groupId}`}
                className={`absolute inset-0 rounded-lg ${toneStyle.fill}`}
                transition={snappy}
              />
            )}
            <span className='relative z-10'>{tab.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
};

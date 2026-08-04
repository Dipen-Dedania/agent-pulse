import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { snappy } from '../../motion';
import { Tooltip } from './Tooltip';

/**
 * Segmented — a compact glass segmented control (mutually-exclusive pills).
 * Use for small in-place mode switches instead of a native <select> or a
 * hand-rolled row of buttons. For larger section/page navigation, use <Tabs>.
 *
 * The active fill is a single shared layer that slides between pills (spring),
 * and each pill gives a small press dip on tap. `useId` scopes the sliding
 * indicator so multiple Segmented controls on one screen never animate into
 * each other.
 *
 * Per-option extras:
 *  - `hint`  wraps the pill in a <Tooltip> (hover help for the option).
 *  - `dot`   renders a small leading colour dot (Tailwind bg-* class), e.g. a
 *            risk-tier swatch.
 */
export interface SegmentedOption {
  value: string;
  label: string;
  hint?: React.ReactNode;
  dot?: string; // Tailwind bg-* class for a leading colour dot
}

const SIZES = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-1.5 text-sm',
} as const;

export const Segmented: React.FC<{
  options: SegmentedOption[];
  value: string;
  onChange: (next: string) => void;
  size?: keyof typeof SIZES;
  className?: string;
}> = ({ options, value, onChange, size = 'sm', className = '' }) => {
  const groupId = useId();
  return (
    <div className={`inline-flex gap-1 p-1 bg-glass/60 border border-edge/60 rounded-lg ${className}`}>
      {options.map((opt) => {
        const active = opt.value === value;
        const pill = (
          <motion.button
            key={opt.value}
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

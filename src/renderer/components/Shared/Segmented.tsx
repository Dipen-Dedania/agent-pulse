import React, { useId } from 'react';
import { motion } from 'framer-motion';
import { snappy } from '../../motion';

/**
 * Segmented — a compact glass segmented control (mutually-exclusive pills).
 * Use for small in-place mode switches instead of a native <select> or a
 * hand-rolled row of buttons.
 *
 * The active fill is a single shared layer that slides between pills (spring),
 * and each pill gives a small press dip on tap. `useId` scopes the sliding
 * indicator so multiple Segmented controls on one screen never animate into
 * each other.
 */
export const Segmented: React.FC<{
  options: { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
}> = ({ options, value, onChange }) => {
  const groupId = useId();
  return (
    <div className='inline-flex gap-1 p-1 bg-glass/60 border border-edge/60 rounded-lg'>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <motion.button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            whileTap={{ scale: 0.95 }}
            transition={snappy}
            className={`relative px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
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
            <span className='relative z-10'>{opt.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
};

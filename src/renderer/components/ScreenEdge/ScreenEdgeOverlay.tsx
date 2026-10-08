import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { colorsFor } from '../../../common/stateColors';
import { smooth } from '../../motion';

// Reuse the single source of truth for the `waiting` palette so the glow's blue
// can never drift from the bubble's. This overlay floats over the live desktop
// (no theme context), so the dark-variant blue is the visible one.
const WAITING = colorsFor('waiting', true);
const GLOW = WAITING.glow ?? 'rgba(59,130,246,0.5)';

// Breathing edge-glow: a soft inner gradient that swells in from the screen
// edges and settles — no hard border line, just the halo. The whole overlay is
// `pointer-events-none` (and the host window is click-through), so it never
// interferes with whatever you're doing underneath.
export const ScreenEdgeOverlay: React.FC = () => {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const handler = (_e: unknown, next: boolean) => setActive(Boolean(next));
    window.electron.on('screen-edge:active', handler);
    // Subscribe first, THEN ask main for the current state — this ordering
    // closes the race where main broadcasts right after creating the window,
    // before this listener exists (which made the first Preview show nothing).
    window.electron.send('screen-edge:ready');
    return () => window.electron.off('screen-edge:active', handler);
  }, []);

  return (
    <div className='fixed inset-0 pointer-events-none overflow-hidden'>
      <AnimatePresence>
        {active && (
          <motion.div
            key='screen-edge-frame'
            className='absolute inset-0'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={smooth}
          >
            <motion.div
              className='absolute inset-0'
              animate={{
                boxShadow: [
                  `inset 0 0 60px 6px ${GLOW}`,
                  `inset 0 0 120px 26px ${GLOW}`,
                  `inset 0 0 60px 6px ${GLOW}`,
                ],
              }}
              transition={{ duration: 2.6, ease: 'easeInOut', repeat: Infinity }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

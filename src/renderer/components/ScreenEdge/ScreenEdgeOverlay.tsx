import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EDGE_PALETTES, EDGE_TIMINGS, ScreenEdgePayload } from '../../../common/screenEdge';
import { smooth } from '../../motion';
import { CometBorder } from './CometBorder';

// Until main's first `screen-edge:state` arrives, render nothing.
const INITIAL: ScreenEdgePayload = {
  active: false,
  paused: false,
  style: 'glow',
  color: 'blue',
  speed: 'normal',
  geometry: { notch: null, cornerRadius: 0, trayCorner: 'br' },
};

// The ambient border, in the style the user picked:
//  - glow:  a soft inner gradient that breathes in from the screen edges — no
//           hard border line, just the halo. The `blue` palette is the waiting
//           colour (stateColors `waiting.glow.dark`), so the default is unchanged.
//  - comet: see CometBorder — laps the edge and lands on the notch / tray corner,
//           looping while anything is waiting.
// The whole overlay is `pointer-events-none` (and the host window is
// click-through), so it never interferes with whatever you're doing underneath.
export const ScreenEdgeOverlay: React.FC = () => {
  const [state, setState] = useState<ScreenEdgePayload>(INITIAL);

  useEffect(() => {
    const handler = (_e: unknown, next: ScreenEdgePayload) => {
      if (next && typeof next === 'object') setState(next);
    };
    window.electron.on('screen-edge:state', handler);
    // Subscribe first, THEN ask main for the current state — this ordering
    // closes the race where main broadcasts right after creating the window,
    // before this listener exists (which made the first Preview show nothing).
    window.electron.send('screen-edge:ready');
    return () => window.electron.off('screen-edge:state', handler);
  }, []);

  const glow = EDGE_PALETTES[state.color].glow;
  const breath = EDGE_TIMINGS[state.speed].glowBreath;

  return (
    <div className='fixed inset-0 pointer-events-none overflow-hidden'>
      <AnimatePresence>
        {state.active && (
          <motion.div
            key={`screen-edge-${state.style}`}
            className='absolute inset-0'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={smooth}
          >
            {state.style === 'comet' ? (
              <CometBorder color={state.color} speed={state.speed} geometry={state.geometry} paused={state.paused} />
            ) : (
              <motion.div
                className='absolute inset-0'
                animate={{
                  boxShadow: [
                    `inset 0 0 60px 6px ${glow}`,
                    `inset 0 0 120px 26px ${glow}`,
                    `inset 0 0 60px 6px ${glow}`,
                  ],
                }}
                transition={{ duration: breath, ease: 'easeInOut', repeat: Infinity }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

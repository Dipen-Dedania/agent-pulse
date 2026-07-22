import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TourState } from '../../../common/types';
import { logger } from '../../../common/logger';
import { Tooltip } from '../Shared';

// ── "Get set up" checklist ───────────────────────────────────────────────────
// Lives at the top of the Hooks tab until dismissed. The three items check off
// from REAL state, not tour progress: hook detection, live bubble windows, and
// the install's first-ever hook event (tour.firstEventAt, pushed by main via
// `tour:state-updated`). Hook installation is the one genuinely required step,
// so it leads; everything stays dismissible — a checklist, never a gate.

interface SetupChecklistProps {
  anyHookInstalled: boolean;
  anyBubbleEnabled: boolean;
}

interface Item {
  label: string;
  hint: string;
  done: boolean;
}

const CheckCircle: React.FC<{ done: boolean }> = ({ done }) => (
  <div
    className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-colors duration-300 ${
      done ? 'bg-green-500 border-green-400' : 'bg-control/50 border-edge-strong'
    }`}
  >
    <AnimatePresence>
      {done && (
        <motion.svg
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          viewBox='0 0 20 20'
          className='w-3 h-3'
          fill='white'
        >
          <path
            fillRule='evenodd'
            d='M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.79 6.8-6.79a1 1 0 0 1 1.4 0z'
            clipRule='evenodd'
          />
        </motion.svg>
      )}
    </AnimatePresence>
  </div>
);

export const SetupChecklist: React.FC<SetupChecklistProps> = ({
  anyHookInstalled,
  anyBubbleEnabled,
}) => {
  const [tourState, setTourState] = useState<TourState | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('tour:get-state')
      .then((s: TourState) => { if (!cancelled) setTourState(s); })
      .catch((e: unknown) => logger.debug('[SetupChecklist] tour:get-state failed', e));
    const handler = (_e: unknown, s: TourState) => setTourState(s);
    window.electron.on('tour:state-updated', handler);
    return () => {
      cancelled = true;
      window.electron.off('tour:state-updated', handler);
    };
  }, []);

  const dismiss = () => {
    setHidden(true); // optimistic — the card is gone the instant they ask
    window.electron
      .invoke('tour:set-setup-dismissed', true)
      .catch((e: unknown) => logger.warn('[SetupChecklist] failed to persist dismiss', e));
  };

  if (!tourState || tourState.setupDismissed || hidden) return null;

  const items: Item[] = [
    {
      label: 'Install a hook',
      hint: 'Pick a tool below and click Install Hook.',
      done: anyHookInstalled,
    },
    {
      label: 'Turn on its bubble',
      hint: 'Flip the toggle on the tool card.',
      done: anyBubbleEnabled,
    },
    {
      label: 'See your first live status',
      hint: 'Start the tool (then restart it if it was already running) — the bubble lights up on its first event.',
      done: !!tourState.firstEventAt,
    },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={`mb-6 glass-primary p-5 ${
        allDone ? 'border-green-500/40' : ''
      }`}
      style={allDone ? { boxShadow: '0 0 24px rgba(34,197,94,0.15)' } : undefined}
    >
      <div className='flex items-center gap-3 mb-4'>
        <div className='flex-1'>
          <p className='font-semibold text-strong leading-tight'>
            {allDone ? 'You’re live' : 'Get set up'}
          </p>
          <p className='text-xs text-muted mt-0.5'>
            {allDone
              ? 'Agent Pulse is watching your agents. The bubbles take it from here.'
              : `${doneCount} of ${items.length} — a couple of minutes, once.`}
          </p>
        </div>
        {allDone ? (
          <button
            onClick={dismiss}
            className='px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors cursor-pointer'
          >
            Done
          </button>
        ) : (
          <Tooltip content='Dismiss — you can always set up from the tool cards below'>
            <button
              onClick={dismiss}
              className='w-7 h-7 flex items-center justify-center rounded-full bg-control/60 hover:bg-control-strong text-muted hover:text-strong transition-colors text-sm cursor-pointer'
              aria-label='Dismiss setup checklist'
            >
              ✕
            </button>
          </Tooltip>
        )}
      </div>

      <div className='flex flex-col gap-3'>
        {items.map((item) => (
          <div key={item.label} className='flex items-start gap-3'>
            <CheckCircle done={item.done} />
            <div className='min-w-0 -mt-0.5'>
              <p className={`text-sm font-medium leading-tight transition-colors duration-300 ${
                item.done ? 'text-faint' : 'text-strong'
              }`}>
                {item.label}
              </p>
              {!item.done && (
                <p className='text-xs text-muted mt-0.5'>{item.hint}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

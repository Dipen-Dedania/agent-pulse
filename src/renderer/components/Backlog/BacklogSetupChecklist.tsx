import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TourState } from '../../../common/types';
import { BacklogAgent } from '../../../common/backlog-types';
import { logger } from '../../../common/logger';
import { Button, IconButton, Tooltip } from '../Shared';
import { pop, smooth } from '../../motion';

// ── Backlog board setup checklist ────────────────────────────────────────────
// Sits at the top of the Backlog board until dismissed. Its three items check
// off from REAL state (a project registered, a card created or imported, one
// card actually run) — the conceptual walk is the guided tour, which this hosts
// via "Tour this board". Kept strictly non-overlapping with the tour: the tour
// explains, the checklist tracks completion. Dismissal persists through
// backlog-tour:set-setup-dismissed and follows main's tour:state-updated
// broadcasts, mirroring the Hooks-tab SetupChecklist.

interface Props {
  hasProject: boolean;
  hasCard: boolean;
  ranOne: boolean;
  onStartTour: () => void;
  onAddProject: () => void;
  onNewCard: () => void;
}

interface Item {
  label: string;
  hint: string;
  done: boolean;
  /** Informational — never counts toward completion (e.g. the Codex CLI). */
  optional?: boolean;
  action?: { label: string; onClick: () => void; disabled?: boolean; disabledHint?: string };
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
          transition={pop}
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

export const BacklogSetupChecklist: React.FC<Props> = ({
  hasProject,
  hasCard,
  ranOne,
  onStartTour,
  onAddProject,
  onNewCard,
}) => {
  const [tourState, setTourState] = useState<TourState | null>(null);
  const [hidden, setHidden] = useState(false);
  // Which agent CLIs are on PATH. Claude Code is what the board needs; Codex
  // is optional (only cards set to Codex use it). null until answered.
  const [agents, setAgents] = useState<Record<BacklogAgent, boolean> | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('tour:get-state')
      .then((s: TourState) => { if (!cancelled) setTourState(s); })
      .catch((e: unknown) => logger.debug('[BacklogSetupChecklist] tour:get-state failed', e));
    window.electron
      .invoke('backlog:agent-availability')
      .then((a: Record<BacklogAgent, boolean>) => { if (!cancelled && a) setAgents(a); })
      .catch((e: unknown) => logger.debug('[BacklogSetupChecklist] backlog:agent-availability failed', e));
    const handler = (_e: unknown, s: TourState) => setTourState(s);
    window.electron.on('tour:state-updated', handler);
    return () => {
      cancelled = true;
      window.electron.off('tour:state-updated', handler);
    };
  }, []);

  const dismiss = () => {
    setHidden(true); // optimistic — gone the instant they ask
    window.electron
      .invoke('backlog-tour:set-setup-dismissed', true)
      .catch((e: unknown) => logger.warn('[BacklogSetupChecklist] failed to persist dismiss', e));
  };

  if (!tourState || tourState.backlogSetupDismissed || hidden) return null;

  const items: Item[] = [
    {
      label: 'Claude Code CLI found',
      hint: 'Cards run with `claude -p` — install Claude Code (or fix PATH) so the board can run them.',
      done: agents?.claude ?? false,
    },
    {
      label: 'Codex CLI found (optional)',
      hint: 'Only cards set to the Codex agent need it. Install Codex to run cards with `codex exec`.',
      done: agents?.codex ?? false,
      optional: true,
    },
    {
      label: 'Add a project',
      hint: 'Register a repo folder — that’s where the agent runs.',
      done: hasProject,
      action: { label: 'Add project', onClick: onAddProject },
    },
    {
      label: 'Create or import a card',
      hint: 'Write one, or pull open issues from GitLab, Linear, or JIRA.',
      done: hasCard,
      action: {
        label: 'New card',
        onClick: onNewCard,
        disabled: !hasProject,
        disabledHint: 'Add a project first',
      },
    },
    {
      label: 'Run a card',
      hint: 'Hit ▶ Run on a card, or let the night session take a green one.',
      done: ranOne,
    },
  ];
  // Optional rows are shown but never gate completion.
  const required = items.filter((i) => !i.optional);
  const doneCount = required.filter((i) => i.done).length;
  const allDone = doneCount === required.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={smooth}
      className={`glass-primary p-5 ${allDone ? 'border-green-500/40' : ''}`}
      style={allDone ? { boxShadow: '0 0 24px rgba(34,197,94,0.15)' } : undefined}
    >
      <div className='flex items-center gap-3 mb-4'>
        <div className='flex-1 min-w-0'>
          <p className='font-semibold text-strong leading-tight'>
            {allDone ? 'Your board is live' : 'Set up your board'}
          </p>
          <p className='text-xs text-muted mt-0.5'>
            {allDone
              ? 'Queue green cards and let the night session run them while you sleep.'
              : `${doneCount} of ${required.length} — new to the planner? Take the tour.`}
          </p>
        </div>
        <Button variant='secondary' size='sm' onClick={onStartTour}>
          Tour this board
        </Button>
        {allDone ? (
          <button
            onClick={dismiss}
            className='px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors cursor-pointer'
          >
            Done
          </button>
        ) : (
          <Tooltip content='Dismiss — everything here stays available from the board'>
            <IconButton onClick={dismiss} aria-label='Dismiss board setup checklist'>
              ✕
            </IconButton>
          </Tooltip>
        )}
      </div>

      <div className='flex flex-col gap-3'>
        {items.map((item) => (
          <div key={item.label} className='flex items-start gap-3'>
            <CheckCircle done={item.done} />
            <div className='min-w-0 -mt-0.5 flex-1'>
              <p className={`text-sm font-medium leading-tight transition-colors duration-300 ${
                item.done ? 'text-faint' : 'text-strong'
              }`}>
                {item.label}
              </p>
              {!item.done && <p className='text-xs text-muted mt-0.5'>{item.hint}</p>}
            </div>
            {!item.done && item.action && (
              <Tooltip content={item.action.disabled ? item.action.disabledHint : undefined}>
                <Button
                  variant='ghost'
                  size='xs'
                  onClick={item.action.onClick}
                  disabled={item.action.disabled}
                  className='shrink-0'
                >
                  {item.action.label}
                </Button>
              </Tooltip>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  );
};

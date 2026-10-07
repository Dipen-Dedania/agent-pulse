import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '../Shared';
import { smooth } from '../../motion';
import { useStarNudge } from '../../hooks/useStarNudge';

/**
 * One-time GitHub star toast. Main stamps a milestone (a week since the first
 * hook event, or the first backlog card done) and this renders until the user
 * answers; either button answers it for good. Mounted beside the Settings
 * panel's tab <AnimatePresence> so a tab switch never unmounts it.
 */
export const StarNudgeToast: React.FC = () => {
  const { state, copy, star, dismissToast } = useStarNudge();
  const visible = !!state && !!copy && state.toastPending && !state.starred;
  const body = visible && copy ? copy.toast[state!.milestoneKind ?? 'week'] : '';

  return (
    <AnimatePresence>
      {visible && copy && (
        <motion.aside
          role='status'
          aria-live='polite'
          data-testid='star-nudge-toast'
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={smooth}
          className='glass-modal fixed bottom-6 right-6 z-50 w-[22rem] max-w-[calc(100vw-3rem)] p-4'
        >
          <div className='relative flex items-start gap-3'>
            <span aria-hidden='true' className='mt-0.5 text-lg leading-none text-amber-400'>★</span>
            <div className='flex-1 min-w-0'>
              <p className='text-sm text-body leading-relaxed'>{body}</p>
              <div className='mt-3 flex items-center gap-2'>
                <Button size='sm' onClick={star}>{copy.star}</Button>
                <Button size='sm' variant='ghost' onClick={dismissToast}>{copy.later}</Button>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

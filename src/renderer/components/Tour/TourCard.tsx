import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentState } from '../../../common/types';
import { ClawdMascot } from '../Bubble/ClawdMascot';

// ── First-run tour coach card ────────────────────────────────────────────────
// Rendered in its own transparent always-on-top window beside the demo bubble
// (see TourManager). Each step narrates one idea and drives the demo bubble's
// pose via `tour:demo-state`, so the user watches the real artifact do the
// thing being described. Four steps, one idea each, skippable throughout —
// per the HIG, short or not at all.

interface TourStep {
  kicker: string;
  title: string;
  body: string;
  demoState: AgentState;
  // Flip the demo bubble to escalated (bell + urgent bob) this long after the
  // step opens — lets the "waiting" step play its quiet beat first, then the
  // escalation beat, mirroring the real timeline.
  escalateAfterMs?: number;
}

const STEPS: TourStep[] = [
  {
    kicker: 'Welcome to Agent Pulse',
    title: 'Meet your status bubble',
    body: 'It floats above everything you do. Right now Claude Code is working — Clawd hits the gym so you can look away.',
    demoState: 'working',
  },
  {
    kicker: 'Step 2 of 4',
    title: 'It taps you when it’s your turn',
    body: 'A soft chime and Clawd’s flag mean Claude is waiting on your input. Leave it too long and the bell starts ringing.',
    demoState: 'waiting',
    escalateAfterMs: 2200,
  },
  {
    kicker: 'Step 3 of 4',
    title: 'Your quota, at a glance',
    body: 'The bars underneath show credit remaining — green means plenty. Hover the bubble for details; drag it anywhere; click it to jump to the tool.',
    demoState: 'idle-active',
  },
  {
    kicker: 'Step 4 of 4',
    title: 'Now wake him up',
    body: 'Clawd sleeps until his first real event. Connect your tools and the bubbles come alive.',
    demoState: 'idle',
  },
];

const CARD_WIDTH = 296;
// Breathing room around the card inside the transparent window so the drop
// shadow isn't clipped at the window edge. Included in the measured size.
const SHADOW_PAD = 14;

export const TourCard: React.FC = () => {
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  // Drive the demo bubble's pose for this step (+ the delayed escalation beat).
  useEffect(() => {
    window.electron.send('tour:demo-state', { state: step.demoState, escalated: false });
    if (!step.escalateAfterMs) return;
    const t = window.setTimeout(() => {
      window.electron.send('tour:demo-state', { state: step.demoState, escalated: true });
    }, step.escalateAfterMs);
    return () => window.clearTimeout(t);
  }, [step]);

  // The window is sized by the main process from our measured footprint —
  // re-measure on every step since body copy length varies. rAF waits for the
  // exiting step to unmount (AnimatePresence mode="wait") before measuring.
  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (rect) {
        window.electron.send('tour:card-measured', {
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [index]);

  const finish = (completed: boolean) => {
    window.electron.send('tour:finish', { completed });
  };
  const next = () => {
    if (isLast) finish(true);
    else setIndex((i) => i + 1);
  };

  // Enter/→ advance, Esc skips — the card window has focus while the tour runs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') finish(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  return (
    <div ref={rootRef} className='inline-block font-sans' style={{ padding: SHADOW_PAD }}>
      <motion.div
        initial={{ opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className='rounded-2xl overflow-hidden'
        style={{
          width: CARD_WIDTH,
          background: 'rgba(17,17,24,0.88)',
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
        }}
      >
        <div className='p-5'>
          {/* Narrator + step copy, cross-faded per step */}
          <AnimatePresence mode='wait'>
            <motion.div
              key={index}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -14 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              <div className='flex items-start gap-3'>
                <div className='shrink-0 -mt-1'>
                  <ClawdMascot state={step.demoState} width={44} />
                </div>
                <div className='min-w-0'>
                  <p className='text-[10px] font-semibold uppercase tracking-widest text-slate-500'>
                    {step.kicker}
                  </p>
                  <h2 className='text-[15px] font-bold text-white leading-snug mt-0.5'>
                    {step.title}
                  </h2>
                </div>
              </div>
              <p className='text-[13px] text-slate-300 leading-relaxed mt-3'>
                {step.body}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Progress dots */}
          <div className='flex items-center gap-1.5 mt-4'>
            {STEPS.map((_, i) => (
              <motion.span
                key={i}
                animate={{
                  width: i === index ? 16 : 6,
                  backgroundColor: i === index ? 'rgba(96,165,250,0.95)' : 'rgba(148,163,184,0.35)',
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className='h-1.5 rounded-full'
              />
            ))}
          </div>

          {/* Actions */}
          <div className='flex items-center justify-between mt-4'>
            {isLast ? (
              <span />
            ) : (
              <button
                onClick={() => finish(false)}
                className='text-xs text-slate-500 hover:text-slate-300 transition-colors cursor-pointer'
              >
                Skip tour
              </button>
            )}
            <button
              onClick={next}
              className='px-4 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer'
            >
              {isLast ? 'Set up my tools' : 'Next'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

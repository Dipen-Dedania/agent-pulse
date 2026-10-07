import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AgentState, ToolId } from '../../../common/types';
import type { TabId } from '../Settings/SettingsPanel';
import { ClawdMascot } from '../Bubble/ClawdMascot';
import { Button } from '../Shared';

// ── Backlog planner guided tour ──────────────────────────────────────────────
// An in-panel spotlight/coachmark walk anchored to the REAL Backlog-tab DOM,
// hoisted to SettingsPanel level so it survives the tab-swap unmount
// (SettingsPanel keys <AnimatePresence> on activeTab). It drives both
// setActiveTab and setUsageSubTab live, so the walk can step out to
// Usage → Claude Code for issue population and back to the board, awaiting
// each anchor (tab exit-animation + async config load) before positioning.
// The scheduler step spotlights the board's ⚙ button rather than opening the
// modal under the scrim. When an anchor never mounts (e.g. Claude Code usage
// isn't configured, so the section never renders) the step degrades to a
// centered, unanchored callout rather than hanging. Reuses the Tooltip positioning approach: fixed position,
// getBoundingClientRect, viewport clamping, placement flip, reposition on
// scroll/resize. All motion is Framer, so it inherits the app's global
// <MotionConfig reducedMotion="user">.

type Placement = 'top' | 'bottom' | 'left' | 'right' | 'center';

interface TourStep {
  key: string;
  kicker: string;
  title: string;
  body: string;
  tab: TabId;
  subTab?: ToolId;      // required sub-tab within the Usage tab
  selector?: string;    // data-tour value; omitted → centered callout
  placement?: Placement;
  demoState?: AgentState;
  degradeBody?: string; // shown centered if the anchor never mounts
}

// The full walk (≥1 project). With zero projects it's truncated to the first
// three steps (see STEP_COUNT_EMPTY) and hands off to the board's empty state —
// there are no cards or columns to spotlight yet.
const STEPS: TourStep[] = [
  {
    key: 'glance',
    kicker: 'Backlog planner',
    title: 'Your board at a glance',
    body: 'This line is the pulse of the autorun engine — the open window, what’s running now, and how many cards are queued and ready.',
    tab: 'backlog',
    selector: 'backlog-glance',
    placement: 'bottom',
    demoState: 'working',
  },
  {
    key: 'add-project',
    kicker: 'Step 2',
    title: 'Cards live in a project',
    body: 'Every card belongs to a repo folder — that’s where the agent runs. Add a project to open a board for it.',
    tab: 'backlog',
    selector: 'backlog-add-project',
    placement: 'bottom',
    demoState: 'idle-active',
  },
  {
    key: 'new-card',
    kicker: 'Step 3',
    title: 'Fill the board',
    body: 'Write a card by hand, or pull open issues straight from GitLab or Linear — imported issues land in Refinement, ready to shape.',
    tab: 'backlog',
    selector: 'backlog-new-card',
    placement: 'bottom',
    demoState: 'idle-active',
  },
  {
    key: 'columns',
    kicker: 'Step 4',
    title: 'How work flows',
    body: 'Refinement → Todo → In Progress → Done. Drag cards to plan — but In Progress is engine-only, it fills itself when a run starts. Todo is the autorun queue.',
    tab: 'backlog',
    selector: 'backlog-col-todo',
    placement: 'bottom',
    demoState: 'working',
  },
  {
    key: 'card-actions',
    kicker: 'Step 5',
    title: 'Run it now, or refine it first',
    body: '▶ Run hands a card to the agent right away. ✨ Refine opens a plan-mode chat to sharpen a rough idea before it runs. Green-tier cards can also autorun unattended.',
    tab: 'backlog',
    selector: 'backlog-first-card',
    placement: 'right',
    demoState: 'idle-active',
  },
  {
    key: 'scheduler',
    kicker: 'Step 6',
    title: 'Use the night session',
    body: 'This ⚙ opens the scheduler: set the windows when queued green cards run themselves (on Claude Code or Codex, per card) — the Nights 23–07 preset is one click. Idle-gated so it won’t fight a late session, budget-capped per card. Wake up to the work done.',
    tab: 'backlog',
    selector: 'backlog-scheduler',
    placement: 'bottom',
    demoState: 'working',
    degradeBody: 'The night session lives behind the ⚙ button in the board header. Open it and set your windows to arm overnight autorun.',
  },
  {
    key: 'population',
    kicker: 'Step 7',
    title: 'Keep the board fed',
    body: 'Point the board at GitLab or Linear and it self-populates from your open issues — no token to manage, it rides your org connectors.',
    tab: 'usage',
    subTab: 'claude-code',
    selector: 'backlog-population',
    placement: 'top',
    demoState: 'idle-active',
    degradeBody: 'Issue population lives under Usage → Claude Code → Issue population.',
  },
  {
    key: 'end',
    kicker: 'That’s the tour',
    title: 'Queue it. Walk away.',
    body: 'Shape cards, drop the safe ones into Todo, and let the night session turn idle time into finished research. Replay this tour any time from the board.',
    tab: 'backlog',
    placement: 'center',
    demoState: 'idle',
  },
];

// Zero-project walk stops after step 3 (glance / add project / fill the board)
// and hands off to the enriched empty state — nothing else exists to spotlight.
const STEP_COUNT_EMPTY = 3;

const CARD_WIDTH = 320;
const MARGIN = 12;   // callout gap from the anchor + viewport edges
const SPOT_PAD = 8;  // spotlight halo padding around the anchor rect
const ANCHOR_TIMEOUT_MS = 1600; // give tab exit-anim + async config load time to mount

interface Point { left: number; top: number; }

/** Place the callout beside the anchor rect, flipping + clamping to the viewport. */
function computePos(rect: DOMRect, placement: Placement, cw: number, ch: number): Point {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampL = (l: number) => Math.max(MARGIN, Math.min(l, vw - cw - MARGIN));
  const clampT = (t: number) => Math.max(MARGIN, Math.min(t, vh - ch - MARGIN));
  const cx = rect.left + rect.width / 2 - cw / 2;
  const cy = rect.top + rect.height / 2 - ch / 2;

  let p = placement;
  if (p === 'bottom' && rect.bottom + MARGIN + ch > vh) p = 'top';
  else if (p === 'top' && rect.top - MARGIN - ch < 0) p = 'bottom';
  else if (p === 'right' && rect.right + MARGIN + cw > vw) p = 'left';
  else if (p === 'left' && rect.left - MARGIN - cw < 0) p = 'right';

  switch (p) {
    case 'top': return { left: clampL(cx), top: clampT(rect.top - ch - MARGIN) };
    case 'bottom': return { left: clampL(cx), top: clampT(rect.bottom + MARGIN) };
    case 'left': return { left: clampL(rect.left - cw - MARGIN), top: clampT(cy) };
    case 'right': return { left: clampL(rect.right + MARGIN), top: clampT(cy) };
    default: return { left: (vw - cw) / 2, top: (vh - ch) / 2 };
  }
}

interface BacklogTourProps {
  active: boolean;
  projectCount: number;
  activeTab: TabId;
  usageSubTab: ToolId;
  setActiveTab: (tab: TabId) => void;
  setUsageSubTab: (tool: ToolId) => void;
  /** Called on finish (completed=true) or skip/Esc (completed=false). */
  onFinish: (completed: boolean) => void;
}

export const BacklogTour: React.FC<BacklogTourProps> = ({
  active,
  projectCount,
  activeTab,
  usageSubTab,
  setActiveTab,
  setUsageSubTab,
  onFinish,
}) => {
  const steps = projectCount === 0 ? STEPS.slice(0, STEP_COUNT_EMPTY) : STEPS;
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<Point | null>(null);
  const [degraded, setDegraded] = useState(false); // anchor never mounted → centered
  const [ready, setReady] = useState(false);       // anchor resolved (or degraded)
  const calloutRef = useRef<HTMLDivElement>(null);

  const step = steps[Math.min(index, steps.length - 1)];
  const isLast = index >= steps.length - 1;
  const centered = degraded || !step.selector || step.placement === 'center';

  // Fresh start whenever the tour opens.
  useEffect(() => {
    if (active) setIndex(0);
  }, [active]);

  // Resolve the current step: drive the tab/sub-tab, then poll for the anchor
  // until it mounts or the timeout fires (→ degrade to a centered callout).
  useEffect(() => {
    if (!active) return;
    const s = steps[Math.min(index, steps.length - 1)];
    setReady(false);
    setDegraded(false);
    setRect(null);
    setPos(null);

    if (activeTab !== s.tab) setActiveTab(s.tab);
    if (s.subTab && usageSubTab !== s.subTab) setUsageSubTab(s.subTab);

    if (!s.selector) { setReady(true); return; } // centered step, no anchor

    let raf = 0;
    const start = performance.now();
    const tick = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${s.selector}"]`);
      if (el) {
        // Instant (not smooth) so the rect we measure next frame is final.
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
        raf = requestAnimationFrame(() => {
          setRect(el.getBoundingClientRect());
          setReady(true);
        });
        return;
      }
      if (performance.now() - start > ANCHOR_TIMEOUT_MS) {
        setDegraded(true);
        setReady(true);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // activeTab/usageSubTab intentionally excluded: this drives them, and
    // re-running on their change would restart the poll mid-transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, index]);

  // Keep the spotlight glued to the anchor while scrolling/resizing.
  useEffect(() => {
    if (!active || centered) return;
    const sel = step.selector;
    if (!sel) return;
    const onMove = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${sel}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [active, centered, step.selector]);

  // Position the callout once it (and the anchor rect) are measurable.
  useLayoutEffect(() => {
    if (!ready) return;
    const el = calloutRef.current;
    if (!el) return;
    const cw = el.offsetWidth;
    const ch = el.offsetHeight;
    if (centered || !rect) {
      setPos({ left: (window.innerWidth - cw) / 2, top: (window.innerHeight - ch) / 2 });
    } else {
      setPos(computePos(rect, step.placement ?? 'bottom', cw, ch));
    }
  }, [ready, rect, centered, index, step.placement]);

  const finish = useCallback((completed: boolean) => onFinish(completed), [onFinish]);
  const next = useCallback(() => {
    if (isLast) finish(true);
    else setIndex((i) => i + 1);
  }, [isLast, finish]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Enter/→ advance, ←/Backspace back, Esc skips.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, next, back, finish]);

  if (!active) return null;

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 150 }} className='font-sans'>
      {/* Click-catcher: blocks the app underneath so the walk owns the screen. */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }} />

      {/* Scrim: a spotlight halo when anchored, a full dim otherwise. */}
      {!centered && rect ? (
        <motion.div
          key={step.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            left: rect.left - SPOT_PAD,
            top: rect.top - SPOT_PAD,
            width: rect.width + SPOT_PAD * 2,
            height: rect.height + SPOT_PAD * 2,
            borderRadius: 14,
            boxShadow: '0 0 0 9999px var(--ap-scrim-strong)',
            border: '1.5px solid rgba(96,165,250,0.9)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      ) : (
        <div
          className='glass-scrim'
          style={{ background: 'var(--ap-scrim-strong)', zIndex: 1 }}
        />
      )}

      {/* Coach callout — hidden until positioned to avoid a first-paint jump. */}
      {ready && (
        <motion.div
          ref={calloutRef}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          style={{
            position: 'fixed',
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            width: CARD_WIDTH,
            maxWidth: 'calc(100vw - 24px)',
            visibility: pos ? 'visible' : 'hidden',
            zIndex: 2,
          }}
          className='glass-modal rounded-2xl p-5'
        >
          <AnimatePresence mode='wait'>
            <motion.div
              key={step.key}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.16, ease: 'easeOut' }}
            >
              <div className='flex items-start gap-3'>
                <div className='shrink-0 -mt-1'>
                  <ClawdMascot state={step.demoState ?? 'idle-active'} width={44} />
                </div>
                <div className='min-w-0'>
                  <p className='text-[10px] font-semibold uppercase tracking-widest text-faint'>
                    {step.kicker}
                  </p>
                  <h2 className='text-[15px] font-bold text-strong leading-snug mt-0.5'>
                    {step.title}
                  </h2>
                </div>
              </div>
              <p className='text-[13px] text-body leading-relaxed mt-3'>
                {degraded && step.degradeBody ? step.degradeBody : step.body}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Progress dots */}
          <div className='flex items-center gap-1.5 mt-4'>
            {steps.map((s, i) => (
              <motion.span
                key={s.key}
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
          <div className='flex items-center justify-between mt-4 gap-3'>
            <button
              onClick={() => finish(false)}
              className='text-xs text-faint hover:text-body transition-colors cursor-pointer'
            >
              Skip
            </button>
            <div className='flex items-center gap-2'>
              {index > 0 && (
                <Button variant='ghost' size='sm' onClick={back}>
                  Back
                </Button>
              )}
              <Button variant='primary' size='sm' onClick={next}>
                {isLast ? 'Done' : 'Next'}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </div>,
    document.body,
  );
};

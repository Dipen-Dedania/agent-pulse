import React, { useCallback, useEffect, useState } from 'react';
import { Bubble } from './components/Bubble/Bubble';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { TooltipOverlay, Tooltip, AnimatedLogo } from './components/Shared';
import { TourCard } from './components/Tour/TourCard';
import { ScreenEdgeOverlay } from './components/ScreenEdge/ScreenEdgeOverlay';
import { WindowChrome } from './components/Chrome/WindowChrome';
import { BootGate } from './BootGate';
import { bootMark, signalFirstPaint } from './boot-marks';
import { ToolId, TourState } from '../common/types';
import { AnimatePresence, motion, MotionConfig, Transition, Variants } from 'framer-motion';
import { gentle, listContainer, listItem, tabContent, tabContentTransition } from './motion';

// The hero's feature-card stagger reuses `listContainer`'s cadence but waits
// for the hero text above to settle first — a local spread, not a new token.
const heroFeatureGrid: Variants = {
  initial: listContainer.initial,
  animate: {
    transition: {
      ...(listContainer.animate as { transition: Transition }).transition,
      delayChildren: 0.3,
    },
  },
};

type Feature = {
  title: string;
  description: string;
  icon: React.ReactNode;
};

const iconClass = 'w-5 h-5';

const FEATURES: Feature[] = [
  {
    title: 'Status Bubbles',
    description:
      'Always-on-top, draggable indicators for every agent on your desktop.',
    icon: (
      <svg
        className={iconClass}
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <circle cx='8' cy='9' r='4' />
        <circle cx='16' cy='15' r='3' />
      </svg>
    ),
  },
  {
    title: 'Unified Bridge',
    description:
      'Normalizes lifecycle events from Claude, Cursor, Copilot, Codex, Kiro & Antigravity.',
    icon: (
      <svg
        className={iconClass}
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <path d='M4 12c4-6 12-6 16 0' />
        <circle cx='4' cy='12' r='1.5' />
        <circle cx='20' cy='12' r='1.5' />
        <circle cx='12' cy='6' r='1.5' />
      </svg>
    ),
  },
  {
    title: 'Usage Meters',
    description:
      'Live Claude, Codex & Antigravity quota tracking with cap & nudge alerts.',
    icon: (
      <svg
        className={iconClass}
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <path d='M3 17a9 9 0 0 1 18 0' />
        <path d='M12 17l4-5' />
        <circle cx='12' cy='17' r='1' />
      </svg>
    ),
  },
  {
    title: 'Command Guardrails',
    description:
      'Block risky shell commands before they reach an agent — core + custom rules.',
    icon: (
      <svg
        className={iconClass}
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <path d='M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z' />
        <path d='M9 12l2 2 4-4' />
      </svg>
    ),
  },
  {
    title: 'Pulse Timeline',
    description:
      'Local heatmap, hour-of-day rhythm, tool mix & project breakdown — fully private.',
    icon: (
      <svg
        className={iconClass}
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <path d='M3 12h4l2-6 4 12 2-6h6' />
      </svg>
    ),
  },
  {
    title: 'Auto-Updates',
    description:
      'Background delivery via Firebase Storage — always on the latest signed build.',
    icon: (
      <svg
        className={iconClass}
        viewBox='0 0 24 24'
        fill='none'
        stroke='currentColor'
        strokeWidth='1.8'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <path d='M21 12a9 9 0 1 1-3-6.7' />
        <path d='M21 4v5h-5' />
      </svg>
    ),
  },
];

const FeatureCard: React.FC<{ feature: Feature }> = ({ feature }) => (
  <motion.div
    variants={listItem}
    className='text-left glass-secondary p-3 transition-colors'
  >
    <div className='flex items-center gap-2 mb-1'>
      <div className='w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-edge flex items-center justify-center text-info shrink-0'>
        {feature.icon}
      </div>
      <h3 className='text-[13px] font-semibold text-strong leading-tight'>
        {feature.title}
      </h3>
    </div>
    <p className='text-[11px] text-muted leading-snug'>
      {feature.description}
    </p>
  </motion.div>
);

// The splash/landing hero shown when the Settings window loads its bare URL.
// Doubles as the welcome sheet: on first run the tour is the primary CTA, and
// it stays re-runnable from here forever (Raycast's "Show Onboarding" pattern).
const Landing: React.FC<{ onConfigure: () => void }> = ({ onConfigure }) => {
  const [tourState, setTourState] = useState<TourState | null>(null);

  useEffect(() => { bootMark('landing-mounted'); }, []);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('tour:get-state')
      .then((s: TourState) => {
        if (!cancelled) setTourState(s);
      })
      .catch(() => {
        /* tour unavailable — render the plain splash */
      });
    const handler = (_e: unknown, s: TourState) => setTourState(s);
    window.electron.on('tour:state-updated', handler);
    return () => {
      cancelled = true;
      window.electron.off('tour:state-updated', handler);
    };
  }, []);

  // Tour ended while we're on the splash — hand off to Settings (Hooks tab),
  // where the setup checklist continues the story.
  useEffect(() => {
    const handler = () => onConfigure();
    window.electron.on('tour:completed', handler);
    return () => window.electron.off('tour:completed', handler);
  }, [onConfigure]);

  const startTour = () => window.electron.send('tour:start');
  // Until the state loads, assume returning user so the CTA never flashes
  // from "Configure Tools" to the tour variant on a seasoned install.
  const firstRun = tourState ? !tourState.hasSeenTour : false;

  const primaryClass =
    'px-8 py-4 bg-strong text-base font-bold rounded-full hover:opacity-90 transition-all hover:scale-105 active:scale-95 shadow-xl shadow-black/10 cursor-pointer';
  const secondaryClass =
    'px-6 py-3 rounded-full text-sm font-semibold text-body border border-edge hover:border-edge-strong hover:text-strong transition-all hover:scale-105 active:scale-95 cursor-pointer';

  // The liquid wallpaper the glass feature cards blur against comes from the
  // enclosing WindowChrome (see .settings-liquid-bg in index.css).
  return (
    <div className='h-full w-full text-body flex items-center justify-center font-sans overflow-hidden relative py-5'>
      {/* Accent glows for "Enterprise" feel, now layered over the mesh. Toned
          down in light mode so they tint the pastel base instead of muddying it. */}
      <div className='absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 light:bg-blue-500/10 blur-[120px] rounded-full pointer-events-none' />
      <div className='absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 light:bg-purple-500/10 blur-[120px] rounded-full pointer-events-none' />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={gentle}
        className='z-10 text-center max-w-2xl w-full px-6'
      >
        <AnimatedLogo
          variant='alive'
          className='w-24 h-24 sm:w-20 sm:h-20 mx-auto mb-4 drop-shadow-[0_8px_32px_rgba(59,130,246,0.35)]'
        />
        <h1 className='text-6xl font-extrabold tracking-tight pb-5 bg-clip-text text-transparent bg-gradient-to-b from-strong to-muted'>
          Agent Pulse
        </h1>
        <p className='text-lg text-muted leading-relaxed'>
          Ambient, glanceable awareness for your AI coding team.
          <br />
          <span className='text-sm opacity-60'>
            Stop tab-switching. Start observing.
          </span>
        </p>
        <p className='text-faint text-sm flex items-center gap-2 mb-8 justify-center'>
          <span className='w-2 h-2 bg-green-500 rounded-full animate-pulse' />
          Status Bridge Active
        </p>

        <motion.div
          className='grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-10'
          variants={heroFeatureGrid}
          initial='initial'
          animate='animate'
        >
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </motion.div>

        <div className='flex flex-col sm:flex-row gap-4 justify-center items-center'>
          {firstRun ? (
            <>
              <button onClick={startTour} className={primaryClass}>
                Show me how it works
              </button>
              <button onClick={onConfigure} className={secondaryClass}>
                Configure Tools
              </button>
            </>
          ) : (
            <>
              <button onClick={onConfigure} className={primaryClass}>
                Configure Tools
              </button>
              <Tooltip content='Replay the welcome tour'>
                <button
                  onClick={startTour}
                  className={secondaryClass}
                >
                  <span className='flex items-center gap-2'>
                    <svg
                      viewBox='0 0 24 24'
                      className='w-3.5 h-3.5'
                      fill='currentColor'
                    >
                      <path d='M8 5v14l11-7z' />
                    </svg>
                    Welcome tour
                  </span>
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

// The two views the framed (Settings) window switches between in place.
type FramedView = 'landing' | 'settings';

const App: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const toolId = (params.get('toolId') as ToolId) || null;
  const view = params.get('view');

  // Landing ↔ Settings is an in-page switch, not a navigation: a reload would
  // re-parse the whole bundle and replay the splash. The URL is still kept
  // truthful so a manual reload (and the existing `?view=settings` deep link)
  // land on the same view.
  const [framedView, setFramedView] = useState<FramedView>(view === 'settings' ? 'settings' : 'landing');
  const navigate = useCallback((next: FramedView) => {
    setFramedView(next);
    try {
      window.history.replaceState(null, '', next === 'settings' ? '?view=settings' : window.location.pathname);
    } catch {
      // file:// documents may refuse history changes; only the reload target suffers.
    }
  }, []);

  // Framed window only: the settings window is created hidden behind the
  // floating logo splash. Two frames after the first commit the pixels are
  // really there, so tell main to show the window and close the splash.
  const isOverlay = view === 'tooltip' || view === 'tour' || view === 'screen-edge';
  useEffect(() => {
    if (toolId || isOverlay) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => signalFirstPaint());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bubbles render outside MotionConfig — their animation is hand-tuned for the
  // always-on-top transparent window and must stay as-is for performance.
  if (toolId) {
    return <Bubble toolId={toolId} demo={params.get('demo') === '1'} />;
  }

  // Tooltip / tour / screen-edge are transparent overlay windows with no frame.
  const overlay = !isOverlay ? null
    : view === 'tooltip' ? <TooltipOverlay />
    : view === 'tour' ? <TourCard />
    : <ScreenEdgeOverlay />;

  // Every non-bubble view honors the OS "reduce motion" setting: transforms and
  // layout animations collapse to instant, cross-fades stay.
  if (overlay) {
    return <MotionConfig reducedMotion='user'>{overlay}</MotionConfig>;
  }

  // Only the Settings window has a real frame. WindowChrome (title bar +
  // wallpaper) stays mounted across the view switch; the content cross-fades.
  // The Settings panel waits behind BootGate until the main process reports
  // that every IPC handler it calls at mount is registered.
  return (
    <MotionConfig reducedMotion='user'>
      <WindowChrome>
        <AnimatePresence mode='wait' initial={false}>
          <motion.div
            key={framedView}
            className='h-full'
            variants={tabContent}
            initial='initial'
            animate='animate'
            exit='exit'
            transition={tabContentTransition}
          >
            {framedView === 'settings' ? (
              <BootGate>
                <SettingsPanel onBack={() => navigate('landing')} />
              </BootGate>
            ) : (
              <Landing onConfigure={() => navigate('settings')} />
            )}
          </motion.div>
        </AnimatePresence>
      </WindowChrome>
    </MotionConfig>
  );
};

export default App;

import React, { useEffect, useState } from 'react';
import { Bubble } from './components/Bubble/Bubble';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { TooltipOverlay } from './components/Tooltip/TooltipOverlay';
import { TourCard } from './components/Tour/TourCard';
import { ToolId, TourState } from '../common/types';
import { motion } from 'framer-motion';

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

const FeatureCard: React.FC<{ feature: Feature; index: number }> = ({
  feature,
  index,
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.5, delay: 0.3 + index * 0.06, ease: 'easeOut' }}
    className='text-left bg-white/[0.03] border border-white/10 rounded-xl p-3 backdrop-blur-md hover:bg-white/[0.06] hover:border-white/20 transition-colors'
  >
    <div className='flex items-center gap-2 mb-1'>
      <div className='w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center text-blue-200 shrink-0'>
        {feature.icon}
      </div>
      <h3 className='text-[13px] font-semibold text-white leading-tight'>
        {feature.title}
      </h3>
    </div>
    <p className='text-[11px] text-slate-400 leading-snug'>
      {feature.description}
    </p>
  </motion.div>
);

// The splash/landing hero shown when the Settings window loads its bare URL.
// Doubles as the welcome sheet: on first run the tour is the primary CTA, and
// it stays re-runnable from here forever (Raycast's "Show Onboarding" pattern).
const Landing: React.FC = () => {
  const [tourState, setTourState] = useState<TourState | null>(null);

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
    const handler = () => {
      window.location.href = '?view=settings';
    };
    window.electron.on('tour:completed', handler);
    return () => window.electron.off('tour:completed', handler);
  }, []);

  const startTour = () => window.electron.send('tour:start');
  // Until the state loads, assume returning user so the CTA never flashes
  // from "Configure Tools" to the tour variant on a seasoned install.
  const firstRun = tourState ? !tourState.hasSeenTour : false;

  const primaryClass =
    'px-8 py-4 bg-white text-slate-900 font-bold rounded-full hover:bg-blue-50 transition-all hover:scale-105 active:scale-95 shadow-xl shadow-white/10 cursor-pointer';
  const secondaryClass =
    'px-6 py-3 rounded-full text-sm font-semibold text-slate-300 border border-slate-600/60 hover:border-slate-400 hover:text-white transition-all hover:scale-105 active:scale-95 cursor-pointer';

  return (
    <div className='h-screen w-screen bg-slate-900 text-white flex items-center justify-center font-sans overflow-hidden relative py-5'>
      {/* Background glow effects for "Enterprise" feel */}
      <div className='absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none' />
      <div className='absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full pointer-events-none' />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className='z-10 text-center max-w-2xl w-full px-6'
      >
        <img
          src='./assets/logo-transparent.png'
          alt='Agent Pulse'
          className='w-24 h-24 sm:w-20 sm:h-20 mx-auto mb-4 object-contain drop-shadow-[0_8px_32px_rgba(59,130,246,0.35)]'
        />
        <h1 className='text-6xl font-extrabold tracking-tight pb-5 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-400'>
          Agent Pulse
        </h1>
        <p className='text-lg text-slate-400 leading-relaxed'>
          Ambient, glanceable awareness for your AI coding team.
          <br />
          <span className='text-sm opacity-60'>
            Stop tab-switching. Start observing.
          </span>
        </p>
        <p className='text-slate-500 text-sm flex items-center gap-2 mb-8 justify-center'>
          <span className='w-2 h-2 bg-green-500 rounded-full animate-pulse' />
          Status Bridge Active
        </p>

        <div className='grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-10'>
          {FEATURES.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>

        <div className='flex flex-col sm:flex-row gap-4 justify-center items-center'>
          {firstRun ? (
            <>
              <button onClick={startTour} className={primaryClass}>
                Show me how it works
              </button>
              <a href='?view=settings' className={secondaryClass}>
                Configure Tools
              </a>
            </>
          ) : (
            <>
              <a href='?view=settings' className={primaryClass}>
                Configure Tools
              </a>
              <button
                onClick={startTour}
                className={secondaryClass}
                title='Replay the welcome tour'
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
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const App: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const toolId = (params.get('toolId') as ToolId) || null;
  const view = params.get('view');

  if (view === 'settings') {
    return <SettingsPanel />;
  }

  if (view === 'tooltip') {
    return <TooltipOverlay />;
  }

  if (view === 'tour') {
    return <TourCard />;
  }

  if (toolId) {
    return <Bubble toolId={toolId} demo={params.get('demo') === '1'} />;
  }

  return <Landing />;
};

export default App;

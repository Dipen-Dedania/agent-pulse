import React from 'react';
import { Bubble } from './components/Bubble/Bubble';
import { SettingsPanel } from './components/Settings/SettingsPanel';
import { ToolId } from '../common/types';
import { motion } from 'framer-motion';

const App: React.FC = () => {
  const params = new URLSearchParams(window.location.search);
  const toolId = (params.get('toolId') as ToolId) || null;
  const view = params.get('view');

  if (view === 'settings') {
    return <SettingsPanel />;
  }

  if (toolId) {
    return <Bubble toolId={toolId} />;
  }

  return (
    <div className='h-screen w-screen bg-slate-900 text-white flex items-center justify-center font-sans overflow-hidden relative'>
      {/* Background glow effects for "Enterprise" feel */}
      <div className='absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full' />
      <div className='absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full' />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className='z-10 text-center max-w-2xl px-6'
      >
        <img
          src='./assets/logo-transparent.png'
          alt='Agent Pulse'
          className='w-24 h-24 sm:w-20 sm:h-20 mx-auto mb-4 object-contain drop-shadow-[0_8px_32px_rgba(59,130,246,0.35)]'
        />
        <h1 className='text-6xl font-extrabold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-400'>
          Agent Pulse
        </h1>
        <p className='text-xl text-slate-400 mb-10 leading-relaxed'>
          Ambient, glanceable awareness for your AI coding team.
          <br />
          <span className='text-sm opacity-60'>
            Stop tab-switching. Start observing.
          </span>
        </p>

        <div className='flex flex-col sm:flex-row gap-4 justify-center items-center'>
          <a
            href='?view=settings'
            className='px-8 py-4 bg-white text-slate-900 font-bold rounded-full hover:bg-blue-50 transition-all hover:scale-105 active:scale-95 shadow-xl shadow-white/10'
          >
            Configure Tools
          </a>
          <div className='text-slate-500 text-sm flex items-center gap-2'>
            <div className='w-2 h-2 bg-green-500 rounded-full animate-pulse' />
            Status Bridge Active
          </div>
        </div>
      </motion.div>

      {/* Subtle footer */}
      <div className='absolute bottom-8 left-0 right-0 text-center text-slate-600 text-xs uppercase tracking-widest'>
        Enterprise Grade Ambient Awareness
      </div>
    </div>
  );
};

export default App;

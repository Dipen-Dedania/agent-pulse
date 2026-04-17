import React from 'react';

interface StateCardProps {
  label: string;
  labelClass: string;
  description: string;
  children: React.ReactNode;
}

const StateCard: React.FC<StateCardProps> = ({
  label,
  labelClass,
  description,
  children,
}) => (
  <div className='bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-4 flex flex-col gap-3 shadow-xl'>
    <div className='flex items-center gap-3'>
      <div className='relative w-9 h-9 shrink-0 flex items-center justify-center'>
        {children}
      </div>
      <p className={`font-semibold text-sm ${labelClass}`}>{label}</p>
    </div>
    <p className='text-xs text-slate-400 leading-relaxed'>{description}</p>
  </div>
);

export const StatesReference: React.FC = () => (
  <div className='mt-10'>
    <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4'>
      Agent States
    </p>
    <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
      <StateCard
        label='Idle'
        labelClass='text-white'
        description='No agent activity. Slowly breathes at low opacity.'
      >
        <div
          className='w-9 h-9 rounded-full'
          style={{
            background:
              'radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(128,128,128,0.06) 100%)',
            border: '1.5px solid rgba(255,255,255,0.18)',
          }}
        />
      </StateCard>

      <StateCard
        label='Waiting'
        labelClass='text-amber-300'
        description='Waiting for user input. Agent needs permission or a response to continue.'
      >
        <div
          className='w-9 h-9 rounded-full'
          style={{
            background:
              'radial-gradient(circle, rgba(245,158,11,0.45) 0%, rgba(128,128,128,0.06) 100%)',
            border: '1.5px solid rgba(255,255,255,0.18)',
            boxShadow: '0 0 10px 2px rgba(245,158,11,0.3)',
          }}
        />
        <div
          className='absolute w-[42px] h-[42px] rounded-full'
          style={{ border: '1.5px dotted rgba(245,158,11,0.5)' }}
        />
      </StateCard>

      <StateCard
        label='Working'
        labelClass='text-blue-300'
        description='Actively using tools, reading files, running commands, writing code etc.'
      >
        <div
          className='w-9 h-9 rounded-full'
          style={{
            background:
              'radial-gradient(circle, rgba(59,130,246,0.5) 0%, rgba(128,128,128,0.06) 100%)',
            border: '1.5px solid rgba(255,255,255,0.18)',
            boxShadow: '0 0 14px 4px rgba(59,130,246,0.4)',
          }}
        />
        <div
          className='absolute w-[42px] h-[42px] rounded-full'
          style={{ border: '1.5px dashed rgba(59,130,246,0.5)' }}
        />
      </StateCard>

      <StateCard
        label='Error'
        labelClass='text-red-400'
        description='Agent stopped unexpectedly or a tool call failed.'
      >
        <div
          className='w-9 h-9 rounded-full'
          style={{
            background:
              'radial-gradient(circle, rgba(239,68,68,0.5) 0%, rgba(128,128,128,0.06) 100%)',
            border: '1.5px solid rgba(255,255,255,0.18)',
            boxShadow: '0 0 10px 2px rgba(239,68,68,0.35)',
          }}
        />
        <div
          className='absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500'
          style={{ boxShadow: '0 0 5px rgba(239,68,68,0.7)' }}
        />
      </StateCard>
    </div>
  </div>
);

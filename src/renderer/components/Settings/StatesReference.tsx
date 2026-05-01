import React from 'react';
import { AgentState } from '../../../common/types';
import { STATE_COLORS } from '../../../common/stateColors';

type RingStyle = 'dotted' | 'dashed' | null;

interface CardConfig {
  state: AgentState;
  label: string;
  description: string;
  ringStyle: RingStyle;
  hasErrorDot: boolean;
}

const CARDS: CardConfig[] = [
  {
    state: 'idle',
    label: 'Idle',
    description: 'No agent activity yet. Slowly breathes at low opacity.',
    ringStyle: null,
    hasErrorDot: false,
  },
  {
    state: 'idle-active',
    label: 'Idle (active)',
    description: 'Last turn finished. Agent is ready for the next prompt.',
    ringStyle: null,
    hasErrorDot: false,
  },
  {
    state: 'waiting',
    label: 'Waiting',
    description: 'Waiting for user input. Agent needs permission or a response to continue.',
    ringStyle: 'dotted',
    hasErrorDot: false,
  },
  {
    state: 'working',
    label: 'Working',
    description: 'Actively using tools, reading files, running commands, writing code etc.',
    ringStyle: 'dashed',
    hasErrorDot: false,
  },
  {
    state: 'error',
    label: 'Error',
    description: 'Agent stopped unexpectedly or a tool call failed.',
    ringStyle: null,
    hasErrorDot: true,
  },
];

const StateCard: React.FC<CardConfig> = ({
  state,
  label,
  description,
  ringStyle,
  hasErrorDot,
}) => {
  // Settings panel is always dark, so always pull the dark variants.
  const colors = STATE_COLORS[state];
  const fill = colors.fill.dark;
  const glow = colors.glow.dark;
  const ring = colors.ring?.dark ?? null;

  return (
    <div className='bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-4 flex flex-col gap-3 shadow-xl'>
      <div className='flex items-center gap-3'>
        <div className='relative w-9 h-9 shrink-0 flex items-center justify-center'>
          <div
            className='w-9 h-9 rounded-full'
            style={{
              background: `radial-gradient(circle, ${fill} 0%, rgba(128,128,128,0.06) 100%)`,
              border: '1.5px solid rgba(255,255,255,0.18)',
              boxShadow: ringStyle || hasErrorDot ? `0 0 10px 2px ${glow}` : undefined,
            }}
          />
          {ringStyle && ring && (
            <div
              className='absolute w-[42px] h-[42px] rounded-full'
              style={{ border: `1.5px ${ringStyle} ${ring}` }}
            />
          )}
          {hasErrorDot && (
            <div
              className='absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500'
              style={{ boxShadow: `0 0 5px ${glow}` }}
            />
          )}
        </div>
        <p className={`font-semibold text-sm ${colors.textClass}`}>{label}</p>
      </div>
      <p className='text-xs text-slate-400 leading-relaxed'>{description}</p>
    </div>
  );
};

export const StatesReference: React.FC = () => (
  <div className='mt-10'>
    <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4'>
      Agent States
    </p>
    <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3'>
      {CARDS.map((card) => (
        <StateCard key={card.state} {...card} />
      ))}
    </div>
  </div>
);

import React, { useState } from 'react';
import { AgentState } from '../../../common/types';
import { STATE_COLORS } from '../../../common/stateColors';
import { TOOL_META } from '../../../common/toolMeta';
import { ClawdMascot } from '../Bubble/ClawdMascot';
import { CodexMascot } from '../Bubble/CodexMascot';
import { AntigravityMascot } from '../Bubble/AntigravityMascot';
import { KiroMascot } from '../Bubble/KiroMascot';
import { MicoMascot } from '../Bubble/MicoMascot';

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
    <div className='bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-4 flex flex-col gap-3 shadow-xl'>
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
      <p className='text-xs text-muted leading-relaxed'>{description}</p>
    </div>
  );
};

// ── Mascot states ────────────────────────────────────────────────────────────
// The same five states, acted out by the animated mascots that replace the orb
// when Mascot mode is enabled on a bubble. One mascot renders at a time so only
// five GSAP loops run in the settings window.

type MascotToolId = 'claude-code' | 'openai-codex' | 'antigravity-cli' | 'kiro' | 'vscode-copilot';

interface MascotEntry {
  id: MascotToolId;
  Component: React.ComponentType<{ state: AgentState; width: number }>;
  // Per-mascot width chosen so the differing viewBox aspect ratios land at a
  // similar rendered height inside the card stage.
  width: number;
}

const MASCOTS: MascotEntry[] = [
  { id: 'claude-code', Component: ClawdMascot, width: 78 },
  { id: 'openai-codex', Component: CodexMascot, width: 64 },
  { id: 'antigravity-cli', Component: AntigravityMascot, width: 58 },
  { id: 'kiro', Component: KiroMascot, width: 78 },
  { id: 'vscode-copilot', Component: MicoMascot, width: 78 },
];

const MascotStateCard: React.FC<{ card: CardConfig; mascot: MascotEntry }> = ({
  card,
  mascot,
}) => {
  const colors = STATE_COLORS[card.state];
  const Mascot = mascot.Component;

  return (
    <div className='bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-4 flex flex-col gap-3 shadow-xl'>
      <div className='h-28 flex items-center justify-center overflow-hidden'>
        <Mascot state={card.state} width={mascot.width} />
      </div>
      <p className={`font-semibold text-sm text-center ${colors.textClass}`}>{card.label}</p>
    </div>
  );
};

const MascotStates: React.FC = () => {
  const [mascotId, setMascotId] = useState<MascotToolId>('claude-code');
  const mascot = MASCOTS.find((m) => m.id === mascotId) ?? MASCOTS[0];

  return (
    <div className='mt-8'>
      <div className='flex flex-wrap items-center justify-between gap-3 mb-4'>
        <p className='text-xs font-semibold uppercase tracking-widest text-faint'>
          Mascot States
        </p>
        <div className='flex gap-1.5'>
          {MASCOTS.map((m) => {
            const active = m.id === mascotId;
            return (
              <button
                key={m.id}
                onClick={() => setMascotId(m.id)}
                className={`flex items-center cursor-pointer gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${active
                    ? 'bg-control/80 border-edge-strong/70 text-primary'
                    : 'bg-glass/40 border-edge/70 text-muted hover:text-primary hover:border-edge-strong'
                  }`}
              >
                <img src={TOOL_META[m.id].icon} alt='' className='w-3.5 h-3.5' />
                {TOOL_META[m.id].label}
              </button>
            );
          })}
        </div>
      </div>
      <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3'>
        {CARDS.map((card) => (
          <MascotStateCard key={`${mascot.id}-${card.state}`} card={card} mascot={mascot} />
        ))}
      </div>
      <p className='text-[11px] text-faint mt-3'>
        Shown when Mascot mode is enabled for the tool in the Bubble tab.
      </p>
    </div>
  );
};

export const StatesReference: React.FC = () => (
  <div className='mt-10'>
    <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-4'>
      Agent States
    </p>
    <div className='grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3'>
      {CARDS.map((card) => (
        <StateCard key={card.state} {...card} />
      ))}
    </div>
    <MascotStates />
  </div>
);

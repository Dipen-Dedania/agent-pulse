import React from 'react';
import { BubbleConfig, BubbleSize, BubbleStackPosition, BubbleSoundId, BubbleFillMode } from '../../../common/types';
import { BUBBLE_SOUNDS, playBubbleSound } from '../../sound';

interface Props {
  config: BubbleConfig;
  onChange: (partial: Partial<BubbleConfig>) => void;
}

const SIZE_OPTIONS: { id: BubbleSize; label: string; orb: number }[] = [
  { id: 'small',  label: 'Small',  orb: 22 },
  { id: 'medium', label: 'Medium', orb: 30 },
  { id: 'large',  label: 'Large',  orb: 40 },
];

const FILL_OPTIONS: { id: BubbleFillMode; label: string }[] = [
  { id: 'glass', label: 'Glass' },
  { id: 'solid', label: 'Solid' },
];

// Quick-pick fill colors. White covers the common "dark logo, dark desktop"
// case; the rest are neutral backdrops. Any color is reachable via the picker.
const FILL_SWATCHES = ['#ffffff', '#f1f5f9', '#1e293b', '#000000'];

const POSITION_OPTIONS: { id: BubbleStackPosition; label: string }[] = [
  { id: 'top-left',     label: 'Top left' },
  { id: 'top-right',    label: 'Top right' },
  { id: 'bottom-left',  label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
];

// A small monitor mock-up with a clickable bubble dot in each corner so the
// stack anchor reads at a glance. When the user has drag-placed the stack
// (custom anchor), no corner lights up — picking one snaps the stack back.
const PositionPicker: React.FC<{
  value: BubbleStackPosition;
  hasCustomAnchor: boolean;
  onChange: (next: BubbleStackPosition) => void;
}> = ({ value, hasCustomAnchor, onChange }) => {
  const cornerClass: Record<BubbleStackPosition, string> = {
    'top-left':     'top-2 left-2',
    'top-right':    'top-2 right-2',
    'bottom-left':  'bottom-2 left-2',
    'bottom-right': 'bottom-2 right-2',
  };
  return (
    <div className='relative w-full max-w-[280px] aspect-[16/10] rounded-xl bg-slate-900/60 border border-slate-700/70 overflow-hidden'>
      {/* faux taskbar */}
      <div className='absolute bottom-0 left-0 right-0 h-2 bg-slate-700/50' />
      {hasCustomAnchor && (
        <span className='absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-widest text-slate-400 font-semibold pointer-events-none'>
          Custom
        </span>
      )}
      {POSITION_OPTIONS.map((opt) => {
        const active = !hasCustomAnchor && value === opt.id;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            aria-label={opt.label}
            title={opt.label}
            className={`absolute ${cornerClass[opt.id]} w-5 h-5 rounded-full cursor-pointer transition-all ${
              active
                ? 'bg-blue-500 ring-2 ring-blue-300/60 scale-110'
                : 'bg-slate-600/70 hover:bg-slate-500'
            }`}
          />
        );
      })}
    </div>
  );
};

export const BubbleSection: React.FC<Props> = ({ config, onChange }) => {
  const selectedPositionLabel =
    POSITION_OPTIONS.find((p) => p.id === config.stackPosition)?.label ?? config.stackPosition;

  return (
    <section className='bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-6 shadow-xl flex flex-col gap-7'>
      <div>
        <h2 className='text-lg font-bold text-white'>Bubble appearance</h2>
        <p className='text-sm text-slate-400 mt-1'>
          Tune how the status bubbles look and sound. Changes apply instantly and persist across restarts.
        </p>
      </div>

      {/* ── Size ──────────────────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Size</p>
        <p className='text-xs text-slate-400 -mt-1'>
          Scales the whole bubble — orb, icon, and the usage bars beneath it (width &amp; thickness).
        </p>
        <div className='flex gap-3'>
          {SIZE_OPTIONS.map((opt) => {
            const active = config.size === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => onChange({ size: opt.id })}
                className={`flex-1 flex flex-col items-center justify-center gap-2 py-4 rounded-xl border transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-500/15 border-blue-500/50 text-white'
                    : 'bg-slate-900/40 border-slate-700/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                <span
                  className='rounded-full'
                  style={{
                    width: opt.orb,
                    height: opt.orb,
                    background: active
                      ? 'radial-gradient(circle, rgba(59,130,246,0.9) 0%, rgba(59,130,246,0.25) 100%)'
                      : 'radial-gradient(circle, rgba(148,163,184,0.7) 0%, rgba(148,163,184,0.2) 100%)',
                    border: '1.5px solid rgba(255,255,255,0.25)',
                  }}
                />
                <span className='text-sm font-medium'>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Fill ─────────────────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Fill</p>
        <p className='text-xs text-slate-400 -mt-1'>
          Frosted glass blends with your desktop, but a dark logo (e.g. Cursor) can vanish over a dark
          window. A solid fill paints a consistent backdrop so every logo stays clearly visible.
        </p>
        <div className='flex gap-3'>
          {FILL_OPTIONS.map((opt) => {
            const active = (config.fillMode ?? 'glass') === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => onChange({ fillMode: opt.id })}
                className={`flex-1 flex flex-col items-center justify-center gap-2 py-4 rounded-xl border transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-500/15 border-blue-500/50 text-white'
                    : 'bg-slate-900/40 border-slate-700/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                }`}
              >
                <span
                  className='rounded-full'
                  style={{
                    width: 30,
                    height: 30,
                    background:
                      opt.id === 'solid'
                        ? config.fillColor || '#ffffff'
                        : 'radial-gradient(circle, rgba(148,163,184,0.55) 0%, rgba(128,128,128,0.06) 100%)',
                    backdropFilter: opt.id === 'glass' ? 'blur(6px)' : undefined,
                    border: '1.5px solid rgba(255,255,255,0.25)',
                  }}
                />
                <span className='text-sm font-medium'>{opt.label}</span>
              </button>
            );
          })}
        </div>

        {(config.fillMode ?? 'glass') === 'solid' && (
          <div className='flex flex-wrap items-center gap-2 mt-1'>
            {FILL_SWATCHES.map((c) => {
              const active = (config.fillColor || '#ffffff').toLowerCase() === c.toLowerCase();
              return (
                <button
                  key={c}
                  onClick={() => onChange({ fillColor: c })}
                  aria-label={`Fill color ${c}`}
                  title={c}
                  className={`w-7 h-7 rounded-full cursor-pointer transition-transform ${
                    active ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-800 scale-110' : 'hover:scale-105'
                  }`}
                  style={{ background: c, border: '1.5px solid rgba(255,255,255,0.25)' }}
                />
              );
            })}
            <label className='flex items-center gap-2 ml-1 text-xs text-slate-400 cursor-pointer'>
              <input
                type='color'
                value={/^#[0-9a-f]{6}$/i.test(config.fillColor || '') ? config.fillColor : '#ffffff'}
                onChange={(e) => onChange({ fillColor: e.target.value })}
                className='w-7 h-7 rounded-lg bg-transparent border border-slate-700/70 cursor-pointer p-0'
                aria-label='Custom fill color'
              />
              Custom
            </label>
          </div>
        )}
      </div>

      {/* ── Stack position ───────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Default stack position</p>
        <div className='flex flex-col sm:flex-row items-start gap-5'>
          <PositionPicker
            value={config.stackPosition}
            hasCustomAnchor={config.anchor != null}
            onChange={(next) => onChange({ stackPosition: next, anchor: null })}
          />
          <div className='grid grid-cols-2 gap-2'>
            {POSITION_OPTIONS.map((opt) => {
              const active = config.anchor == null && config.stackPosition === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => onChange({ stackPosition: opt.id, anchor: null })}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
        <p className='text-xs text-slate-500'>
          {config.anchor != null
            ? 'Bubbles stay where you dragged them — on any monitor — and stack toward that screen\'s middle. Pick a corner to snap back to a preset.'
            : `Bubbles anchor to the ${selectedPositionLabel.toLowerCase()} corner and stack toward the screen's middle. Drag a bubble to place the stack anywhere, on any monitor.`}
        </p>
      </div>

      {/* ── Inactivity sound ─────────────────────────────────────────────── */}
      <div className='flex flex-col gap-3'>
        <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Inactivity notification sound</p>
        <p className='text-xs text-slate-400 -mt-1'>
          Plays when an agent finishes and flips to “waiting for input.”
        </p>
        <div className='flex flex-col gap-2'>
          {BUBBLE_SOUNDS.map((sound) => {
            const active = config.sound === sound.id;
            return (
              <div
                key={sound.id}
                className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
                  active
                    ? 'bg-blue-500/15 border-blue-500/50'
                    : 'bg-slate-900/40 border-slate-700/60'
                }`}
              >
                <button
                  onClick={() => onChange({ sound: sound.id })}
                  className='flex-1 flex items-center gap-3 text-left cursor-pointer'
                >
                  <span
                    className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                      active ? 'border-blue-400' : 'border-slate-500'
                    }`}
                  >
                    {active && <span className='w-2 h-2 rounded-full bg-blue-400' />}
                  </span>
                  <span>
                    <span className={`text-sm font-medium ${active ? 'text-white' : 'text-slate-300'}`}>
                      {sound.label}
                    </span>
                    <span className='text-xs text-slate-500 ml-2'>{sound.hint}</span>
                  </span>
                </button>
                {sound.id !== 'none' && (
                  <button
                    onClick={() => playBubbleSound(sound.id)}
                    className='px-3 py-1 rounded-lg text-xs font-medium bg-slate-700/70 hover:bg-slate-600 text-slate-200 cursor-pointer transition-colors shrink-0'
                    aria-label={`Preview ${sound.label}`}
                  >
                    ▶ Preview
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

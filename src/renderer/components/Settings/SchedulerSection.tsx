import React, { useState } from 'react';
import { SchedulerStatus } from '../../../common/types';
import { estimateCost, formatUsd } from '../../../common/pricing';

// Mirrors SchedulerConfig in src/main/user-config.ts (kept structural so the
// renderer needn't import main-process modules).
export interface SchedulerSlotUI {
  time: string;      // 'HH:mm'
  days: number[];    // 0=Sun … 6=Sat
  enabled: boolean;
}

export interface SchedulerConfigUI {
  mode: 'off' | 'fixed' | 'adaptive';
  fixed: SchedulerSlotUI[];
  adaptive: { workHours: { start: string; end: string }; maxWindowsPerDay: number };
  tokenNudge: { enabled: boolean; leadMs: number };
  maxOpenersPerDay: number;
}

interface Props {
  config: SchedulerConfigUI;
  status: SchedulerStatus;
  onChange: (partial: Partial<SchedulerConfigUI>) => void;
  onTestOpener: () => void;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
// One-click preset (offered, never hard-coded into the engine): 6am / 11am / 4pm.
const PRESET_TIMES = ['06:00', '11:00', '16:00'];

// Rough API-equivalent of one opener ping (Haiku, trivial prompt + the small
// fixed session overhead). Shown so the negligible cost is never hidden.
const OPENER_TOKENS = { tokensIn: 2000, tokensOut: 50 };
const OPENER_COST = estimateCost('claude-haiku-4-5', OPENER_TOKENS).costUsd;

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatRelative(targetMs: number): string {
  const diff = targetMs - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 48) return rem > 0 ? `in ${hours}h ${rem}m` : `in ${hours}h`;
  return `in ${Math.round(hours / 24)}d`;
}

const Toggle: React.FC<{ on: boolean; onClick: () => void; label: string; small?: boolean }> = ({
  on, onClick, label, small,
}) => (
  <button
    onClick={onClick}
    aria-label={label}
    className={`relative ${small ? 'w-10 h-5' : 'w-11 h-6'} rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
      on ? 'bg-blue-500' : 'bg-slate-600'
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 ${small ? 'w-4 h-4' : 'w-5 h-5'} bg-white rounded-full shadow transition-transform duration-200 ${
        on ? (small ? 'translate-x-5' : 'translate-x-5') : 'translate-x-0'
      }`}
    />
  </button>
);

// ── Fixed-mode slot editor ───────────────────────────────────────────────────

const SlotRow: React.FC<{
  slot: SchedulerSlotUI;
  onChange: (next: SchedulerSlotUI) => void;
  onRemove: () => void;
}> = ({ slot, onChange, onRemove }) => {
  const toggleDay = (d: number) => {
    const days = slot.days.includes(d) ? slot.days.filter((x) => x !== d) : [...slot.days, d].sort();
    onChange({ ...slot, days });
  };
  return (
    <div className={`bg-slate-900/40 border border-slate-700/50 rounded-xl p-3 flex flex-wrap items-center gap-3 ${slot.enabled ? '' : 'opacity-50'}`}>
      <input
        type='time'
        value={slot.time}
        onChange={(e) => onChange({ ...slot, time: e.target.value })}
        className='bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500/60'
      />
      <div className='flex gap-1'>
        {WEEKDAYS.map((label, d) => {
          const active = slot.days.includes(d);
          return (
            <button
              key={d}
              onClick={() => toggleDay(d)}
              className={`w-7 h-7 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
                active ? 'bg-blue-500/80 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
              }`}
              title={label}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className='flex items-center gap-2 ml-auto'>
        <Toggle small on={slot.enabled} onClick={() => onChange({ ...slot, enabled: !slot.enabled })} label='Toggle slot' />
        <button
          onClick={onRemove}
          className='w-7 h-7 flex items-center justify-center rounded-md bg-slate-700/50 hover:bg-red-500/30 text-slate-400 hover:text-red-300 text-sm cursor-pointer transition-colors'
          aria-label='Remove slot'
        >
          ✕
        </button>
      </div>
    </div>
  );
};

// ── Section ──────────────────────────────────────────────────────────────────

export const SchedulerSection: React.FC<Props> = ({ config, status, onChange, onTestOpener }) => {
  const [testing, setTesting] = useState(false);

  const handleTest = async () => {
    setTesting(true);
    try {
      await onTestOpener();
    } finally {
      setTesting(false);
    }
  };

  const setMode = (mode: SchedulerConfigUI['mode']) => onChange({ mode });

  const updateSlot = (i: number, next: SchedulerSlotUI) => {
    const fixed = config.fixed.map((s, idx) => (idx === i ? next : s));
    onChange({ fixed });
  };
  const addSlot = () => onChange({ fixed: [...config.fixed, { time: '09:00', days: ALL_DAYS, enabled: true }] });
  const removeSlot = (i: number) => onChange({ fixed: config.fixed.filter((_, idx) => idx !== i) });
  const applyPreset = () =>
    onChange({ mode: 'fixed', fixed: PRESET_TIMES.map((time) => ({ time, days: ALL_DAYS, enabled: true })) });

  const glance = (() => {
    const live = status.windowResetsAt && status.windowResetsAt > Date.now();
    if (live) return `Window live · resets ${formatRelative(status.windowResetsAt!)}`;
    if (status.nextFireAt) {
      const kind = status.nextEventKind === 'nudge' ? 'Token refresh' : 'Next window';
      return `${kind} opens ${formatClock(status.nextFireAt)} (${formatRelative(status.nextFireAt)})`;
    }
    return config.mode === 'off' ? 'Scheduler off' : 'Nothing scheduled';
  })();

  const MODES: { id: SchedulerConfigUI['mode']; label: string }[] = [
    { id: 'off', label: 'Off' },
    { id: 'fixed', label: 'Fixed' },
    { id: 'adaptive', label: 'Adaptive' },
  ];

  return (
    <section className='mt-6 bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-6 shadow-xl'>
      <div className='flex items-start gap-4'>
        <div className='flex-1 min-w-0'>
          <h2 className='text-lg font-bold text-white'>Cowork Scheduler</h2>
          <p className='text-sm text-slate-400 mt-1'>
            Open a fresh 5-hour window on your schedule with one tiny <code className='text-slate-300'>claude -p</code> ping
            (which also refreshes your login). Turns the rolling window into a daily cadence.
          </p>
        </div>
      </div>

      {/* Mode switch */}
      <div className='mt-5 flex gap-1 p-1 bg-slate-900/50 border border-slate-700/60 rounded-xl w-fit'>
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
              config.mode === m.id ? 'bg-slate-700 text-white shadow-inner' : 'text-slate-400 hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Status glance */}
      <div className='mt-4 bg-slate-900/50 border border-slate-700/60 rounded-xl px-4 py-3'>
        <p className='text-sm text-white'>{glance}</p>
        {status.lastRun && (
          <p className='text-xs mt-1 text-slate-400'>
            Last {status.lastRun.kind} {formatClock(status.lastRun.at)} —{' '}
            {status.lastRun.ok ? (
              <span className='text-emerald-300'>ok</span>
            ) : (
              <span className='text-red-300'>failed: {status.lastRun.reason}</span>
            )}
          </p>
        )}
        <p className='text-xs mt-1 text-slate-500'>
          {status.openersToday} opener{status.openersToday === 1 ? '' : 's'} fired today · cap {config.maxOpenersPerDay}/day
        </p>
      </div>

      {/* Fixed editor */}
      {config.mode === 'fixed' && (
        <div className='mt-5'>
          <div className='flex items-center justify-between mb-3'>
            <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Slots</p>
            <div className='flex gap-2'>
              <button
                onClick={applyPreset}
                className='px-3 py-1 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 cursor-pointer transition-colors'
              >
                Preset 6 · 11 · 4
              </button>
              <button
                onClick={addSlot}
                className='px-3 py-1 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-colors'
              >
                + Add slot
              </button>
            </div>
          </div>
          {config.fixed.length === 0 ? (
            <p className='text-sm text-slate-400'>No slots yet. Add one, or apply the 6 · 11 · 4 preset.</p>
          ) : (
            <div className='flex flex-col gap-2'>
              {config.fixed.map((slot, i) => (
                <SlotRow key={i} slot={slot} onChange={(next) => updateSlot(i, next)} onRemove={() => removeSlot(i)} />
              ))}
            </div>
          )}
          <p className='text-xs text-slate-500 mt-2'>
            Space slots ≥5h apart so each lands a fresh window — a ping inside a live window just rides it.
          </p>
        </div>
      )}

      {/* Adaptive editor */}
      {config.mode === 'adaptive' && (
        <div className='mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4'>
          <label className='flex flex-col gap-1.5'>
            <span className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Work start</span>
            <input
              type='time'
              value={config.adaptive.workHours.start}
              onChange={(e) => onChange({ adaptive: { ...config.adaptive, workHours: { ...config.adaptive.workHours, start: e.target.value } } })}
              className='bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/60'
            />
          </label>
          <label className='flex flex-col gap-1.5'>
            <span className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Work end</span>
            <input
              type='time'
              value={config.adaptive.workHours.end}
              onChange={(e) => onChange({ adaptive: { ...config.adaptive, workHours: { ...config.adaptive.workHours, end: e.target.value } } })}
              className='bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/60'
            />
          </label>
          <label className='flex flex-col gap-1.5'>
            <span className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Max windows/day</span>
            <input
              type='number'
              min={1}
              max={10}
              value={config.adaptive.maxWindowsPerDay}
              onChange={(e) => onChange({ adaptive: { ...config.adaptive, maxWindowsPerDay: Math.max(1, Math.min(10, Number(e.target.value) || 1)) } })}
              className='w-24 bg-slate-900/60 border border-slate-700/70 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/60'
            />
          </label>
          <p className='text-xs text-slate-500 sm:col-span-3'>
            Opens a window at each block's reset within work hours. Shifts forward if you message Claude off-script.
          </p>
        </div>
      )}

      {/* Token nudge */}
      <div className='mt-5 bg-slate-900/40 border border-slate-700/50 rounded-xl p-4 flex items-start gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-medium text-white text-sm leading-tight'>Token-refresh nudge</p>
          <p className='text-xs text-slate-400 mt-1'>
            Fire a refresh ping ~{Math.round(config.tokenNudge.leadMs / 60000)} min before your login expires, when no
            opener is already coming. Keeps the usage panel from going stale (mainly in Off mode).
          </p>
        </div>
        <Toggle
          small
          on={config.tokenNudge.enabled}
          onClick={() => onChange({ tokenNudge: { ...config.tokenNudge, enabled: !config.tokenNudge.enabled } })}
          label='Toggle token nudge'
        />
      </div>

      {/* Daily cap + cost + test */}
      <div className='mt-5 flex flex-wrap items-end gap-4'>
        <label className='flex flex-col gap-1.5'>
          <span className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Max openers/day</span>
          <input
            type='number'
            min={1}
            max={24}
            value={config.maxOpenersPerDay}
            onChange={(e) => onChange({ maxOpenersPerDay: Math.max(1, Math.min(24, Number(e.target.value) || 1)) })}
            className='w-24 bg-slate-900/60 border border-slate-700/70 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/60'
          />
        </label>
        <button
          onClick={handleTest}
          disabled={testing}
          className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700/40 disabled:text-slate-500 text-white transition-colors cursor-pointer'
        >
          {testing ? 'Sending…' : 'Send test ping now'}
        </button>
        <p className='text-xs text-slate-500 flex-1 min-w-[12rem]'>
          Each ping ≈ {formatUsd(OPENER_COST)} at Haiku API rates ({formatUsd(OPENER_COST * config.maxOpenersPerDay)}/day
          at the cap). A test ping counts toward today's cap.
        </p>
      </div>
    </section>
  );
};

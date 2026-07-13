import React from 'react';
import { BacklogSchedulerConfig, BacklogSchedulerStatus, BacklogSlot } from '../../../common/backlog-types';
import { formatUsd } from '../../../common/pricing';

// Backlog Scheduler — sits beside the Cowork Scheduler in Usage → Claude Code.
// The Cowork slot is a fire INSTANT (opens a window); a backlog slot is a time
// RANGE during which queued board cards auto-execute. Mirrors the
// SchedulerSection row/toggle patterns. Board lives in the Backlog tab.

interface Props {
  config: BacklogSchedulerConfig;
  status: BacklogSchedulerStatus | null;
  onChange: (partial: Partial<BacklogSchedulerConfig>) => void;
}

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const PRESET_NIGHTS: BacklogSlot = { start: '23:00', end: '07:00', days: [1, 2, 3, 4, 5], enabled: true };
// end === start is a full 24h window (see timing.ts), giving true all-day
// coverage — '23:59' would leave a one-minute nightly gap.
const PRESET_WEEKENDS: BacklogSlot = { start: '00:00', end: '00:00', days: [0, 6], enabled: true };

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDayClock(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${formatClock(ms)}`;
}

function formatCountdown(targetMs: number): string {
  const mins = Math.max(0, Math.round((targetMs - Date.now()) / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** end <= start means the range wraps past midnight into the next day. */
function wrapsMidnight(slot: BacklogSlot): boolean {
  return slot.end <= slot.start;
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
        on ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

const SlotRow: React.FC<{
  slot: BacklogSlot;
  onChange: (next: BacklogSlot) => void;
  onRemove: () => void;
}> = ({ slot, onChange, onRemove }) => {
  const toggleDay = (d: number) => {
    const days = slot.days.includes(d) ? slot.days.filter((x) => x !== d) : [...slot.days, d].sort();
    onChange({ ...slot, days });
  };
  return (
    <div className={`bg-slate-900/40 border border-slate-700/50 rounded-xl p-3 flex flex-wrap items-center gap-3 ${slot.enabled ? '' : 'opacity-50'}`}>
      <div className='flex items-center gap-1.5'>
        <input
          type='time'
          value={slot.start}
          onChange={(e) => onChange({ ...slot, start: e.target.value })}
          className='bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500/60'
        />
        <span className='text-slate-500 text-sm'>–</span>
        <input
          type='time'
          value={slot.end}
          onChange={(e) => onChange({ ...slot, end: e.target.value })}
          className='bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-500/60'
        />
        {wrapsMidnight(slot) && (
          <span className='px-1.5 py-0.5 rounded text-[10px] bg-slate-700/60 text-slate-300' title='Ends the next morning'>
            +1d
          </span>
        )}
      </div>
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
              title={`${label} (window start day)`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className='flex items-center gap-2 ml-auto'>
        <Toggle small on={slot.enabled} onClick={() => onChange({ ...slot, enabled: !slot.enabled })} label='Toggle window' />
        <button
          onClick={onRemove}
          className='w-7 h-7 flex items-center justify-center rounded-md bg-slate-700/50 hover:bg-red-500/30 text-slate-400 hover:text-red-300 text-sm cursor-pointer transition-colors'
          aria-label='Remove window'
        >
          ✕
        </button>
      </div>
    </div>
  );
};

export const BacklogSchedulerSection: React.FC<Props> = ({ config, status, onChange }) => {
  const updateSlot = (i: number, next: BacklogSlot) =>
    onChange({ slots: config.slots.map((s, idx) => (idx === i ? next : s)) });
  const addSlot = () =>
    onChange({ slots: [...config.slots, { start: '23:00', end: '07:00', days: [1, 2, 3, 4, 5], enabled: true }] });
  const removeSlot = (i: number) => onChange({ slots: config.slots.filter((_, idx) => idx !== i) });
  const addPreset = (preset: BacklogSlot) => onChange({ enabled: true, slots: [...config.slots, { ...preset }] });

  const glance = (() => {
    if (!status) return config.enabled ? 'Waiting for engine…' : 'Backlog autorun off';
    if (status.runningCardTitle) {
      const left = status.windowEndsAt ? ` · ${formatCountdown(status.windowEndsAt)} left` : '';
      return `Running: ${status.runningCardTitle}${left}`;
    }
    if (status.windowActive && status.windowEndsAt) {
      return `Window open · ${formatCountdown(status.windowEndsAt)} left${status.waitingForIdle ? ' · waiting for idle' : ''} · queue: ${status.queueReady} ready`;
    }
    if (status.nextWindowStartAt) {
      return `Next window ${formatDayClock(status.nextWindowStartAt)} · queue: ${status.queueReady} ready`;
    }
    if (config.enabled) return 'No windows configured — add one below';
    // Surface configured-but-dormant windows so "+ Add window" (which doesn't
    // flip the master toggle, unlike the presets) doesn't look like a no-op.
    return config.slots.length > 0
      ? `Backlog autorun off — ${config.slots.length} window${config.slots.length === 1 ? '' : 's'} configured, enable to arm`
      : 'Backlog autorun off';
  })();

  return (
    <section className='mt-6 bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-6 shadow-xl'>
      <div className='flex items-start gap-4'>
        <div className='flex-1 min-w-0'>
          <h2 className='text-lg font-bold text-white'>Backlog Scheduler</h2>
          <p className='text-sm text-slate-400 mt-1'>
            Time windows when queued cards from the <span className='text-slate-300'>Backlog</span> board
            auto-execute — night hours, weekends. Green cards only, one at a time, research reports only in
            this phase. Turns idle window credit into finished work.
          </p>
        </div>
        <Toggle on={config.enabled} onClick={() => onChange({ enabled: !config.enabled })} label='Toggle backlog scheduler' />
      </div>

      {/* Status glance */}
      <div className='mt-4 bg-slate-900/50 border border-slate-700/60 rounded-xl px-4 py-3'>
        <p className='text-sm text-white'>{glance}</p>
        {status?.usagePausedUntil != null && status.usagePausedUntil > Date.now() && (
          <p className='text-xs mt-1 text-amber-300/90'>
            usage window exhausted · resumes ~{formatClock(status.usagePausedUntil)}
          </p>
        )}
        {status?.lastRun && (
          <p className='text-xs mt-1 text-slate-400'>
            Last run {formatClock(status.lastRun.at)} — {status.lastRun.cardTitle}:{' '}
            <span className={status.lastRun.outcome === 'success' ? 'text-emerald-300' : 'text-amber-300'}>
              {status.lastRun.outcome}
            </span>
          </p>
        )}
        {status?.forecast && status.forecast.cardCount > 0 && (
          <p className='text-xs mt-1 text-slate-500'>
            Queue will burn ~{formatUsd(status.forecast.totalCostUsd)} in the next window
            ({status.forecast.cardCount} card{status.forecast.cardCount === 1 ? '' : 's'} fit).
          </p>
        )}
      </div>

      {/* Windows editor */}
      <div className='mt-5'>
        <div className='flex items-center justify-between mb-3 flex-wrap gap-2'>
          <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>Windows</p>
          <div className='flex gap-2'>
            <button
              onClick={() => addPreset(PRESET_NIGHTS)}
              className='px-3 py-1 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 cursor-pointer transition-colors'
            >
              Nights 23–07 Mon–Fri
            </button>
            <button
              onClick={() => addPreset(PRESET_WEEKENDS)}
              className='px-3 py-1 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 cursor-pointer transition-colors'
            >
              Weekends
            </button>
            <button
              onClick={addSlot}
              className='px-3 py-1 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white cursor-pointer transition-colors'
            >
              + Add window
            </button>
          </div>
        </div>
        {config.slots.length === 0 ? (
          <p className='text-sm text-slate-400'>No windows yet. Add one, or use a preset — overnight ranges (23:00–07:00) belong to their start day.</p>
        ) : (
          <div className='flex flex-col gap-2'>
            {config.slots.map((slot, i) => (
              <SlotRow key={i} slot={slot} onChange={(next) => updateSlot(i, next)} onRemove={() => removeSlot(i)} />
            ))}
          </div>
        )}
      </div>

      {/* requireIdle gate */}
      <div className='mt-5 bg-slate-900/40 border border-slate-700/50 rounded-xl p-4 flex items-start gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-medium text-white text-sm leading-tight'>Only run while idle</p>
          <p className='text-xs text-slate-400 mt-1'>
            Even inside a window, wait until the keyboard/mouse have been untouched for 5 minutes — so a
            late-night session of yours isn't interrupted by an agent claiming the queue.
          </p>
        </div>
        <Toggle
          small
          on={config.requireIdle}
          onClick={() => onChange({ requireIdle: !config.requireIdle })}
          label='Toggle idle requirement'
        />
      </div>

      <p className='text-xs text-slate-500 mt-4'>
        Sequential in this phase: one card at a time, each with a hard time budget. A card still running at
        window end gets a 10-minute grace period, then pauses and resumes first in the next window. Backlog
        runs anchor 5-hour windows themselves, so Cowork opener pings are skipped while a card is running.
      </p>
    </section>
  );
};

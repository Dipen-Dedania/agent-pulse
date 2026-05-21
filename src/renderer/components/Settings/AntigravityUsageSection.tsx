import React from 'react';
import { AntigravityUsageStatus, UsageState } from '../../../common/types';

export interface AntigravityUsageNotificationUI {
  enabled: boolean;
  threshold: number;
}

export interface AntigravityUsageConfigUI {
  enabled: boolean;
  intervalMs: number;
  capWarning: AntigravityUsageNotificationUI;
  nudge: AntigravityUsageNotificationUI;
}

interface Props {
  config: AntigravityUsageConfigUI;
  status: AntigravityUsageStatus;
  onChange: (partial: Partial<AntigravityUsageConfigUI>) => void;
  onRefresh: () => void;
}

const STATE_LABEL: Record<UsageState, string> = {
  ok: 'Live',
  unknown: 'Waiting for first poll…',
  unauthenticated: 'CSRF token required',
  unavailable: 'IDE unavailable',
  'rate-limited': 'Rate-limited',
  'network-error': 'Network error',
};

const STATE_PILL_CLASS: Record<UsageState, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  unknown: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  unauthenticated: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  unavailable: 'bg-slate-700/40 text-slate-300 border-slate-600/40',
  'rate-limited': 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  'network-error': 'bg-red-500/15 text-red-300 border-red-500/30',
};

function formatRelativeReset(targetMs: number | undefined): string {
  if (!targetMs) return '—';
  const diff = targetMs - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

interface NotifyRowProps {
  title: string;
  hint: string;
  value: AntigravityUsageNotificationUI;
  comparator: 'lte' | 'gte';
  onChange: (next: AntigravityUsageNotificationUI) => void;
}

const NotifyRow: React.FC<NotifyRowProps> = ({ title, hint, value, comparator, onChange }) => {
  const op = comparator === 'lte' ? '≤' : '≥';
  return (
    <div className='bg-slate-900/40 border border-slate-700/50 rounded-xl p-4'>
      <div className='flex items-start gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-medium text-white text-sm leading-tight'>{title}</p>
          <p className='text-xs text-slate-400 mt-1'>{hint}</p>
        </div>
        <button
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          className={`relative w-10 h-5 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
            value.enabled ? 'bg-blue-500' : 'bg-slate-600'
          }`}
          aria-label={`Toggle ${title}`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
              value.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <div className={`flex items-center gap-3 mt-3 ${value.enabled ? '' : 'opacity-50'}`}>
        <span className='text-xs text-slate-500 font-mono whitespace-nowrap'>
          remaining {op}
        </span>
        <input
          type='range'
          min={1}
          max={99}
          value={value.threshold}
          disabled={!value.enabled}
          onChange={(e) => onChange({ ...value, threshold: Number(e.target.value) })}
          className='flex-1'
        />
        <span className='text-sm text-white font-mono w-10 text-right'>{value.threshold}%</span>
      </div>
    </div>
  );
};

function fillColorForRemaining(remaining: number): string {
  if (remaining > 50) return 'rgba(34,197,94,0.7)';
  if (remaining > 20) return 'rgba(245,158,11,0.75)';
  return 'rgba(239,68,68,0.8)';
}

export const AntigravityUsageSection: React.FC<Props> = ({ config, status, onChange, onRefresh }) => {
  const intervalSec = Math.round(config.intervalMs / 1000);
  const models = status.snapshot?.models ?? [];

  return (
    <section className='mt-6 bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-6 shadow-xl'>
      <div className='flex items-start gap-4'>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-3'>
            <h2 className='text-lg font-bold text-white'>Antigravity IDE Usage</h2>
            <span
              className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATE_PILL_CLASS[status.state]}`}
            >
              {STATE_LABEL[status.state]}
            </span>
          </div>
          <p className='text-sm text-slate-400 mt-1'>
            Tracks per-model quota in the Antigravity IDE. The endpoint is local — readings
            only refresh while the IDE is running.
          </p>
        </div>

        <button
          onClick={() => onChange({ enabled: !config.enabled })}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
            config.enabled ? 'bg-blue-500' : 'bg-slate-600'
          }`}
          aria-label='Toggle Antigravity usage tracking'
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
              config.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {config.enabled && models.length > 0 && (
        <div className='mt-5 flex flex-col gap-2'>
          <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>
            Models with active quotas
          </p>
          <div className='bg-slate-900/40 border border-slate-700/60 rounded-xl divide-y divide-slate-700/40 overflow-hidden'>
            {models.map((m) => {
              const remaining = 100 - m.utilization;
              const fill = fillColorForRemaining(remaining);
              return (
                <div key={m.modelKey} className='flex items-center gap-3 px-3 py-2.5'>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2'>
                      <p className='text-sm font-medium text-white truncate'>{m.displayName}</p>
                      {m.exhausted && (
                        <span
                          className='text-amber-400 shrink-0'
                          title='Quota exhausted — waiting for reset'
                          aria-label='Quota exhausted'
                        >
                          ⚠
                        </span>
                      )}
                      {m.recommended && (
                        <span className='text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30 shrink-0'>
                          Recommended
                        </span>
                      )}
                    </div>
                    <div className='flex items-center gap-3 mt-1.5'>
                      <div
                        className='relative flex-1 rounded-full overflow-hidden'
                        style={{ height: 4, background: 'rgba(255,255,255,0.10)' }}
                      >
                        <div
                          className='absolute left-0 top-0 h-full rounded-full transition-all duration-500'
                          style={{ width: `${Math.max(2, Math.min(100, remaining))}%`, background: fill }}
                        />
                      </div>
                      <span className='text-xs text-slate-400 shrink-0 tabular-nums'>
                        {Math.round(remaining)}% · resets {formatRelativeReset(m.resetsAt)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {config.enabled && status.state === 'ok' && models.length === 0 && (
        <p className='mt-4 text-sm text-slate-400 italic'>
          No models reporting a quota window right now.
        </p>
      )}

      {status.message && status.state !== 'ok' && (
        <p className='mt-4 text-sm text-amber-300/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2'>
          {status.message}
        </p>
      )}

      {config.enabled && (
        <>
          <div className='mt-6'>
            <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold mb-3'>
              Notifications
            </p>
            <div className='grid grid-cols-1 gap-3'>
              <NotifyRow
                title='Cap warning'
                hint='Notify when remaining quota on any tracked model drops to or below this level.'
                value={config.capWarning}
                comparator='lte'
                onChange={(next) => onChange({ capWarning: next })}
              />
              <NotifyRow
                title='Use-it-or-lose-it nudge'
                hint='Notify when at least this much credit is unused on a model and its window resets within 30 minutes.'
                value={config.nudge}
                comparator='gte'
                onChange={(next) => onChange({ nudge: next })}
              />
            </div>
          </div>

          <div className='mt-5'>
            <label className='flex flex-col gap-1.5'>
              <span className='text-xs uppercase tracking-widest text-slate-500 font-semibold'>
                Poll interval
              </span>
              <div className='flex items-center gap-2'>
                <input
                  type='number'
                  min={60}
                  max={3600}
                  step={30}
                  value={intervalSec}
                  onChange={(e) => {
                    const next = Math.max(60, Math.min(3600, Number(e.target.value) || 300));
                    onChange({ intervalMs: next * 1000 });
                  }}
                  className='w-24 bg-slate-900/60 border border-slate-700/70 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/60'
                />
                <span className='text-xs text-slate-500'>seconds (min 60)</span>
              </div>
            </label>
            <p className='mt-3 text-xs text-slate-500'>
              The bubble surfaces just two models — Claude Opus 4.6 and Gemini 3.5 Flash (High).
              All other models stay visible in the list above.
            </p>
          </div>
        </>
      )}

      <div className='mt-5 flex gap-2'>
        <button
          onClick={onRefresh}
          disabled={!config.enabled}
          className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700/40 disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors cursor-pointer'
        >
          Refresh now
        </button>
      </div>
    </section>
  );
};

import React from 'react';
import { CodexUsageStatus, UsageState } from '../../../common/types';

export interface CodexUsageNotificationUI {
  enabled: boolean;
  threshold: number;
}

export interface CodexUsageConfigUI {
  enabled: boolean;
  intervalMs: number;
  capWarning: CodexUsageNotificationUI;
  nudge: CodexUsageNotificationUI;
}

interface Props {
  config: CodexUsageConfigUI;
  status: CodexUsageStatus;
  onChange: (partial: Partial<CodexUsageConfigUI>) => void;
  onRefresh: () => void;
}

const STATE_LABEL: Record<UsageState, string> = {
  ok: 'Live',
  unknown: 'Waiting for first poll…',
  unauthenticated: 'Sign in required',
  unavailable: 'Endpoint unavailable',
  'rate-limited': 'Rate-limited',
  'network-error': 'Network error',
};

const STATE_PILL_CLASS: Record<UsageState, string> = {
  ok: 'bg-emerald-500/15 text-ok border-emerald-500/30',
  unknown: 'bg-control/40 text-body border-edge-strong/40',
  unauthenticated: 'bg-amber-500/15 text-warn border-amber-500/30',
  unavailable: 'bg-amber-500/15 text-warn border-amber-500/30',
  'rate-limited': 'bg-amber-500/15 text-warn border-amber-500/30',
  'network-error': 'bg-red-500/15 text-danger border-red-500/30',
};

function formatRelativeReset(targetMs: number | undefined): string {
  if (!targetMs) return '—';
  const diff = targetMs - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    const remMins = mins % 60;
    return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

interface NotifyRowProps {
  title: string;
  hint: string;
  value: CodexUsageNotificationUI;
  comparator: 'lte' | 'gte';
  onChange: (next: CodexUsageNotificationUI) => void;
}

const NotifyRow: React.FC<NotifyRowProps> = ({ title, hint, value, comparator, onChange }) => {
  const op = comparator === 'lte' ? '≤' : '≥';
  return (
    <div className='bg-glass/40 border border-edge/50 rounded-xl p-4'>
      <div className='flex items-start gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-medium text-strong text-sm leading-tight'>{title}</p>
          <p className='text-xs text-muted mt-1'>{hint}</p>
        </div>
        <button
          onClick={() => onChange({ ...value, enabled: !value.enabled })}
          className={`relative w-10 h-5 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
            value.enabled ? 'bg-blue-500' : 'bg-control-strong'
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
        <span className='text-xs text-faint font-mono whitespace-nowrap'>
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
        <span className='text-sm text-strong font-mono w-10 text-right'>{value.threshold}%</span>
      </div>
    </div>
  );
};

export const CodexUsageSection: React.FC<Props> = ({ config, status, onChange, onRefresh }) => {
  const intervalSec = Math.round(config.intervalMs / 1000);
  const snapshot = status.snapshot;

  return (
    <section className='mt-6 bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-6 shadow-xl'>
      <div className='flex items-start gap-4'>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-3'>
            <h2 className='text-lg font-bold text-strong'>Codex Subscription Usage</h2>
            <span
              className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATE_PILL_CLASS[status.state]}`}
            >
              {STATE_LABEL[status.state]}
            </span>
          </div>
          <p className='text-sm text-muted mt-1'>
            Tracks remaining quota in your ChatGPT/Codex weekly window. The bar below the Codex
            bubble fills as an "opportunity gauge" — full means you've got headroom.
          </p>
        </div>

        <button
          onClick={() => onChange({ enabled: !config.enabled })}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
            config.enabled ? 'bg-blue-500' : 'bg-control-strong'
          }`}
          aria-label='Toggle Codex usage tracking'
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
              config.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {config.enabled && (
        <div className={`mt-5 grid gap-4 ${snapshot?.secondary ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <div className='bg-glass/50 border border-edge/60 rounded-xl p-4'>
            <p className='text-xs uppercase tracking-widest text-faint font-semibold'>
              Weekly window
            </p>
            <p className='text-2xl font-bold text-strong mt-1'>
              {snapshot ? `${100 - snapshot.primary.utilization}%` : '—'}
              <span className='text-xs font-normal text-muted ml-1'>available</span>
            </p>
            <p className='text-xs text-muted mt-1'>
              Resets {formatRelativeReset(snapshot?.primary.resetsAt)}
            </p>
          </div>
          {snapshot?.secondary && (
            <div className='bg-glass/50 border border-edge/60 rounded-xl p-4'>
              <p className='text-xs uppercase tracking-widest text-faint font-semibold'>
                Secondary window
              </p>
              <p className='text-2xl font-bold text-strong mt-1'>
                {`${100 - snapshot.secondary.utilization}%`}
                <span className='text-xs font-normal text-muted ml-1'>available</span>
              </p>
              <p className='text-xs text-muted mt-1'>
                Resets {formatRelativeReset(snapshot.secondary.resetsAt)}
              </p>
            </div>
          )}
        </div>
      )}

      {status.message && status.state !== 'ok' && (
        <p className='mt-4 text-sm text-warn/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2'>
          {status.message}
        </p>
      )}

      {config.enabled && (
        <>
          <div className='mt-6'>
            <p className='text-xs uppercase tracking-widest text-faint font-semibold mb-3'>
              Notifications
            </p>
            <div className='grid grid-cols-1 gap-3'>
              <NotifyRow
                title='Cap warning'
                hint='Notify when remaining Codex credit drops to or below this level.'
                value={config.capWarning}
                comparator='lte'
                onChange={(next) => onChange({ capWarning: next })}
              />
              <NotifyRow
                title='Use-it-or-lose-it nudge'
                hint='Notify when at least this much credit is unused and the window resets within 30 minutes.'
                value={config.nudge}
                comparator='gte'
                onChange={(next) => onChange({ nudge: next })}
              />
            </div>
          </div>

          <div className='mt-5'>
            <label className='flex flex-col gap-1.5'>
              <span className='text-xs uppercase tracking-widest text-faint font-semibold'>
                Poll interval
              </span>
              <div className='flex items-center gap-2'>
                <input
                  type='number'
                  min={600}
                  max={3600}
                  step={60}
                  value={intervalSec}
                  onChange={(e) => {
                    const next = Math.max(600, Math.min(3600, Number(e.target.value) || 900));
                    onChange({ intervalMs: next * 1000 });
                  }}
                  className='w-24 bg-glass/60 border border-edge/70 rounded-lg px-3 py-1.5 text-sm text-strong focus:outline-none focus:border-blue-500/60'
                />
                <span className='text-xs text-faint'>seconds (min 600)</span>
              </div>
            </label>
          </div>
        </>
      )}

      <div className='mt-5 flex gap-2'>
        <button
          onClick={onRefresh}
          disabled={!config.enabled}
          className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-control/40 disabled:text-faint disabled:cursor-not-allowed text-white transition-colors cursor-pointer'
        >
          Refresh now
        </button>
      </div>
    </section>
  );
};

import React from 'react';
import { CopilotUsageStatus, CopilotQuotaWindow, UsageState } from '../../../common/types';
import { GlassToggle, Button } from '../Shared';

export interface CopilotUsageNotificationUI {
  enabled: boolean;
  threshold: number;
}

export interface CopilotUsageConfigUI {
  enabled: boolean;
  liveQuota: boolean;
  intervalMs: number;
  capWarning: CopilotUsageNotificationUI;
  nudge: CopilotUsageNotificationUI;
}

interface Props {
  config: CopilotUsageConfigUI;
  status: CopilotUsageStatus;
  onChange: (partial: Partial<CopilotUsageConfigUI>) => void;
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
  value: CopilotUsageNotificationUI;
  comparator: 'lte' | 'gte';
  onChange: (next: CopilotUsageNotificationUI) => void;
}

const NotifyRow: React.FC<NotifyRowProps> = ({ title, hint, value, comparator, onChange }) => {
  const op = comparator === 'lte' ? '≤' : '≥';
  return (
    <div className='glass-secondary p-4'>
      <div className='flex items-start gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-medium text-strong text-sm leading-tight'>{title}</p>
          <p className='text-xs text-muted mt-1'>{hint}</p>
        </div>
        <GlassToggle
          checked={value.enabled}
          onChange={() => onChange({ ...value, enabled: !value.enabled })}
          size='md'
          label={`Toggle ${title}`}
        />
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

const QuotaBar: React.FC<{ window: CopilotQuotaWindow }> = ({ window: w }) => {
  const remaining = w.unlimited ? 100 : Math.round(100 - w.utilization);
  return (
    <div className='glass-secondary p-4'>
      <p className='text-xs uppercase tracking-widest text-faint font-semibold'>{w.label}</p>
      <p className='text-2xl font-bold text-strong mt-1'>
        {w.unlimited ? '∞' : `${remaining}%`}
        <span className='text-xs font-normal text-muted ml-1'>available</span>
      </p>
      <p className='text-xs text-muted mt-1'>
        {w.unlimited
          ? `Unlimited · resets ${formatRelativeReset(w.resetsAt)}`
          : `${w.remaining} of ${w.entitlement} left · resets ${formatRelativeReset(w.resetsAt)}`}
      </p>
      {!w.unlimited && (
        <div className='mt-2 h-1.5 rounded-full bg-control/60 overflow-hidden'>
          <div
            className='h-full bg-emerald-400/80 rounded-full transition-all'
            style={{ width: `${Math.max(0, Math.min(100, remaining))}%` }}
          />
        </div>
      )}
    </div>
  );
};

export const CopilotUsageSection: React.FC<Props> = ({ config, status, onChange, onRefresh }) => {
  const intervalSec = Math.round(config.intervalMs / 1000);
  const snapshot = status.snapshot;
  const quotas = snapshot?.quotas ?? [];
  const hasLiveBars = config.liveQuota && quotas.length > 0;

  return (
    <section className='glass-primary mt-6 p-6'>
      <div className='flex items-start gap-4'>
        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-3'>
            <h2 className='text-lg font-bold text-strong'>GitHub Copilot Usage</h2>
            <span
              className={`text-[10px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-full border ${STATE_PILL_CLASS[status.state]}`}
            >
              {STATE_LABEL[status.state]}
            </span>
          </div>
          <p className='text-sm text-muted mt-1'>
            Signed-in account is read locally from VS Code. Live monthly quota (chat &
            completions) is optional — see the toggle below.
          </p>
        </div>

        <GlassToggle
          checked={config.enabled}
          onChange={() => onChange({ enabled: !config.enabled })}
          size='lg'
          label='Toggle Copilot usage tracking'
        />
      </div>

      {config.enabled && (
        <>
          {/* Account metadata pill — always available (no network/keychain). */}
          <div className='mt-5 flex items-center gap-2 flex-wrap'>
            {snapshot?.username ? (
              <span className='text-sm text-primary bg-glass/50 border border-edge/60 rounded-lg px-3 py-1.5'>
                Signed in as <span className='font-semibold text-strong'>{snapshot.username}</span>
                {snapshot.sku ? <span className='text-muted'> · {snapshot.sku}</span> : null}
              </span>
            ) : (
              <span className='text-sm text-muted bg-glass/50 border border-edge/60 rounded-lg px-3 py-1.5'>
                Not signed in to GitHub in VS Code.
              </span>
            )}
          </div>

          {hasLiveBars ? (
            <div className='mt-4 grid gap-4 grid-cols-1 sm:grid-cols-2'>
              {quotas.map((q) => (
                <QuotaBar key={q.key} window={q} />
              ))}
            </div>
          ) : (
            <p className='mt-4 text-sm text-muted'>
              {config.liveQuota
                ? 'No live quota to show yet — click Refresh, or check that you are signed in.'
                : 'Enable “Live quota” below to show your monthly chat & completions allowance.'}
            </p>
          )}
        </>
      )}

      {status.message && status.state !== 'ok' && (
        <p className='mt-4 text-sm text-warn/90 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2'>
          {status.message}
        </p>
      )}

      {config.enabled && (
        <>
          {/* Live-quota opt-in with ToS disclosure. */}
          <div className='glass-secondary mt-6 p-4'>
            <div className='flex items-start gap-3'>
              <div className='flex-1 min-w-0'>
                <p className='font-medium text-strong text-sm leading-tight'>Live quota</p>
                <p className='text-xs text-muted mt-1'>
                  Reads your GitHub token from the OS keychain to call an undocumented GitHub
                  endpoint (used by the VS Code Copilot client). Off by default.
                </p>
              </div>
              <GlassToggle
                checked={config.liveQuota}
                onChange={() => onChange({ liveQuota: !config.liveQuota })}
                size='md'
                label='Toggle Copilot live quota'
              />
            </div>
          </div>

          {config.liveQuota && (
            <>
              <div className='mt-6'>
                <p className='text-xs uppercase tracking-widest text-faint font-semibold mb-3'>
                  Notifications
                </p>
                <div className='grid grid-cols-1 gap-3'>
                  <NotifyRow
                    title='Cap warning'
                    hint='Notify when remaining Copilot quota drops to or below this level.'
                    value={config.capWarning}
                    comparator='lte'
                    onChange={(next) => onChange({ capWarning: next })}
                  />
                  <NotifyRow
                    title='Use-it-or-lose-it nudge'
                    hint='Notify when at least this much quota is unused and the month resets within 30 minutes.'
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
                        const next = Math.max(600, Math.min(3600, Number(e.target.value) || 1800));
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
        </>
      )}

      <div className='mt-5 flex gap-2'>
        <Button
          onClick={onRefresh}
          disabled={!config.enabled}
        >
          Refresh now
        </Button>
      </div>
    </section>
  );
};

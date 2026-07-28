import React from 'react';
import { AntigravityUsageStatus, UsageState } from '../../../common/types';
import { Tooltip } from '../Shared';
import {
  UsageNotificationUI,
  UsageProviderPanel,
  UsageMessage,
  NotificationsGroup,
  PollIntervalInput,
  formatRelativeReset,
  quotaFillClass,
} from './usage/UsageShared';

export interface AntigravityUsageConfigUI {
  enabled: boolean;
  intervalMs: number;
  capWarning: UsageNotificationUI;
  nudge: UsageNotificationUI;
}

interface Props {
  config: AntigravityUsageConfigUI;
  status: AntigravityUsageStatus;
  onChange: (partial: Partial<AntigravityUsageConfigUI>) => void;
  onRefresh: () => void;
}

// Antigravity's endpoint is local to the IDE, so a couple of states read
// differently from the network-backed providers.
const STATE_LABELS: Partial<Record<UsageState, string>> = {
  unauthenticated: 'CSRF token required',
  unavailable: 'IDE unavailable',
};

export const AntigravityUsageSection: React.FC<Props> = ({ config, status, onChange, onRefresh }) => {
  const models = status.snapshot?.models ?? [];

  return (
    <UsageProviderPanel
      title='Antigravity IDE Usage'
      subtitle={
        <>
          Tracks per-model quota in the Antigravity IDE. The endpoint is local — readings only
          refresh while the IDE is running.
        </>
      }
      state={status.state}
      stateLabels={STATE_LABELS}
      enabled={config.enabled}
      onToggleEnabled={() => onChange({ enabled: !config.enabled })}
      toggleLabel='Toggle Antigravity usage tracking'
      onRefresh={onRefresh}
    >
      {config.enabled && models.length > 0 && (
        <div className='mt-5 flex flex-col gap-2'>
          <p className='text-xs uppercase tracking-widest text-faint font-semibold'>
            Models with active quotas
          </p>
          <div className='glass-secondary divide-y divide-edge/40'>
            {models.map((m) => {
              const remaining = 100 - m.utilization;
              return (
                <div key={m.modelKey} className='flex items-center gap-3 px-3 py-2.5'>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2'>
                      <p className='text-sm font-medium text-strong truncate'>{m.displayName}</p>
                      {m.exhausted && (
                        <Tooltip content='Quota exhausted — waiting for reset'>
                          <span className='text-amber-400 shrink-0' aria-label='Quota exhausted'>
                            ⚠
                          </span>
                        </Tooltip>
                      )}
                      {m.recommended && (
                        <span className='text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/15 text-info border border-blue-500/30 shrink-0'>
                          Recommended
                        </span>
                      )}
                    </div>
                    <div className='flex items-center gap-3 mt-1.5'>
                      <div
                        className='relative flex-1 rounded-full overflow-hidden bg-white/10 light:bg-black/10'
                        style={{ height: 4 }}
                      >
                        <div
                          className={`absolute left-0 top-0 h-full rounded-full transition-all duration-500 motion-reduce:transition-none ${quotaFillClass(remaining)}`}
                          style={{ width: `${Math.max(2, Math.min(100, remaining))}%` }}
                        />
                      </div>
                      <span className='text-xs text-muted shrink-0 tabular-nums'>
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
        <p className='mt-4 text-sm text-muted italic'>
          No models reporting a quota window right now.
        </p>
      )}

      <UsageMessage message={status.message} state={status.state} />

      {config.enabled && (
        <>
          <NotificationsGroup
            capWarning={config.capWarning}
            nudge={config.nudge}
            capHint='Notify when remaining quota on any tracked model drops to or below this level.'
            nudgeHint='Notify when at least this much credit is unused on a model and its window resets within 30 minutes.'
            onCapChange={(next) => onChange({ capWarning: next })}
            onNudgeChange={(next) => onChange({ nudge: next })}
          />
          <PollIntervalInput
            intervalMs={config.intervalMs}
            minSec={60}
            fallbackSec={300}
            onChange={(intervalMs) => onChange({ intervalMs })}
          />
          <p className='mt-3 text-xs text-faint'>
            The bubble surfaces just two models — Claude Opus 4.6 and Gemini 3.5 Flash (High). All
            other models stay visible in the list above.
          </p>
        </>
      )}
    </UsageProviderPanel>
  );
};

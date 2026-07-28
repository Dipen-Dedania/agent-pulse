import React from 'react';
import { UsageStatus } from '../../../common/types';
import { GlassToggle } from '../Shared';
import {
  UsageNotificationUI,
  UsageProviderPanel,
  QuotaBar,
  UsageMessage,
  NotificationsGroup,
  PollIntervalInput,
  formatRelativeReset,
} from './usage/UsageShared';

export interface UsageConfigUI {
  enabled: boolean;
  intervalMs: number;
  showSevenDayBar: boolean;
  capWarning: UsageNotificationUI;
  nudge: UsageNotificationUI;
}

interface Props {
  config: UsageConfigUI;
  status: UsageStatus;
  onChange: (partial: Partial<UsageConfigUI>) => void;
  onRefresh: () => void;
}

export const UsageSection: React.FC<Props> = ({ config, status, onChange, onRefresh }) => {
  const snapshot = status.snapshot;

  return (
    <UsageProviderPanel
      title='Claude Subscription Usage'
      subtitle={
        <>
          Tracks remaining credit in the 5-hour and 7-day windows. Bars below the Claude bubble
          fill as an "opportunity gauge" — full means you've got headroom.
        </>
      }
      state={status.state}
      enabled={config.enabled}
      onToggleEnabled={() => onChange({ enabled: !config.enabled })}
      toggleLabel='Toggle usage tracking'
      onRefresh={onRefresh}
    >
      {/* Current snapshot — shows REMAINING credit to match bar semantics */}
      {config.enabled && (
        <div className='mt-5 grid grid-cols-2 gap-4'>
          <QuotaBar
            label='5-hour window'
            remaining={snapshot ? 100 - snapshot.fiveHour.utilization : null}
            sub={`Resets ${formatRelativeReset(snapshot?.fiveHour.resetsAt)}`}
          />
          <QuotaBar
            label='7-day window'
            remaining={snapshot ? 100 - snapshot.sevenDay.utilization : null}
            sub={`Resets ${formatRelativeReset(snapshot?.sevenDay.resetsAt)}`}
          />
        </div>
      )}

      <UsageMessage message={status.message} state={status.state} />

      {config.enabled && (
        <div className='glass-secondary mt-5 p-4 flex items-start gap-3'>
          <div className='flex-1 min-w-0'>
            <p className='font-medium text-strong text-sm leading-tight'>Show 7-day bar on bubble</p>
            <p className='text-xs text-muted mt-1'>
              Hide to keep the bubble focused on the 5-hour window only. The 7-day window is still tracked.
            </p>
          </div>
          <GlassToggle
            checked={config.showSevenDayBar}
            onChange={() => onChange({ showSevenDayBar: !config.showSevenDayBar })}
            size='md'
            label='Toggle 7-day bar on bubble'
          />
        </div>
      )}

      {config.enabled && (
        <>
          <NotificationsGroup
            capWarning={config.capWarning}
            nudge={config.nudge}
            capHint='Notify when remaining credit drops to or below this level.'
            nudgeHint='Notify when at least this much credit is unused and the window resets within 30 minutes.'
            onCapChange={(next) => onChange({ capWarning: next })}
            onNudgeChange={(next) => onChange({ nudge: next })}
          />
          <PollIntervalInput
            intervalMs={config.intervalMs}
            minSec={60}
            fallbackSec={600}
            onChange={(intervalMs) => onChange({ intervalMs })}
          />
        </>
      )}
    </UsageProviderPanel>
  );
};

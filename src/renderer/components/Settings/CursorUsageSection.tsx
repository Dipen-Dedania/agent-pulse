import React from 'react';
import { CursorUsageStatus } from '../../../common/types';
import {
  UsageNotificationUI,
  UsageProviderPanel,
  QuotaBar,
  UsageMessage,
  NotificationsGroup,
  PollIntervalInput,
  formatRelativeReset,
} from './usage/UsageShared';

export interface CursorUsageConfigUI {
  enabled: boolean;
  intervalMs: number;
  capWarning: UsageNotificationUI;
  nudge: UsageNotificationUI;
}

interface Props {
  config: CursorUsageConfigUI;
  status: CursorUsageStatus;
  onChange: (partial: Partial<CursorUsageConfigUI>) => void;
  onRefresh: () => void;
}

export const CursorUsageSection: React.FC<Props> = ({ config, status, onChange, onRefresh }) => {
  const snapshot = status.snapshot;
  const remaining = snapshot ? 100 - snapshot.plan.utilization : null;
  const resetSub =
    typeof snapshot?.limit === 'number' && snapshot.limit > 0 && typeof snapshot.remaining === 'number'
      ? `${snapshot.remaining} of ${snapshot.limit} left · resets ${formatRelativeReset(snapshot.plan.resetsAt)}`
      : `Resets ${formatRelativeReset(snapshot?.plan.resetsAt)}`;

  return (
    <UsageProviderPanel
      title='Cursor Subscription Usage'
      subtitle={
        <>
          Read locally from Cursor's session DB — reflects your plan's billing-cycle quota. The
          bar below the Cursor bubble fills as an "opportunity gauge": full means you've got
          headroom.
        </>
      }
      state={status.state}
      enabled={config.enabled}
      onToggleEnabled={() => onChange({ enabled: !config.enabled })}
      toggleLabel='Toggle Cursor usage tracking'
      onRefresh={onRefresh}
    >
      {config.enabled && (
        <div className='mt-5 grid gap-4 grid-cols-1'>
          <QuotaBar
            label={`Billing cycle${snapshot?.membershipType ? ` · ${snapshot.membershipType}` : ''}`}
            remaining={remaining}
            sub={resetSub}
          />
        </div>
      )}

      <UsageMessage message={status.message} state={status.state} />

      {config.enabled && (
        <>
          <NotificationsGroup
            capWarning={config.capWarning}
            nudge={config.nudge}
            capHint='Notify when remaining Cursor credit drops to or below this level.'
            nudgeHint='Notify when at least this much credit is unused and the cycle resets within 30 minutes.'
            onCapChange={(next) => onChange({ capWarning: next })}
            onNudgeChange={(next) => onChange({ nudge: next })}
          />
          <PollIntervalInput
            intervalMs={config.intervalMs}
            minSec={600}
            fallbackSec={1800}
            onChange={(intervalMs) => onChange({ intervalMs })}
          />
        </>
      )}
    </UsageProviderPanel>
  );
};

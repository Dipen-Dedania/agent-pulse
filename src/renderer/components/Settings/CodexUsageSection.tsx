import React from 'react';
import { CodexUsageStatus } from '../../../common/types';
import {
  UsageNotificationUI,
  UsageProviderPanel,
  QuotaBar,
  UsageMessage,
  NotificationsGroup,
  PollIntervalInput,
  formatRelativeReset,
} from './usage/UsageShared';

export interface CodexUsageConfigUI {
  enabled: boolean;
  intervalMs: number;
  capWarning: UsageNotificationUI;
  nudge: UsageNotificationUI;
}

interface Props {
  config: CodexUsageConfigUI;
  status: CodexUsageStatus;
  onChange: (partial: Partial<CodexUsageConfigUI>) => void;
  onRefresh: () => void;
}

export const CodexUsageSection: React.FC<Props> = ({ config, status, onChange, onRefresh }) => {
  const snapshot = status.snapshot;

  return (
    <UsageProviderPanel
      title='Codex Subscription Usage'
      subtitle={
        <>
          Tracks remaining quota in your ChatGPT/Codex weekly window. The bar below the Codex
          bubble fills as an "opportunity gauge" — full means you've got headroom.
        </>
      }
      state={status.state}
      enabled={config.enabled}
      onToggleEnabled={() => onChange({ enabled: !config.enabled })}
      toggleLabel='Toggle Codex usage tracking'
      onRefresh={onRefresh}
    >
      {config.enabled && (
        <div className={`mt-5 grid gap-4 ${snapshot?.secondary ? 'grid-cols-2' : 'grid-cols-1'}`}>
          <QuotaBar
            label='Weekly window'
            remaining={snapshot ? 100 - snapshot.primary.utilization : null}
            sub={`Resets ${formatRelativeReset(snapshot?.primary.resetsAt)}`}
          />
          {snapshot?.secondary && (
            <QuotaBar
              label='Secondary window'
              remaining={100 - snapshot.secondary.utilization}
              sub={`Resets ${formatRelativeReset(snapshot.secondary.resetsAt)}`}
            />
          )}
        </div>
      )}

      <UsageMessage message={status.message} state={status.state} />

      {config.enabled && (
        <>
          <NotificationsGroup
            capWarning={config.capWarning}
            nudge={config.nudge}
            capHint='Notify when remaining Codex credit drops to or below this level.'
            nudgeHint='Notify when at least this much credit is unused and the window resets within 30 minutes.'
            onCapChange={(next) => onChange({ capWarning: next })}
            onNudgeChange={(next) => onChange({ nudge: next })}
          />
          <PollIntervalInput
            intervalMs={config.intervalMs}
            minSec={600}
            fallbackSec={900}
            onChange={(intervalMs) => onChange({ intervalMs })}
          />
        </>
      )}
    </UsageProviderPanel>
  );
};

import React from 'react';
import { CopilotUsageStatus } from '../../../common/types';
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

export interface CopilotUsageConfigUI {
  enabled: boolean;
  liveQuota: boolean;
  intervalMs: number;
  capWarning: UsageNotificationUI;
  nudge: UsageNotificationUI;
}

interface Props {
  config: CopilotUsageConfigUI;
  status: CopilotUsageStatus;
  onChange: (partial: Partial<CopilotUsageConfigUI>) => void;
  onRefresh: () => void;
}

export const CopilotUsageSection: React.FC<Props> = ({ config, status, onChange, onRefresh }) => {
  const snapshot = status.snapshot;
  const quotas = snapshot?.quotas ?? [];
  const hasLiveBars = config.liveQuota && quotas.length > 0;

  return (
    <UsageProviderPanel
      title='GitHub Copilot Usage'
      subtitle={
        <>
          Signed-in account is read locally from VS Code. Live monthly quota (chat & completions)
          is optional — see the toggle below.
        </>
      }
      state={status.state}
      enabled={config.enabled}
      onToggleEnabled={() => onChange({ enabled: !config.enabled })}
      toggleLabel='Toggle Copilot usage tracking'
      onRefresh={onRefresh}
    >
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
                <QuotaBar
                  key={q.key}
                  label={q.label}
                  remaining={q.unlimited ? 100 : 100 - q.utilization}
                  unlimited={q.unlimited}
                  sub={
                    q.unlimited
                      ? `Unlimited · resets ${formatRelativeReset(q.resetsAt)}`
                      : `${q.remaining} of ${q.entitlement} left · resets ${formatRelativeReset(q.resetsAt)}`
                  }
                />
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

      <UsageMessage message={status.message} state={status.state} />

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
              <NotificationsGroup
                capWarning={config.capWarning}
                nudge={config.nudge}
                capHint='Notify when remaining Copilot quota drops to or below this level.'
                nudgeHint='Notify when at least this much quota is unused and the month resets within 30 minutes.'
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
        </>
      )}
    </UsageProviderPanel>
  );
};

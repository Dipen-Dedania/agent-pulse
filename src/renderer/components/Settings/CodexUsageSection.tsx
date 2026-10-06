import React from 'react';
import { CodexUsageSnapshot, CodexUsageStatus } from '../../../common/types';
import { codexWindowLabel, codexWindowPhrase } from '../../../common/codexWindows';
import { Badge, GlassToggle, Tooltip } from '../Shared';
import {
  UsageNotificationUI,
  UsageProviderPanel,
  QuotaBar,
  UsageBanner,
  UsageMessage,
  NotificationsGroup,
  PollIntervalInput,
  formatRelativeReset,
} from './usage/UsageShared';

export interface CodexUsageConfigUI {
  enabled: boolean;
  intervalMs: number;
  showSecondaryBar: boolean;
  capWarning: UsageNotificationUI;
  nudge: UsageNotificationUI;
}

interface Props {
  config: CodexUsageConfigUI;
  status: CodexUsageStatus;
  onChange: (partial: Partial<CodexUsageConfigUI>) => void;
  onRefresh: () => void;
}

const GRID_COLS = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'];

function creditsLine(snapshot: CodexUsageSnapshot): React.ReactNode {
  const c = snapshot.credits;
  if (!c) return null;
  let text: string;
  if (c.unlimited) text = 'Credits: unlimited';
  else if (c.hasCredits) text = c.balance != null ? `Credits: $${c.balance.toFixed(2)}` : 'Credits available';
  else text = 'No credits';
  return (
    <span className='text-xs text-muted'>
      {text}
      {c.overageLimitReached && <span className='text-warn'> · overage limit reached</span>}
    </span>
  );
}

function absoluteTime(ms: number): string {
  return new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

export const CodexUsageSection: React.FC<Props> = ({ config, status, onChange, onRefresh }) => {
  const snapshot = status.snapshot;
  const primaryLabel = codexWindowLabel(snapshot?.primary.windowSeconds, 'primary');
  const secondaryLabel = codexWindowLabel(snapshot?.secondary?.windowSeconds, 'secondary');
  const barCount = 1 + (snapshot?.secondary ? 1 : 0) + (snapshot?.review ? 1 : 0);
  const models = snapshot?.models ?? [];

  return (
    <UsageProviderPanel
      title='Codex Subscription Usage'
      subtitle={
        <>
          Tracks remaining quota in your ChatGPT/Codex 5-hour and weekly windows. Bars below the
          Codex bubble fill as an "opportunity gauge" — full means you've got headroom. Readings
          refresh live from running Codex sessions between polls.
        </>
      }
      state={status.state}
      enabled={config.enabled}
      onToggleEnabled={() => onChange({ enabled: !config.enabled })}
      toggleLabel='Toggle Codex usage tracking'
      onRefresh={onRefresh}
    >
      {/* Plan / credits / data-source strip */}
      {config.enabled && snapshot && (
        <div className='mt-4 flex flex-wrap items-center gap-2'>
          {snapshot.planType && (
            <Badge tone='info' variant='tag' uppercase size='xs'>
              {snapshot.planType} plan
            </Badge>
          )}
          {creditsLine(snapshot)}
          {snapshot.source && (
            <Tooltip
              content={
                snapshot.source === 'rollout'
                  ? 'Read live from the running Codex session. Falls back to the ChatGPT usage API when Codex goes quiet.'
                  : 'Read from the ChatGPT usage API on the poll interval below.'
              }
            >
              <span className='ml-auto'>
                <Badge tone='neutral' variant='pill' dot size='xs'>
                  {snapshot.source === 'rollout' ? 'via session' : 'via API'}
                </Badge>
              </span>
            </Tooltip>
          )}
        </div>
      )}

      {/* Limit-reached banner — a hard stop, so it outranks the "% available" cards */}
      {config.enabled && snapshot?.limitReached && (
        <UsageBanner
          tone='danger'
          message={
            <>
              Limit reached
              {snapshot.spendControlReached
                ? ' (spend control)'
                : snapshot.limitReachedType
                  ? ` (${snapshot.limitReachedType})`
                  : ''}
              . {primaryLabel} window resets {formatRelativeReset(snapshot.primary.resetsAt)}.
            </>
          }
        />
      )}

      {/* Current snapshot — shows REMAINING credit to match bar semantics */}
      {config.enabled && (
        <div className={`mt-5 grid gap-4 ${GRID_COLS[barCount]}`}>
          <QuotaBar
            label={`${primaryLabel} window`}
            remaining={snapshot ? 100 - snapshot.primary.utilization : null}
            sub={`Resets ${formatRelativeReset(snapshot?.primary.resetsAt)}`}
          />
          {snapshot?.secondary && (
            <QuotaBar
              label={`${secondaryLabel} window`}
              remaining={100 - snapshot.secondary.utilization}
              sub={`Resets ${formatRelativeReset(snapshot.secondary.resetsAt)}`}
            />
          )}
          {snapshot?.review && (
            <QuotaBar
              label='Code review'
              remaining={100 - snapshot.review.utilization}
              sub={
                snapshot.review.windowSeconds
                  ? `${codexWindowLabel(snapshot.review.windowSeconds, 'primary')} window · resets ${formatRelativeReset(snapshot.review.resetsAt)}`
                  : `Resets ${formatRelativeReset(snapshot.review.resetsAt)}`
              }
            />
          )}
        </div>
      )}

      {/* Per-model availability (HTTP poll only — rollouts don't carry it) */}
      {config.enabled && models.length > 0 && (
        <div className='mt-5 flex flex-col gap-2'>
          <p className='text-xs uppercase tracking-widest text-faint font-semibold'>Models</p>
          <div className='glass-secondary divide-y divide-edge/40'>
            {models.map((m) => (
              <div key={m.model} className='flex items-center gap-3 px-3 py-2.5'>
                <p className='flex-1 min-w-0 text-sm font-medium text-strong truncate font-mono'>{m.model}</p>
                {m.available ? (
                  <Badge tone='ok' variant='pill' dot size='xs'>Available</Badge>
                ) : (
                  <Tooltip
                    content={
                      <>
                        {m.availableAt ? `Back ${absoluteTime(m.availableAt)}.` : 'No return time reported.'}
                        {m.creditsWouldEnable ? ' Buying credits would unlock it now.' : ''}
                      </>
                    }
                  >
                    <span>
                      <Badge tone='warn' variant='pill' dot size='xs'>
                        {m.availableAt ? `Returns ${formatRelativeReset(m.availableAt)}` : 'Unavailable'}
                      </Badge>
                    </span>
                  </Tooltip>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <UsageMessage message={status.message} state={status.state} />

      {config.enabled && (
        <div className='glass-secondary mt-5 p-4 flex items-start gap-3'>
          <div className='flex-1 min-w-0'>
            <p className='font-medium text-strong text-sm leading-tight'>
              Show {codexWindowPhrase(snapshot?.secondary?.windowSeconds, 'secondary')} bar on bubble
            </p>
            <p className='text-xs text-muted mt-1'>
              Hide to keep the bubble focused on the {codexWindowPhrase(snapshot?.primary.windowSeconds, 'primary')} window only.
              Both windows are still tracked.
            </p>
          </div>
          <GlassToggle
            checked={config.showSecondaryBar}
            onChange={() => onChange({ showSecondaryBar: !config.showSecondaryBar })}
            size='md'
            label='Toggle secondary window bar on bubble'
          />
        </div>
      )}

      {config.enabled && (
        <>
          <NotificationsGroup
            capWarning={config.capWarning}
            nudge={config.nudge}
            capHint='Notify when remaining Codex credit drops to or below this level. Also notifies when Codex reports a limit reached.'
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

import React from 'react';
import { ClaudeExtraUsage, UsageStatus } from '../../../common/types';
import { Badge, GlassToggle, SettingRow, Tooltip } from '../Shared';
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

// 2 fixed windows + up to N per-model weekly caps. Cap at 3 columns so a
// third/fourth bar wraps instead of squeezing the headline numbers.
const GRID_COLS = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'];

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/**
 * One-line credits summary, mirroring the Codex panel's `creditsLine`.
 * Team/Enterprise seats are org-paid: used shows, balance/limit stay null.
 */
function extraUsageLine(x: ClaudeExtraUsage): React.ReactNode {
  if (!x.enabled) {
    return (
      <span className='text-xs text-muted'>
        Extra usage: off{x.userDisabled ? ' (turned off by you)' : ''}
      </span>
    );
  }
  const parts: string[] = [];
  if (x.usedCredits != null) {
    parts.push(
      x.monthlyLimit != null
        ? `${formatMoney(x.usedCredits, x.currency)} of ${formatMoney(x.monthlyLimit, x.currency)} used`
        : `${formatMoney(x.usedCredits, x.currency)} used`,
    );
  } else if (x.utilization != null) {
    parts.push(`${Math.round(x.utilization)}% of limit used`);
  }
  if (x.balance != null) parts.push(`${formatMoney(x.balance, x.currency)} balance`);
  const text = parts.length > 0 ? `Extra usage: ${parts.join(' · ')}` : 'Extra usage: on';
  return (
    <Tooltip
      content={
        <>
          Pay-as-you-go credits that cover you once a plan window hits 100%.
          {x.balance == null && x.monthlyLimit == null
            ? ' Your organization pays centrally, so no personal balance or cap is reported.'
            : ''}
        </>
      }
    >
      <span className='text-xs text-muted'>
        {text}
        {x.spendLimitReached && <span className='text-warn'> · spend limit reached</span>}
      </span>
    </Tooltip>
  );
}

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
  const scoped = snapshot?.scopedLimits ?? [];
  const barCount = 2 + scoped.length;
  const gridCols = GRID_COLS[Math.min(barCount, GRID_COLS.length - 1)];

  return (
    <UsageProviderPanel
      title='Claude Subscription Usage'
      subtitle={
        <>
          Tracks remaining credit in the 5-hour and 7-day windows, plus any per-model weekly cap
          and your extra-usage credits. Bars below the Claude bubble fill as an "opportunity
          gauge" — full means you've got headroom.
        </>
      }
      state={status.state}
      enabled={config.enabled}
      onToggleEnabled={() => onChange({ enabled: !config.enabled })}
      toggleLabel='Toggle usage tracking'
      onRefresh={onRefresh}
    >
      {/* Plan / extra-usage credits strip (HTTP poll only — statusline pushes
          don't carry these, the poller carries the last polled values forward) */}
      {config.enabled && snapshot && (snapshot.planType || snapshot.extraUsage) && (
        <div className='mt-4 flex flex-wrap items-center gap-2'>
          {snapshot.planType && (
            <Badge tone='info' variant='tag' uppercase size='xs'>
              {snapshot.planType} plan
            </Badge>
          )}
          {snapshot.extraUsage && extraUsageLine(snapshot.extraUsage)}
        </div>
      )}

      {/* Spend-limit-reached is a hard stop on extra usage — outranks the bars */}
      {config.enabled && snapshot?.extraUsage?.spendLimitReached && (
        <UsageBanner
          tone='danger'
          message={
            <>
              Extra usage spend limit reached. Plan windows still apply — 5-hour window resets{' '}
              {formatRelativeReset(snapshot.fiveHour.resetsAt)}.
            </>
          }
        />
      )}

      {/* Current snapshot — shows REMAINING credit to match bar semantics */}
      {config.enabled && (
        <div className={`mt-5 grid gap-4 ${gridCols}`}>
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
          {scoped.map((lim) => (
            <QuotaBar
              key={lim.label}
              label={`7-day · ${lim.label}`}
              remaining={100 - lim.utilization}
              sub={`Resets ${formatRelativeReset(lim.resetsAt)}`}
            />
          ))}
        </div>
      )}

      <UsageMessage message={status.message} state={status.state} />

      {config.enabled && (
        <SettingRow
          className='mt-5'
          title='Show 7-day bar on bubble'
          description='Hide to keep the bubble focused on the 5-hour window only. The 7-day window is still tracked.'
          control={
            <GlassToggle
              checked={config.showSevenDayBar}
              onChange={() => onChange({ showSevenDayBar: !config.showSevenDayBar })}
              size='md'
              label='Toggle 7-day bar on bubble'
            />
          }
        />
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

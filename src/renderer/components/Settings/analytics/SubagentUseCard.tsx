import React, { useMemo } from 'react';
import { SubagentDayBucket } from '../../../../common/timeline-types';
import { AnimatedNumber } from '../../Shared';
import { useSubagentUse } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoTooltip, SkeletonLine, formatCompactNumber, useChartTip } from './shared';
import { ACTIVITY_EMPTY, AgentRow, DayAxis, StatTile, rollupDays } from './activityShared';

const NOTE =
  'A launch is one time an agent handed work to a subagent, read from Claude Code and ChatGPT (Codex) session ' +
  'files. Automated runs such as backlog cards are included. ChatGPT (Codex) auto-reviews are its automatic approval reviewer: it starts them itself, so they ' +
  'are shown separately and never counted as launches.';

const mergeDays = (chunk: SubagentDayBucket[]): SubagentDayBucket => ({
  date: chunk[0].date,
  launches: chunk.reduce((s, b) => s + b.launches, 0),
});

export const SubagentUseCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useSubagentUse(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  const { buckets, weekly } = useMemo(() => rollupDays(data?.byDay ?? [], mergeDays), [data]);
  const maxLaunches = useMemo(() => buckets.reduce((m, b) => Math.max(m, b.launches), 0), [buckets]);
  const sessionShare = data && data.sessions > 0 ? (data.sessionsWithSubagents / data.sessions) * 100 : 0;

  return (
    <Card
      title='Subagent use'
      subtitle='How often your agents delegate work to subagents.'
      right={
        <InfoTooltip label='How this is counted'>
          <span className='text-[11px] text-body leading-snug'>{NOTE}</span>
        </InfoTooltip>
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='8rem' />
      ) : !data || data.sessions === 0 ? (
        <EmptyState message={ACTIVITY_EMPTY} />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-3 gap-3'>
            <StatTile label='Launches' sub='subagents started'>
              <AnimatedNumber value={data.launches} format={formatCompactNumber} />
            </StatTile>
            <StatTile label='Sessions using them' sub={`${data.sessionsWithSubagents} of ${data.sessions} sessions`}>
              <AnimatedNumber value={sessionShare} format={(n) => `${n.toFixed(0)}%`} />
            </StatTile>
            <StatTile label='ChatGPT (Codex) auto-reviews' sub='not counted as launches'>
              <AnimatedNumber value={data.autoReviews} format={formatCompactNumber} />
            </StatTile>
          </div>

          {data.launches > 0 ? (
            <div>
              <div className='flex items-end gap-[3px] h-20'>
                {buckets.map((b) => {
                  const pct = b.launches > 0 && maxLaunches > 0 ? Math.max(8, (b.launches / maxLaunches) * 100) : 0;
                  const label = weekly ? `week of ${b.date}` : b.date;
                  return (
                    <div
                      key={b.date}
                      className={`flex-1 rounded-t transition-colors ${
                        b.launches > 0 ? 'bg-pink-500/45 hover:bg-pink-400/70' : 'bg-inset/40'
                      }`}
                      style={{ height: b.launches > 0 ? `${pct}%` : '2px' }}
                      {...tipHandlers(
                        <span>
                          <span className='font-semibold text-strong'>{b.launches} {b.launches === 1 ? 'launch' : 'launches'}</span>
                          <span className='text-muted'> · {label}</span>
                        </span>,
                      )}
                    />
                  );
                })}
              </div>
              <DayAxis dates={buckets.map((b) => b.date)} />
            </div>
          ) : (
            <p className='text-xs text-muted'>No subagents launched in this window.</p>
          )}

          <div className='space-y-1.5'>
            {data.agents.map((a) => (
              <AgentRow key={a.toolId} toolId={a.toolId}>
                {a.autoReviews > 0 && (
                  <span className='text-faint font-mono tabular-nums shrink-0'>{formatCompactNumber(a.autoReviews)} auto-reviews</span>
                )}
                <span className='text-muted font-mono tabular-nums shrink-0'>
                  {a.sessionsWithSubagents}/{a.sessions} sessions
                </span>
                <span className='text-primary font-mono tabular-nums shrink-0 w-24 text-right'>
                  {formatCompactNumber(a.launches)} <span className='text-faint'>{a.launches === 1 ? 'launch' : 'launches'}</span>
                </span>
              </AgentRow>
            ))}
          </div>
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

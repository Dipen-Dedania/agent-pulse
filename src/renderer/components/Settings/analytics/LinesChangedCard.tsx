import React, { useMemo } from 'react';
import { LinesChangedDayBucket } from '../../../../common/timeline-types';
import { AnimatedNumber } from '../../Shared';
import { useLinesChanged } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoTooltip, SkeletonLine, formatCompactNumber, useChartTip } from './shared';
import { ACTIVITY_EMPTY, AgentRow, DayAxis, StatTile, rollupDays } from './activityShared';

const NOTE =
  'Lines written and removed by your agents’ own edit calls, read from Claude Code and Codex session ' +
  'files. Your manual edits and anything a shell command changed are not included. A new file counts ' +
  'as all lines added.';

const mergeDays = (chunk: LinesChangedDayBucket[]): LinesChangedDayBucket => ({
  date: chunk[0].date,
  added: chunk.reduce((s, b) => s + b.added, 0),
  removed: chunk.reduce((s, b) => s + b.removed, 0),
});

export const LinesChangedCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useLinesChanged(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  const { buckets, weekly } = useMemo(() => rollupDays(data?.byDay ?? [], mergeDays), [data]);
  // Added and removed share one scale, so the bars above and below the
  // baseline are directly comparable.
  const maxLines = useMemo(() => buckets.reduce((m, b) => Math.max(m, b.added, b.removed), 0), [buckets]);

  return (
    <Card
      title='Lines changed'
      subtitle='What your agents’ edits added and removed.'
      right={
        <InfoTooltip label='How this is counted'>
          <span className='text-[11px] text-body leading-snug'>{NOTE}</span>
        </InfoTooltip>
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='9rem' />
      ) : !data || data.edits === 0 ? (
        <EmptyState message={ACTIVITY_EMPTY} />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-3 gap-3'>
            <StatTile label='Added' valueClass='text-ok' sub='lines'>
              +<AnimatedNumber value={data.added} format={formatCompactNumber} />
            </StatTile>
            <StatTile label='Removed' valueClass='text-danger' sub='lines'>
              −<AnimatedNumber value={data.removed} format={formatCompactNumber} />
            </StatTile>
            <StatTile label='Edits' sub={`${Math.round((data.added + data.removed) / data.edits)} lines per edit`}>
              <AnimatedNumber value={data.edits} format={formatCompactNumber} />
            </StatTile>
          </div>

          {/* Added grows up from the baseline, removed grows down */}
          <div>
            <div className='flex gap-[3px] h-28'>
              {buckets.map((b) => {
                const up = maxLines > 0 && b.added > 0 ? Math.max(4, (b.added / maxLines) * 100) : 0;
                const down = maxLines > 0 && b.removed > 0 ? Math.max(4, (b.removed / maxLines) * 100) : 0;
                const label = weekly ? `week of ${b.date}` : b.date;
                return (
                  <div
                    key={b.date}
                    className='flex-1 flex flex-col group'
                    {...tipHandlers(
                      <span>
                        <span className='font-semibold text-strong'>+{b.added.toLocaleString()} −{b.removed.toLocaleString()}</span>
                        <span className='text-muted'> · {label}</span>
                      </span>,
                    )}
                  >
                    <div className='flex-1 flex items-end'>
                      <div
                        className={`w-full rounded-t transition-colors ${b.added > 0 ? 'bg-emerald-500/50 group-hover:bg-emerald-400/75' : 'bg-inset/40'}`}
                        style={{ height: b.added > 0 ? `${up}%` : '1px' }}
                      />
                    </div>
                    <div className='flex-1 flex items-start'>
                      <div
                        className={`w-full rounded-b transition-colors ${b.removed > 0 ? 'bg-rose-500/50 group-hover:bg-rose-400/75' : 'bg-inset/40'}`}
                        style={{ height: b.removed > 0 ? `${down}%` : '1px' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <DayAxis dates={buckets.map((b) => b.date)} />
          </div>

          <div className='space-y-1.5'>
            {data.agents.map((a) => (
              <AgentRow key={a.toolId} toolId={a.toolId}>
                <span className='text-muted font-mono tabular-nums shrink-0'>{formatCompactNumber(a.edits)} edits</span>
                <span className='text-ok font-mono tabular-nums shrink-0 w-16 text-right'>+{formatCompactNumber(a.added)}</span>
                <span className='text-danger font-mono tabular-nums shrink-0 w-14 text-right'>−{formatCompactNumber(a.removed)}</span>
              </AgentRow>
            ))}
          </div>
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

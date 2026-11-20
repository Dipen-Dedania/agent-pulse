import React, { useMemo } from 'react';
import { CompactionsDayBucket } from '../../../../common/timeline-types';
import { AnimatedNumber } from '../../Shared';
import { useCompactions } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoTooltip, SkeletonLine, formatCompactNumber, useChartTip } from './shared';
import { ACTIVITY_EMPTY, AgentRow, DayAxis, StatTile, rollupDays } from './activityShared';

const NOTE =
  'A compaction is when a conversation outgrows its context window and is replaced by a summary. ' +
  'Manual means you ran the compact command; auto means the agent did it on its own. Claude Code ' +
  'records which it was. Codex does not, so for Codex it is inferred: a compaction that is the only ' +
  'thing in its turn counts as manual. Context size is reported by Claude Code only. Compactions ' +
  'inside subagents and Codex auto-reviews are not counted.';

const COLORS = { auto: '#fbbf24', manual: '#60a5fa', unknown: '#94a3b8' } as const;

const mergeDays = (chunk: CompactionsDayBucket[]): CompactionsDayBucket => ({
  date: chunk[0].date,
  auto: chunk.reduce((s, b) => s + b.auto, 0),
  manual: chunk.reduce((s, b) => s + b.manual, 0),
  unknown: chunk.reduce((s, b) => s + b.unknown, 0),
});

// 209880 → "210k"
const tokens = (n: number) => `${Math.round(n / 1000)}k`;

export const CompactionsCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useCompactions(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  const { buckets, weekly } = useMemo(() => rollupDays(data?.byDay ?? [], mergeDays), [data]);
  const maxDay = useMemo(() => buckets.reduce((m, b) => Math.max(m, b.auto + b.manual + b.unknown), 0), [buckets]);
  const sessionShare = data && data.sessions > 0 ? (data.sessionsCompacted / data.sessions) * 100 : 0;

  return (
    <Card
      title='Context compactions'
      subtitle='How often a conversation ran out of context, and who triggered the clean-up.'
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
          <div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
            <StatTile label='Compactions' sub={`in ${data.sessionsCompacted} of ${data.sessions} sessions (${sessionShare.toFixed(0)}%)`}>
              <AnimatedNumber value={data.total} format={formatCompactNumber} />
            </StatTile>
            <StatTile label='Auto' sub='the agent ran out of room'>
              <AnimatedNumber value={data.auto} format={formatCompactNumber} />
            </StatTile>
            <StatTile label='Manual' sub='you ran compact'>
              <AnimatedNumber value={data.manual} format={formatCompactNumber} />
            </StatTile>
            <StatTile label='Typical size before' sub='tokens, Claude Code only'>
              {data.medianTokensBefore === null ? '—' : tokens(data.medianTokensBefore)}
            </StatTile>
          </div>

          {data.total > 0 ? (
            <div>
              <div className='flex items-end gap-[3px] h-20'>
                {buckets.map((b) => {
                  const dayTotal = b.auto + b.manual + b.unknown;
                  const pct = dayTotal > 0 && maxDay > 0 ? Math.max(8, (dayTotal / maxDay) * 100) : 0;
                  const label = weekly ? `week of ${b.date}` : b.date;
                  const parts = (['auto', 'manual', 'unknown'] as const).filter((k) => b[k] > 0);
                  return (
                    <div
                      key={b.date}
                      className={`flex-1 flex flex-col-reverse rounded-t overflow-hidden ${dayTotal > 0 ? '' : 'bg-inset/40'}`}
                      style={{ height: dayTotal > 0 ? `${pct}%` : '2px' }}
                      {...tipHandlers(
                        <span>
                          <span className='font-semibold text-strong'>
                            {dayTotal === 0 ? 'none' : parts.map((k) => `${b[k]} ${k}`).join(' · ')}
                          </span>
                          <span className='text-muted'> · {label}</span>
                        </span>,
                      )}
                    >
                      {parts.map((k) => (
                        <div key={k} style={{ flexGrow: b[k], backgroundColor: COLORS[k], opacity: 0.6 }} />
                      ))}
                    </div>
                  );
                })}
              </div>
              <DayAxis dates={buckets.map((b) => b.date)} />
              <div className='flex items-center gap-4 mt-2 text-[11px] text-muted'>
                {(['auto', 'manual', 'unknown'] as const)
                  .filter((k) => k !== 'unknown' || data.unknown > 0)
                  .map((k) => (
                    <span key={k} className='inline-flex items-center gap-1.5'>
                      <span className='w-2.5 h-2.5 rounded-sm' style={{ backgroundColor: COLORS[k], opacity: 0.6 }} />
                      {k === 'unknown' ? 'Unclear' : k === 'auto' ? 'Auto' : 'Manual'}
                    </span>
                  ))}
              </div>
            </div>
          ) : (
            <p className='text-xs text-muted'>No compactions in this window.</p>
          )}

          <div className='space-y-1.5'>
            {data.agents.map((a) => (
              <AgentRow key={a.toolId} toolId={a.toolId}>
                <span className='text-faint font-mono tabular-nums shrink-0'>
                  {a.sessionsCompacted}/{a.sessions} sessions
                </span>
                <span className='text-muted font-mono tabular-nums shrink-0 w-20 text-right'>{a.manual} manual</span>
                <span className='text-primary font-mono tabular-nums shrink-0 w-16 text-right'>{a.auto} auto</span>
              </AgentRow>
            ))}
          </div>
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

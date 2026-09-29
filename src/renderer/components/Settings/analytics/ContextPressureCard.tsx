import React, { useMemo } from 'react';
import { ContextPressureDayBucket } from '../../../../common/timeline-types';
import { AnimatedNumber, Meter } from '../../Shared';
import { useContextPressure } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoPill, SkeletonLine, useChartTip } from './shared';

function fillClassFor(usedPct: number): string {
  if (usedPct >= 80) return 'bg-red-500';
  if (usedPct >= 50) return 'bg-amber-500';
  return 'bg-emerald-500';
}

// Weekly rollup for long ranges — same readability guard as the other
// day-bucketed cards; max is a max-of-maxes, avg an average of day-averages.
function rollup(byDay: ContextPressureDayBucket[]): { buckets: ContextPressureDayBucket[]; weekly: boolean } {
  if (byDay.length <= 60) return { buckets: byDay, weekly: false };
  const weeks: ContextPressureDayBucket[] = [];
  for (let i = 0; i < byDay.length; i += 7) {
    const chunk = byDay.slice(i, i + 7);
    const withData = chunk.filter((b) => b.avgUsedPct !== null);
    weeks.push({
      date: chunk[0].date,
      avgUsedPct: withData.length
        ? withData.reduce((s, b) => s + (b.avgUsedPct ?? 0), 0) / withData.length
        : null,
      maxUsedPct: withData.length
        ? Math.max(...withData.map((b) => b.maxUsedPct ?? 0))
        : null,
    });
  }
  return { buckets: weeks, weekly: true };
}

export const ContextPressureCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useContextPressure(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  const { buckets, weekly } = useMemo(() => rollup(data?.byDay ?? []), [data]);
  const hasSeries = useMemo(() => buckets.some((b) => b.maxUsedPct !== null), [buckets]);

  return (
    <Card
      title='Context pressure'
      subtitle='How full each Claude Code session’s context window is, from the status line.'
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='7rem' />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState message='No status-line data yet — install the Agent Pulse status line in Settings, then run a Claude Code turn.' />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='glass-secondary p-3'>
              <p className='text-[11px] uppercase tracking-wider text-faint mb-1'>Avg context used</p>
              <p className='text-xl font-semibold text-primary font-mono tabular-nums'>
                {data.avgUsedPct === null
                  ? '—'
                  : <AnimatedNumber value={data.avgUsedPct} format={(n) => `${n.toFixed(0)}%`} />}
              </p>
              <p className='text-[11px] text-muted mt-0.5'>latest per session</p>
            </div>
            <div className='glass-secondary p-3'>
              <p className='text-[11px] uppercase tracking-wider text-faint mb-1'>Near the limit</p>
              <div className='flex items-center gap-2'>
                <p className={`text-xl font-semibold font-mono tabular-nums ${data.highPressureSessions > 0 ? 'text-warn' : 'text-primary'}`}>
                  <AnimatedNumber value={data.highPressureSessions} format={(n) => Math.round(n).toString()} />
                </p>
                {data.highPressureSessions > 0 && <InfoPill tone='warn'>≥80% full</InfoPill>}
              </div>
              <p className='text-[11px] text-muted mt-0.5'>
                {data.highPressureSessions === 1 ? 'session' : 'sessions'} under compaction pressure
              </p>
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            {data.rows.slice(0, 5).map((r) => (
              <div key={r.sessionId} className='glass-secondary p-3'>
                <div className='flex items-center gap-2 mb-2'>
                  <p className='text-xs font-mono text-primary flex-1 truncate'>{r.sessionId.slice(0, 8)}</p>
                  {r.model && <p className='text-[11px] text-muted truncate max-w-[40%]'>{r.model}</p>}
                  <p className='text-xs font-mono tabular-nums text-body shrink-0'>{r.usedPct.toFixed(0)}%</p>
                </div>
                <Meter
                  value={r.usedPct}
                  animate
                  trackClass='bg-glass/60'
                  fillClass={fillClassFor(r.usedPct)}
                />
              </div>
            ))}
          </div>

          {hasSeries && (
            <div>
              <div className='flex items-end gap-[3px] h-16'>
                {buckets.map((b) => {
                  const max = b.maxUsedPct;
                  const pct = max === null ? 0 : Math.max(8, max);
                  const label = weekly ? `week of ${b.date}` : b.date;
                  return (
                    <div
                      key={b.date}
                      className={`flex-1 rounded-t transition-colors ${
                        max === null
                          ? 'bg-inset/40'
                          : max >= 80
                            ? 'bg-red-500/45 hover:bg-red-400/70'
                            : 'bg-sky-500/45 hover:bg-sky-400/70'
                      }`}
                      style={{ height: max !== null ? `${pct}%` : '2px' }}
                      {...tipHandlers(
                        <span>
                          <span className='font-semibold text-strong'>
                            {max === null
                              ? 'no samples'
                              : `peak ${max.toFixed(0)}%${b.avgUsedPct !== null ? ` · avg ${b.avgUsedPct.toFixed(0)}%` : ''}`}
                          </span>
                          <span className='text-muted'> · {label}</span>
                        </span>,
                      )}
                    />
                  );
                })}
              </div>
              {tipOverlay}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

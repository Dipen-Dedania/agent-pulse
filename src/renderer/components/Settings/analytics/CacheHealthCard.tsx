import React, { useMemo } from 'react';
import { CacheHealthDayBucket } from '../../../../common/timeline-types';
import { AnimatedNumber, Meter } from '../../Shared';
import { useCacheHealth } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoPill, SkeletonLine, useChartTip } from './shared';

// Long ranges (90d/1y) have too many days for one bar each — roll up to weekly
// averages, same readability guard LimitHitsCard uses.
function rollup(byDay: CacheHealthDayBucket[]): { buckets: CacheHealthDayBucket[]; weekly: boolean } {
  if (byDay.length <= 60) return { buckets: byDay, weekly: false };
  const weeks: CacheHealthDayBucket[] = [];
  for (let i = 0; i < byDay.length; i += 7) {
    const chunk = byDay.slice(i, i + 7);
    const withData = chunk.filter((b) => b.avgHitRatio !== null);
    weeks.push({
      date: chunk[0].date,
      avgHitRatio: withData.length
        ? withData.reduce((s, b) => s + (b.avgHitRatio ?? 0), 0) / withData.length
        : null,
      samples: chunk.reduce((s, b) => s + b.samples, 0),
    });
  }
  return { buckets: weeks, weekly: true };
}

export const CacheHealthCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useCacheHealth(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  const { buckets, weekly } = useMemo(() => rollup(data?.byDay ?? []), [data]);
  const hasSeries = useMemo(() => buckets.some((b) => b.avgHitRatio !== null), [buckets]);

  return (
    <Card
      title='Prompt cache health'
      subtitle='Live from the Claude Code status line: hit ratio, warm/cold, cold rebuilds.'
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='7rem' />
      ) : !data || data.sessions === 0 ? (
        <EmptyState message='No status-line data yet — install the Agent Pulse status line in Settings, then run a Claude Code turn.' />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='glass-secondary p-3'>
              <p className='text-[11px] uppercase tracking-wider text-faint mb-1'>Avg hit ratio</p>
              <p className='text-xl font-semibold text-primary font-mono tabular-nums'>
                {data.avgHitRatio === null
                  ? '—'
                  : <AnimatedNumber value={data.avgHitRatio * 100} format={(n) => `${n.toFixed(0)}%`} />}
              </p>
              <p className='text-[11px] text-muted mt-0.5'>
                across {data.sessions} {data.sessions === 1 ? 'session' : 'sessions'}
              </p>
            </div>
            <div className='glass-secondary p-3'>
              <p className='text-[11px] uppercase tracking-wider text-faint mb-1'>Cache state</p>
              <div className='flex items-center gap-2'>
                {data.warmPct === null ? (
                  <p className='text-xl font-semibold text-primary font-mono tabular-nums'>—</p>
                ) : data.warmPct >= 50 ? (
                  <p className='text-xl font-semibold text-ok font-mono tabular-nums'>
                    <AnimatedNumber value={data.warmPct} format={(n) => `${n.toFixed(0)}%`} /> warm
                  </p>
                ) : (
                  <InfoPill tone='warn'>{data.warmPct.toFixed(0)}% warm</InfoPill>
                )}
              </div>
              <p className='text-[11px] text-muted mt-0.5'>
                {data.totalMisses} cold {data.totalMisses === 1 ? 'rebuild' : 'rebuilds'}
              </p>
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            {data.rows.filter((r) => r.hitRatio !== null).slice(0, 5).map((r) => (
              <div key={r.sessionId} className='glass-secondary p-3'>
                <div className='flex items-center gap-2 mb-2'>
                  <p className='text-xs font-mono text-primary flex-1 truncate'>{r.sessionId.slice(0, 8)}</p>
                  {r.model && <p className='text-[11px] text-muted truncate max-w-[40%]'>{r.model}</p>}
                  {r.warm === false && <InfoPill tone='warn'>cold</InfoPill>}
                </div>
                <Meter
                  value={(r.hitRatio ?? 0) * 100}
                  animate
                  trackClass='bg-glass/60'
                  fillClass='bg-emerald-500'
                />
                <p className='text-[11px] text-muted font-mono tabular-nums mt-1.5'>
                  {((r.hitRatio ?? 0) * 100).toFixed(0)}% hit ratio
                  {r.misses !== null && <span> · {r.misses} {r.misses === 1 ? 'miss' : 'misses'}</span>}
                </p>
              </div>
            ))}
          </div>

          {hasSeries && (
            <div>
              <div className='flex items-end gap-[3px] h-16'>
                {buckets.map((b) => {
                  const pct = b.avgHitRatio === null ? 0 : Math.max(8, b.avgHitRatio * 100);
                  const label = weekly ? `week of ${b.date}` : b.date;
                  return (
                    <div
                      key={b.date}
                      className={`flex-1 rounded-t transition-colors ${
                        b.avgHitRatio !== null ? 'bg-emerald-500/45 hover:bg-emerald-400/70' : 'bg-inset/40'
                      }`}
                      style={{ height: b.avgHitRatio !== null ? `${pct}%` : '2px' }}
                      {...tipHandlers(
                        <span>
                          <span className='font-semibold text-strong'>
                            {b.avgHitRatio === null ? 'no samples' : `${(b.avgHitRatio * 100).toFixed(0)}% avg`}
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

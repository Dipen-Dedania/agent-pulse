import React, { useMemo } from 'react';
import { LimitHitDayBucket, LimitHitKind } from '../../../../common/timeline-types';
import { AnimatedNumber } from '../../Shared';
import { useLimitHits } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoPill, SkeletonLine, useChartTip } from './shared';

const KIND_LABEL: Record<LimitHitKind, string> = {
  session: '5-hour',
  weekly: 'Weekly',
  usage: 'Usage',
  other: 'Other',
};

// "3 days ago" / "today" / "5 hours ago" — coarse relative time for the
// last-hit line. Kept simple; the exact timestamp lives in the bar tooltips.
function relativeFromNow(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

// Long ranges (90d/1y) have too many days to show one bar each, so roll them
// up to weeks — same readability guard TokensTimelineCard uses.
function rollup(byDay: LimitHitDayBucket[]): { buckets: LimitHitDayBucket[]; weekly: boolean } {
  if (byDay.length <= 60) return { buckets: byDay, weekly: false };
  const weeks: LimitHitDayBucket[] = [];
  for (let i = 0; i < byDay.length; i += 7) {
    const chunk = byDay.slice(i, i + 7);
    weeks.push({ date: chunk[0].date, count: chunk.reduce((s, b) => s + b.count, 0) });
  }
  return { buckets: weeks, weekly: true };
}

export const LimitHitsCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useLimitHits(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  const { buckets, weekly } = useMemo(() => rollup(data?.byDay ?? []), [data]);
  const maxCount = useMemo(() => buckets.reduce((m, b) => Math.max(m, b.count), 0), [buckets]);

  const axisLabels = buckets.length > 1
    ? [buckets[0], buckets[Math.floor((buckets.length - 1) / 2)], buckets[buckets.length - 1]]
    : [];

  return (
    <Card
      title='Session limits hit'
      subtitle="How often Claude Code told you you'd hit a usage limit — counted from the transcript, not estimated."
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='7rem' />
      ) : !data || data.total === 0 ? (
        <EmptyState
          message={
            data?.lastHitAt
              ? `No limits hit in this window. Last hit ${relativeFromNow(data.lastHitAt, data.queriedAt)}.`
              : 'No usage limits hit in this window. Nice.'
          }
        />
      ) : (
        <div>
          <div className='mb-3 flex items-baseline gap-4'>
            <div>
              <p className='text-2xl font-semibold font-mono tabular-nums text-primary leading-none'>
                <AnimatedNumber value={data.total} format={(n) => Math.round(n).toString()} />
              </p>
              <p className='text-[11px] text-faint mt-1'>
                {data.total === 1 ? 'limit hit this window' : 'limits hit this window'}
              </p>
            </div>
            {data.lastHitAt && (
              <p className='text-[11px] text-muted'>
                last hit <span className='text-body'>{relativeFromNow(data.lastHitAt, data.queriedAt)}</span>
              </p>
            )}
          </div>

          {data.byKind.length > 0 && (
            <div className='flex flex-wrap gap-1.5 mb-4'>
              {data.byKind.map((k) => (
                <InfoPill key={k.kind} tone={k.kind === 'weekly' ? 'warn' : 'info'}>
                  {KIND_LABEL[k.kind]} · {k.count}
                </InfoPill>
              ))}
            </div>
          )}

          <div className='flex items-end gap-[3px] h-20'>
            {buckets.map((b) => {
              const pct = b.count > 0 && maxCount > 0 ? Math.max(8, (b.count / maxCount) * 100) : 0;
              const label = weekly ? `week of ${b.date}` : b.date;
              return (
                <div
                  key={b.date}
                  className={`flex-1 rounded-t transition-colors ${
                    b.count > 0 ? 'bg-amber-500/45 hover:bg-amber-400/70' : 'bg-inset/40'
                  }`}
                  style={{ height: b.count > 0 ? `${pct}%` : '2px' }}
                  {...tipHandlers(
                    <span>
                      <span className='font-semibold text-strong'>
                        {b.count} {b.count === 1 ? 'hit' : 'hits'}
                      </span>
                      <span className='text-muted'> · {label}</span>
                    </span>,
                  )}
                />
              );
            })}
          </div>
          {axisLabels.length > 0 && (
            <div className='flex justify-between mt-1 text-[10px] text-faint font-mono'>
              {axisLabels.map((l, i) => <span key={`${l.date}-${i}`}>{l.date}</span>)}
            </div>
          )}
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

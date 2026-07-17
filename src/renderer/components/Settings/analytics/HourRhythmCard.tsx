import React from 'react';
import { useHourRhythm } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, SkeletonLine, formatDuration, useChartTip } from './shared';

export const HourRhythmCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useHourRhythm(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  const max = data ? Math.max(...data.buckets, 1) : 1;
  const peakHour = data ? data.buckets.indexOf(Math.max(...data.buckets)) : 0;
  const hasData = data && data.buckets.some((b) => b > 0);

  return (
    <Card
      title='Hour-of-day rhythm'
      subtitle='When you actually pair with agents during the day.'
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='5rem' />
      ) : !hasData ? (
        <EmptyState message='No activity in this window.' />
      ) : (
        <div>
          {/* Peak annotation carries the scale the missing y-axis would. */}
          <p className='text-[11px] text-muted mb-1.5 font-mono tabular-nums'>
            peak <span className='text-primary'>{formatDuration(max)}</span> at {peakHour}:00
          </p>
          <div className='relative h-24'>
            {/* Recessive hairline at half the peak, for magnitude reading. */}
            <div className='absolute inset-x-0 top-1/2 h-px bg-control/50' />
            <div className='relative flex items-end gap-[3px] h-full'>
              {data.buckets.map((ms, hour) => {
                const pct = ms === 0 ? 0 : Math.max(4, (ms / max) * 100);
                return (
                  <div
                    key={hour}
                    className='flex-1 bg-blue-500/40 hover:bg-blue-400/70 rounded-t transition-colors'
                    style={{ height: `${pct}%` }}
                    {...tipHandlers(
                      <span>
                        <span className='font-semibold text-strong'>{formatDuration(ms)}</span>
                        <span className='text-muted'> · {hour}:00–{hour + 1}:00</span>
                      </span>,
                    )}
                  />
                );
              })}
            </div>
          </div>
          <div className='flex justify-between mt-1.5 text-[10px] text-faint font-mono'>
            <span>0</span>
            <span>6</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

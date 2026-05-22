import React, { useState } from 'react';
import { useHourRhythm } from './useAnalytics';
import { Card, EmptyState, Segmented, SkeletonLine, formatDuration } from './shared';

export const HourRhythmCard: React.FC = () => {
  const [range, setRange] = useState<'7d' | '30d'>('30d');
  const { data, loading } = useHourRhythm(range);

  const max = data ? Math.max(...data.buckets, 1) : 1;
  const hasData = data && data.buckets.some((b) => b > 0);

  return (
    <Card
      title='Hour-of-day rhythm'
      subtitle='When you actually pair with agents during the day.'
      right={
        <Segmented
          value={range}
          onChange={(v) => setRange(v as '7d' | '30d')}
          options={[
            { value: '7d',  label: '7d' },
            { value: '30d', label: '30d' },
          ]}
        />
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='5rem' />
      ) : !hasData ? (
        <EmptyState message='No activity in this window.' />
      ) : (
        <div>
          <div className='flex items-end gap-[3px] h-24'>
            {data.buckets.map((ms, hour) => {
              const pct = ms === 0 ? 0 : Math.max(4, (ms / max) * 100);
              return (
                <div
                  key={hour}
                  className='flex-1 bg-blue-500/40 hover:bg-blue-400/60 rounded-t transition-colors'
                  style={{ height: `${pct}%` }}
                  title={`${hour}:00 — ${formatDuration(ms)}`}
                />
              );
            })}
          </div>
          <div className='flex justify-between mt-1.5 text-[10px] text-slate-500 font-mono'>
            <span>0</span>
            <span>6</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
        </div>
      )}
    </Card>
  );
};

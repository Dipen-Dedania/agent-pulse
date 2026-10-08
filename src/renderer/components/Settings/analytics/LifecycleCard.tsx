import React from 'react';
import { AnimatedNumber, Eyebrow } from '../../Shared';
import { useLifecycle } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, SkeletonLine, formatSpan } from './shared';

const Stat: React.FC<{ label: string; value: number; format: (n: number) => string; hint?: string }> = ({
  label,
  value,
  format,
  hint,
}) => (
  <div className='glass-secondary p-3'>
    <Eyebrow size='sm' className='mb-1'>{label}</Eyebrow>
    <p className='text-lg font-semibold text-primary font-mono tabular-nums'>
      <AnimatedNumber value={value} format={format} />
    </p>
    {hint && <p className='text-[11px] text-muted mt-0.5'>{hint}</p>}
  </div>
);

export const LifecycleCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useLifecycle(range);

  return (
    <Card title='Resume & lifecycle' subtitle='How often conversations get picked back up.'>
      {loading && !data ? (
        <SkeletonLine width='100%' height='5rem' />
      ) : !data || data.totalSessions === 0 ? (
        <EmptyState message='No sessions in this range yet.' />
      ) : (
        <div className='grid grid-cols-2 lg:grid-cols-3 gap-3'>
          <Stat
            label='Resume rate'
            value={data.resumeRatePct}
            format={(n) => `${n.toFixed(0)}%`}
            hint={`${data.resumedSessions} of ${data.totalSessions} sessions`}
          />
          <Stat label='Resumes / session' value={data.avgResumesPerSession} format={(n) => n.toFixed(2)} hint='avg' />
          <Stat label='Median resume gap' value={data.medianResumeIntervalMs} format={formatSpan} hint='when picked back up' />
          <Stat label='Avg lifespan' value={data.avgSpanMs} format={formatSpan} hint='first → last touch' />
          <Stat label='Avg active time' value={data.avgActiveMs} format={formatSpan} hint='engaged work' />
          <Stat
            label='Active density'
            value={data.densityPct}
            format={(n) => `${n.toFixed(0)}%`}
            hint='active vs lifespan'
          />
        </div>
      )}
    </Card>
  );
};

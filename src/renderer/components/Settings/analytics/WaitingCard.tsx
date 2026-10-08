import React from 'react';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { AnimatedNumber, Eyebrow, Meter } from '../../Shared';
import { useWaiting } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoPill, SkeletonLine, formatDuration } from './shared';

export const WaitingCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useWaiting(range);

  const maxWait = data ? Math.max(1, ...data.rows.map((r) => r.waitMs)) : 1;

  return (
    <Card
      title='Needs you'
      subtitle='Time agents sat blocked on a permission or prompt.'
      right={<InfoPill>Claude Code today</InfoPill>}
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='5rem' />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState message='No session activity in this range yet.' />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='glass-secondary p-3'>
              <Eyebrow size='sm' className='mb-1'>Total blocked</Eyebrow>
              <p className='text-xl font-semibold text-primary font-mono tabular-nums'>
                <AnimatedNumber value={data.totalWaitMs} format={formatDuration} />
              </p>
            </div>
            <div className='glass-secondary p-3'>
              <Eyebrow size='sm' className='mb-1'>Prompts answered</Eyebrow>
              <p className='text-xl font-semibold text-primary font-mono tabular-nums'>
                <AnimatedNumber value={data.totalEpisodes} format={(n) => Math.round(n).toLocaleString()} />
              </p>
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            {data.rows.map((r) => {
              const meta = TOOL_META[r.toolId as ToolId];
              return (
                <div key={r.toolId} className='glass-secondary p-3'>
                  <div className='flex items-center gap-2.5 mb-2'>
                    {meta && (
                      <div className='w-6 h-6 rounded-md bg-control/60 flex items-center justify-center shrink-0'>
                        <img src={meta.icon} alt={meta.label} className='w-4 h-4 object-contain' />
                      </div>
                    )}
                    <p className='text-sm font-medium text-primary flex-1 truncate'>{meta?.label ?? r.toolId}</p>
                    {!r.hasData ? (
                      <InfoPill tone='warn'>no data</InfoPill>
                    ) : (
                      <p className='text-xs text-body font-mono tabular-nums shrink-0'>
                        <AnimatedNumber value={r.waitMs} format={formatDuration} />
                      </p>
                    )}
                  </div>
                  {r.hasData && (
                    <>
                      <Meter
                        className='mb-2'
                        value={(r.waitMs / maxWait) * 100}
                        animate
                        trackClass='bg-glass/60'
                        fillClass='bg-amber-500'
                      />
                      <div className='flex items-center justify-between text-[11px] text-muted font-mono tabular-nums'>
                        <span>
                          {r.episodes} {r.episodes === 1 ? 'prompt' : 'prompts'} · avg{' '}
                          <AnimatedNumber value={r.avgWaitMs} format={formatDuration} />
                        </span>
                        <span>{r.pctOfActive.toFixed(1)}% of active</span>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
};

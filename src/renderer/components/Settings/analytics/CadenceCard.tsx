import React from 'react';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { AnimatedNumber, Eyebrow, Meter } from '../../Shared';
import { useCadence } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, SkeletonLine, formatShortDuration } from './shared';

const DEPTH_LABEL: Record<string, string> = {
  '1': '1 prompt',
  '2-3': '2–3',
  '4-9': '4–9',
  '10+': '10+',
};

export const CadenceCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useCadence(range);

  const maxDepth = data ? Math.max(1, ...data.depth.map((d) => d.count)) : 1;

  return (
    <Card title='Session cadence' subtitle='How fast you iterate, and how deep sessions go.'>
      {loading && !data ? (
        <SkeletonLine width='100%' height='6rem' />
      ) : !data || data.thinkSampleCount === 0 ? (
        <EmptyState message='No prompt cadence yet. Run a few multi-turn sessions to populate this.' />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='glass-secondary p-3'>
              <Eyebrow size='sm' className='mb-1'>Median think time</Eyebrow>
              <p className='text-xl font-semibold text-primary font-mono tabular-nums'>
                <AnimatedNumber value={data.overallMedianThinkMs} format={formatShortDuration} />
              </p>
              <p className='text-[11px] text-muted mt-0.5'>between prompts · capped at 5m</p>
            </div>
            <div className='glass-secondary p-3'>
              <Eyebrow size='sm' className='mb-1'>Prompts / session</Eyebrow>
              <p className='text-xl font-semibold text-primary font-mono tabular-nums'>
                <AnimatedNumber value={data.overallAvgPromptsPerSession} format={(n) => n.toFixed(1)} />
              </p>
              <p className='text-[11px] text-muted mt-0.5'>avg across sessions</p>
            </div>
          </div>

          <div>
            <Eyebrow size='sm' className='mb-2'>Session depth</Eyebrow>
            <div className='flex flex-col gap-1.5'>
              {data.depth.map((d) => (
                <div key={d.bucket} className='flex items-center gap-2'>
                  <span className='text-[11px] text-body w-16 shrink-0'>{DEPTH_LABEL[d.bucket] ?? d.bucket}</span>
                  <Meter
                    className='flex-1'
                    value={(d.count / maxDepth) * 100}
                    animate
                    trackClass='bg-glass/60'
                    fillClass='bg-blue-500'
                  />
                  <span className='text-[11px] text-muted font-mono tabular-nums w-10 text-right'>{d.count}</span>
                </div>
              ))}
            </div>
          </div>

          {data.rows.length > 1 && (
            <div>
              <Eyebrow size='sm' className='mb-2'>By tool</Eyebrow>
              <div className='flex flex-col gap-1.5'>
                {data.rows.map((r) => {
                  const meta = TOOL_META[r.toolId as ToolId];
                  return (
                    <div key={r.toolId} className='flex items-center gap-2 text-[11px]'>
                      {meta && <img src={meta.icon} alt={meta.label} className='w-4 h-4 object-contain shrink-0' />}
                      <span className='text-body flex-1 truncate'>{meta?.label ?? r.toolId}</span>
                      <span className='text-muted font-mono tabular-nums'>
                        <AnimatedNumber value={r.medianThinkMs} format={formatShortDuration} /> · {r.avgPromptsPerSession.toFixed(1)}/sess
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

import React from 'react';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { formatUsd } from '../../../../common/pricing';
import { AnimatedNumber, Meter } from '../../Shared';
import { useCacheEfficiency } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoPill, SkeletonLine, formatCompactNumber } from './shared';

export const CacheEfficiencyCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useCacheEfficiency(range);

  const hasAny = !!data && data.rows.some((r) => r.hasData);

  return (
    <Card title='Cache efficiency' subtitle='Input served from cache, and what it saved.'>
      {loading && !data ? (
        <SkeletonLine width='100%' height='5rem' />
      ) : !data || !hasAny ? (
        <EmptyState message='No cache data yet. Claude Code and Codex report cache usage.' />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-2 gap-3'>
            <div className='glass-secondary p-3'>
              <p className='text-[11px] uppercase tracking-wider text-faint mb-1'>Cache hit rate</p>
              <p className='text-xl font-semibold text-primary font-mono tabular-nums'>
                <AnimatedNumber value={data.overallHitRatio * 100} format={(n) => `${n.toFixed(0)}%`} />
              </p>
              <p className='text-[11px] text-muted mt-0.5'>of input tokens</p>
            </div>
            <div className='glass-secondary p-3'>
              <p className='text-[11px] uppercase tracking-wider text-faint mb-1'>Est. saved</p>
              <p className='text-xl font-semibold text-ok font-mono tabular-nums'>
                <AnimatedNumber value={data.totalSavedUsd} format={formatUsd} />
              </p>
              <p className='text-[11px] text-muted mt-0.5'>vs full input price</p>
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
                    ) : !r.priced ? (
                      <InfoPill tone='warn'>unpriced</InfoPill>
                    ) : (
                      <p className='text-xs text-ok font-mono tabular-nums shrink-0'>
                        <AnimatedNumber value={r.savedUsd} format={formatUsd} /> saved
                      </p>
                    )}
                  </div>
                  {r.hasData && (
                    <>
                      <Meter
                        className='mb-2'
                        value={r.hitRatio * 100}
                        animate
                        trackClass='bg-glass/60'
                        fillClass='bg-emerald-500'
                      />
                      <div className='flex items-center gap-1.5 text-[11px] text-muted font-mono tabular-nums'>
                        <span>{(r.hitRatio * 100).toFixed(0)}% cached ·</span>
                        <span>fresh <AnimatedNumber value={r.freshTokens} format={formatCompactNumber} className='text-primary' /></span>
                        <span>· cached <AnimatedNumber value={r.cachedTokens} format={formatCompactNumber} className='text-primary' /></span>
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

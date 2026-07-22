import React from 'react';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { AnimatedNumber, Tooltip } from '../../Shared';
import { useProjectBreakdown } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, SkeletonLine, formatCompactNumber, formatDuration } from './shared';

export const ProjectBreakdownCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useProjectBreakdown(range);

  return (
    <Card
      title='Project breakdown'
      subtitle='Active time per project (.git roots) across every agent.'
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='3rem' />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState message='No project-tagged activity yet. Install hooks and run agents inside a git repo.' />
      ) : (
        <div className='flex flex-col gap-1.5'>
          {data.rows.map((row) => (
            <div key={row.projectId} className='flex items-center gap-3 px-3 py-2 glass-secondary rounded-lg'>
              <div className='flex-1 min-w-0'>
                <Tooltip content={row.projectPath}>
                  <p className='text-sm font-medium text-primary truncate'>
                    {row.displayName}
                  </p>
                </Tooltip>
                <Tooltip content={row.projectPath}>
                  <p className='text-[10px] text-faint font-mono truncate'>
                    {row.projectPath}
                  </p>
                </Tooltip>
              </div>
              <div className='flex items-center gap-1 shrink-0'>
                {row.tools.map((tid) => {
                  const meta = TOOL_META[tid as ToolId];
                  if (!meta) return null;
                  return (
                    <Tooltip key={tid} content={meta.label}>
                      <div className='w-5 h-5 rounded-md bg-control/60 flex items-center justify-center'>
                        <img src={meta.icon} alt={meta.label} className='w-3.5 h-3.5 object-contain' />
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
              {(() => {
                const fresh = row.tokensIn + row.tokensOut;
                return (
                  <Tooltip content={`fresh in+out: ${fresh.toLocaleString()} · cache reads: ${row.cacheRead.toLocaleString()}`}>
                    <div
                      className='text-right shrink-0 w-20'
                    >
                      <p className='text-xs font-mono text-primary tabular-nums'>
                        {fresh > 0
                          ? <AnimatedNumber value={fresh} format={formatCompactNumber} />
                          : '—'}
                      </p>
                      <p className='text-[10px] text-faint'>tokens</p>
                    </div>
                  </Tooltip>
                );
              })()}
              <div className='text-right shrink-0 w-20'>
                {/* formatDuration output is non-numeric ("2h 15m") — left static */}
                <p className='text-xs font-mono text-primary tabular-nums'>{formatDuration(row.activeMs)}</p>
                <p className='text-[10px] text-faint'>
                  <AnimatedNumber
                    value={row.sessions}
                    format={(n) => {
                      const r = Math.round(n);
                      return `${r.toLocaleString()} ${r === 1 ? 'session' : 'sessions'}`;
                    }}
                  />
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

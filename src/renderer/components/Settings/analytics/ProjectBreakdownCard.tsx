import React from 'react';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
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
            <div key={row.projectId} className='flex items-center gap-3 px-3 py-2 bg-slate-900/40 border border-slate-700/40 rounded-lg'>
              <div className='flex-1 min-w-0'>
                <p className='text-sm font-medium text-slate-100 truncate' title={row.projectPath}>
                  {row.displayName}
                </p>
                <p className='text-[10px] text-slate-500 font-mono truncate' title={row.projectPath}>
                  {row.projectPath}
                </p>
              </div>
              <div className='flex items-center gap-1 shrink-0'>
                {row.tools.map((tid) => {
                  const meta = TOOL_META[tid as ToolId];
                  if (!meta) return null;
                  return (
                    <div key={tid} className='w-5 h-5 rounded-md bg-slate-700/60 flex items-center justify-center' title={meta.label}>
                      <img src={meta.icon} alt={meta.label} className='w-3.5 h-3.5 object-contain' />
                    </div>
                  );
                })}
              </div>
              {(() => {
                const fresh = row.tokensIn + row.tokensOut;
                return (
                  <div
                    className='text-right shrink-0 w-20'
                    title={`fresh in+out: ${fresh.toLocaleString()} · cache reads: ${row.cacheRead.toLocaleString()}`}
                  >
                    <p className='text-xs font-mono text-slate-200 tabular-nums'>
                      {fresh > 0 ? formatCompactNumber(fresh) : '—'}
                    </p>
                    <p className='text-[10px] text-slate-500'>tokens</p>
                  </div>
                );
              })()}
              <div className='text-right shrink-0 w-20'>
                <p className='text-xs font-mono text-slate-200 tabular-nums'>{formatDuration(row.activeMs)}</p>
                <p className='text-[10px] text-slate-500'>{row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};

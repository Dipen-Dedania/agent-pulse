import React, { useMemo, useState } from 'react';
import { ProjectBreakdownRow } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { AnimatedNumber, EYEBROW_SIZES, Tooltip } from '../../Shared';
import { useProjectBreakdown } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, SkeletonLine, formatCompactNumber, formatDuration } from './shared';

type SortKey = 'name' | 'tokens' | 'time';
type SortDir = 'asc' | 'desc';

const SORT_VALUE: Record<SortKey, (row: ProjectBreakdownRow) => number | string> = {
  name: (row) => row.displayName.toLowerCase(),
  tokens: (row) => row.tokensIn + row.tokensOut,
  time: (row) => row.activeMs,
};

const SortHeader: React.FC<{
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}> = ({ label, sortKey, active, dir, onSort, className = '' }) => {
  const isActive = active === sortKey;
  return (
    <div
      role='columnheader'
      aria-sort={isActive ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`flex ${className}`}
    >
      <button
        type='button'
        onClick={() => onSort(sortKey)}
        // Eyebrow typography from the shared tier; colour stays here because
        // the active column flips to text-primary, which <Eyebrow> can't do.
        className={`inline-flex items-center gap-1 ${EYEBROW_SIZES.sm} cursor-pointer transition-colors hover:text-primary ${
          isActive ? 'text-primary' : 'text-faint'
        }`}
      >
        {label}
        <span aria-hidden='true' className={isActive ? '' : 'opacity-0'}>
          {dir === 'asc' ? '↑' : '↓'}
        </span>
      </button>
    </div>
  );
};

export const ProjectBreakdownCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useProjectBreakdown(range);
  const [sortKey, setSortKey] = useState<SortKey>('time');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Names read naturally A→Z; numeric columns lead with the biggest.
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const value = SORT_VALUE[sortKey];
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...data.rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : av - (bv as number);
      // Ties fall back to active time so the order stays stable across refreshes.
      return cmp !== 0 ? cmp * sign : b.activeMs - a.activeMs;
    });
  }, [data, sortKey, sortDir]);

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
          <div role='row' className='flex items-center gap-3 px-3'>
            <SortHeader label='Project' sortKey='name' active={sortKey} dir={sortDir} onSort={handleSort} className='flex-1 min-w-0' />
            <SortHeader label='Tokens' sortKey='tokens' active={sortKey} dir={sortDir} onSort={handleSort} className='justify-end shrink-0 w-20' />
            <SortHeader label='Time' sortKey='time' active={sortKey} dir={sortDir} onSort={handleSort} className='justify-end shrink-0 w-20' />
          </div>
          {sortedRows.map((row) => (
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

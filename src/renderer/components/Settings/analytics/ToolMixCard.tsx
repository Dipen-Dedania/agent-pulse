import React, { useState } from 'react';
import { ToolMixRange } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { useToolMix } from './useAnalytics';
import { Card, EmptyState, Segmented, SkeletonLine, formatDuration } from './shared';

const COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee'];

export const ToolMixCard: React.FC = () => {
  const [range, setRange] = useState<ToolMixRange>('30d');
  const { data, loading } = useToolMix(range);

  return (
    <Card
      title='Tool mix'
      subtitle='Share of active time per tool.'
      right={
        <Segmented
          value={range}
          onChange={(v) => setRange(v as ToolMixRange)}
          options={[
            { value: '7d',  label: '7d' },
            { value: '30d', label: '30d' },
          ]}
        />
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='3rem' />
      ) : !data || data.slices.length === 0 ? (
        <EmptyState message='No activity in this window.' />
      ) : (
        <div>
          <div className='flex h-3 rounded-full overflow-hidden bg-slate-900/60'>
            {data.slices.map((s, i) => (
              <div
                key={s.toolId}
                title={`${TOOL_META[s.toolId as ToolId]?.label ?? s.toolId}: ${s.pct.toFixed(1)}% (${formatDuration(s.activeMs)})`}
                style={{ width: `${s.pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
              />
            ))}
          </div>
          <div className='mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2'>
            {data.slices.map((s, i) => {
              const meta = TOOL_META[s.toolId as ToolId];
              return (
                <div key={s.toolId} className='flex items-center gap-2'>
                  <span className='w-2.5 h-2.5 rounded-sm shrink-0' style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className='text-xs text-slate-300 flex-1 truncate'>{meta?.label ?? s.toolId}</span>
                  <span className='text-xs text-slate-400 font-mono tabular-nums'>{s.pct.toFixed(1)}%</span>
                  <span className='text-[10px] text-slate-500 font-mono w-12 text-right'>{formatDuration(s.activeMs)}</span>
                </div>
              );
            })}
          </div>
          <p className='text-[11px] text-slate-500 mt-3'>
            Total active time in window: <span className='text-slate-300 font-mono'>{formatDuration(data.totalActiveMs)}</span>
          </p>
        </div>
      )}
    </Card>
  );
};

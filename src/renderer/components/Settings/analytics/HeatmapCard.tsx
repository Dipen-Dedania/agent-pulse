import React, { useState, useMemo } from 'react';
import { HeatmapRange, HeatmapSeries } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { useHeatmap } from './useAnalytics';
import { Card, EmptyState, Segmented, SkeletonLine, formatDuration } from './shared';

// Logarithmic intensity scale: most days are short, a few are outliers. Linear
// would compress the differences. 0 → empty, 1 → faintest cell, 1.0 → max.
function intensity(ms: number, maxMs: number): number {
  if (ms <= 0 || maxMs <= 0) return 0;
  const t = Math.log10(ms + 1) / Math.log10(maxMs + 1);
  return Math.max(0.08, Math.min(1, t));
}

function bgFor(alpha: number): string {
  // Tailwind doesn't generate arbitrary alpha gradients, so use inline styles.
  return `rgba(96, 165, 250, ${alpha.toFixed(2)})`; // blue-400-ish
}

const SeriesRow: React.FC<{ series: HeatmapSeries; maxMs: number }> = ({ series, maxMs }) => (
  <div className='flex items-center gap-2 mb-1'>
    <div className='w-24 text-[11px] text-slate-400 truncate shrink-0' title={series.displayName}>
      {seriesLabel(series.key, series.displayName)}
    </div>
    <div className='flex gap-0.5 flex-1 overflow-hidden'>
      {series.cells.map((cell) => {
        const a = intensity(cell.activeMs, maxMs);
        return (
          <div
            key={cell.date}
            title={`${cell.date} · ${formatDuration(cell.activeMs)} · ${cell.sessions} sessions`}
            className='w-2.5 h-3 rounded-[2px] shrink-0'
            style={{ backgroundColor: a === 0 ? 'rgb(30 41 59 / 0.6)' : bgFor(a) }}
          />
        );
      })}
    </div>
  </div>
);

function seriesLabel(key: string, displayName: string): string {
  // For toolId series we already have a display name from TOOL_META.
  const meta = TOOL_META[key as ToolId];
  if (meta) return meta.label;
  return displayName;
}

export const HeatmapCard: React.FC = () => {
  const [range, setRange] = useState<HeatmapRange>('30d');
  const [groupBy, setGroupBy] = useState<'tool' | 'project' | 'all'>('all');
  const { data, loading } = useHeatmap(range, groupBy);

  const maxMs = useMemo(() => {
    if (!data) return 0;
    let max = 0;
    for (const series of data.series) {
      for (const cell of series.cells) {
        if (cell.activeMs > max) max = cell.activeMs;
      }
    }
    return max;
  }, [data]);

  return (
    <Card
      title='Activity heatmap'
      subtitle='Active minutes per day. Hover a cell for details.'
      right={
        <div className='flex gap-2 flex-wrap'>
          <Segmented
            value={groupBy}
            onChange={(v) => setGroupBy(v as 'tool' | 'project' | 'all')}
            options={[
              { value: 'all',     label: 'Combined' },
              { value: 'tool',    label: 'By tool' },
              { value: 'project', label: 'By project' },
            ]}
          />
          <Segmented
            value={range}
            onChange={(v) => setRange(v as HeatmapRange)}
            options={[
              { value: '30d', label: '30d' },
              { value: '90d', label: '90d' },
            ]}
          />
        </div>
      }
    >
      {loading && !data ? (
        <div className='flex flex-col gap-2'>
          <SkeletonLine width='90%' height='1rem' />
          <SkeletonLine width='90%' height='1rem' />
          <SkeletonLine width='90%' height='1rem' />
        </div>
      ) : !data || data.series.length === 0 ? (
        <EmptyState message='No activity in this window yet. Start an agent session to see something here.' />
      ) : (
        <div>
          {data.series.map((s) => (
            <SeriesRow key={s.key} series={s} maxMs={maxMs} />
          ))}
          <div className='mt-3 flex items-center gap-2 text-[10px] text-slate-500'>
            <span>Less</span>
            <div className='flex gap-0.5'>
              {[0.1, 0.3, 0.5, 0.75, 1].map((a) => (
                <div key={a} className='w-2.5 h-3 rounded-[2px]' style={{ backgroundColor: bgFor(a) }} />
              ))}
            </div>
            <span>More</span>
          </div>
        </div>
      )}
    </Card>
  );
};

import React, { useMemo, useState } from 'react';
import { HeatmapCell, HeatmapSeries } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { useHeatmap } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, Segmented, SkeletonLine, formatDuration, useChartTip } from './shared';

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

const EMPTY_BG = 'rgb(30 41 59 / 0.6)';

function seriesLabel(key: string, displayName: string): string {
  // For toolId series we already have a display name from TOOL_META.
  const meta = TOOL_META[key as ToolId];
  if (meta) return meta.label;
  return displayName;
}

// Sum daily cells into ISO-week-ish buckets (chunks of 7 from the range start)
// so a year-long strip stays readable at ~52 cells instead of 365.
function toWeekly(cells: HeatmapCell[]): HeatmapCell[] {
  const out: HeatmapCell[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const chunk = cells.slice(i, i + 7);
    out.push({
      date: chunk[0].date,
      activeMs: chunk.reduce((s, c) => s + c.activeMs, 0),
      sessions: chunk.reduce((s, c) => s + c.sessions, 0),
    });
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CellTip: React.FC<{ label: string; cell: HeatmapCell }> = ({ label, cell }) => (
  <span>
    <span className='font-semibold text-white'>{formatDuration(cell.activeMs)}</span>
    <span className='text-slate-400'>
      {' '}· {label} · {cell.sessions} {cell.sessions === 1 ? 'session' : 'sessions'}
    </span>
  </span>
);

// GitHub-style calendar: columns are weeks, rows are weekdays (Sun-first),
// month labels ride the top edge. Reveals weekday/weekend rhythm that a flat
// strip hides, and it's the layout readers already know how to scan.
const CalendarGrid: React.FC<{
  cells: HeatmapCell[];
  maxMs: number;
  cellPx: number;
  tipHandlers: (content: React.ReactNode) => object;
}> = ({ cells, maxMs, cellPx, tipHandlers }) => {
  const GAP = 2;
  const col = cellPx + GAP;

  const { weeks, monthLabels } = useMemo(() => {
    // Pad the first week so every column starts on Sunday.
    const firstDay = new Date(`${cells[0].date}T00:00:00`).getDay();
    const padded: (HeatmapCell | null)[] = [...Array<null>(firstDay).fill(null), ...cells];
    const weeks: (HeatmapCell | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
      weeks.push(padded.slice(i, i + 7));
    }
    // Label a column when the month changes at its first real day.
    const monthLabels: { week: number; label: string }[] = [];
    let lastMonth = -1;
    weeks.forEach((week, w) => {
      const first = week.find((c): c is HeatmapCell => c != null);
      if (!first) return;
      const m = new Date(`${first.date}T00:00:00`).getMonth();
      if (m !== lastMonth) {
        monthLabels.push({ week: w, label: MONTHS[m] });
        lastMonth = m;
      }
    });
    return { weeks, monthLabels };
  }, [cells]);

  return (
    <div className='overflow-x-auto pb-1'>
      <div className='relative h-4' style={{ width: weeks.length * col, marginLeft: 26 }}>
        {monthLabels.map(({ week, label }) => (
          <span
            key={`${week}-${label}`}
            className='absolute top-0 text-[9px] text-slate-500 whitespace-nowrap'
            style={{ left: week * col }}
          >
            {label}
          </span>
        ))}
      </div>
      <div className='flex'>
        <div className='flex flex-col justify-between shrink-0 pr-1.5 py-px' style={{ width: 26, height: 7 * col - GAP }}>
          {['Mon', 'Wed', 'Fri'].map((d) => (
            <span key={d} className='text-[9px] text-slate-500 leading-none'>{d}</span>
          ))}
        </div>
        <div className='flex' style={{ gap: GAP }}>
          {weeks.map((week, w) => (
            <div key={w} className='flex flex-col' style={{ gap: GAP }}>
              {Array.from({ length: 7 }, (_, d) => {
                const cell = week[d] ?? null;
                if (!cell) {
                  return <div key={d} style={{ width: cellPx, height: cellPx }} />;
                }
                const a = intensity(cell.activeMs, maxMs);
                return (
                  <div
                    key={d}
                    className='rounded-[2px] hover:ring-1 hover:ring-slate-300/60'
                    style={{
                      width: cellPx,
                      height: cellPx,
                      backgroundColor: a === 0 ? EMPTY_BG : bgFor(a),
                    }}
                    {...tipHandlers(<CellTip label={cell.date} cell={cell} />)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// One strip per series. Cells share the row's width fractionally so the full
// range always fits — fixed-width cells clipped long ranges silently.
const SeriesRow: React.FC<{
  series: HeatmapSeries;
  cells: HeatmapCell[];
  maxMs: number;
  weekly: boolean;
  tipHandlers: (content: React.ReactNode) => object;
}> = ({ series, cells, maxMs, weekly, tipHandlers }) => (
  <div className='flex items-center gap-2 mb-1'>
    <div className='w-24 text-[11px] text-slate-400 truncate shrink-0' title={series.displayName}>
      {seriesLabel(series.key, series.displayName)}
    </div>
    <div className='flex gap-px flex-1 min-w-0'>
      {cells.map((cell) => {
        const a = intensity(cell.activeMs, maxMs);
        return (
          <div
            key={cell.date}
            className='flex-1 min-w-0 h-3 rounded-[1px] hover:ring-1 hover:ring-slate-300/60'
            style={{ backgroundColor: a === 0 ? EMPTY_BG : bgFor(a) }}
            {...tipHandlers(
              <CellTip label={weekly ? `week of ${cell.date}` : cell.date} cell={cell} />,
            )}
          />
        );
      })}
    </div>
  </div>
);

export const HeatmapCard: React.FC = () => {
  const range = useGlobalRange();
  const [groupBy, setGroupBy] = useState<'tool' | 'project' | 'all'>('all');
  const { data, loading } = useHeatmap(range, groupBy);
  const { tipHandlers, tipOverlay } = useChartTip();

  // Grouped strips roll a year up to weeks; the calendar grid stays daily.
  const stripWeekly = range === '1y' && groupBy !== 'all';
  const displaySeries = useMemo(() => {
    if (!data) return [];
    return data.series.map((s) => ({
      series: s,
      cells: stripWeekly ? toWeekly(s.cells) : s.cells,
    }));
  }, [data, stripWeekly]);

  const maxMs = useMemo(() => {
    let max = 0;
    for (const { cells } of displaySeries) {
      for (const cell of cells) {
        if (cell.activeMs > max) max = cell.activeMs;
      }
    }
    return max;
  }, [displaySeries]);

  const calendarCellPx = range === '1y' ? 9 : range === '90d' ? 13 : 15;

  return (
    <Card
      title='Activity heatmap'
      subtitle='Active minutes per day. Hover a cell for details.'
      right={
        <Segmented
          value={groupBy}
          onChange={(v) => setGroupBy(v as 'tool' | 'project' | 'all')}
          options={[
            { value: 'all',     label: 'Calendar' },
            { value: 'tool',    label: 'By tool' },
            { value: 'project', label: 'By project' },
          ]}
        />
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
          {groupBy === 'all' && displaySeries[0] ? (
            <CalendarGrid
              cells={displaySeries[0].cells}
              maxMs={maxMs}
              cellPx={calendarCellPx}
              tipHandlers={tipHandlers}
            />
          ) : (
            displaySeries.map(({ series, cells }) => (
              <SeriesRow
                key={series.key}
                series={series}
                cells={cells}
                maxMs={maxMs}
                weekly={stripWeekly}
                tipHandlers={tipHandlers}
              />
            ))
          )}
          <div className='mt-3 flex items-center gap-2 text-[10px] text-slate-500'>
            <span>Less</span>
            <div className='flex gap-0.5'>
              {[0.1, 0.3, 0.5, 0.75, 1].map((a) => (
                <div key={a} className='w-2.5 h-3 rounded-[2px]' style={{ backgroundColor: bgFor(a) }} />
              ))}
            </div>
            <span>More</span>
            {stripWeekly && <span className='ml-2'>weekly totals at 1y</span>}
          </div>
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

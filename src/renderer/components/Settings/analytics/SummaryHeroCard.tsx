import React from 'react';
import { formatUsd } from '../../../../common/pricing';
import { useSummary } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { EmptyState, SkeletonLine, formatDuration } from './shared';

// Signed period-over-period delta chip. Nothing on this tab is "bad" when it
// goes up (spend here is value extracted from a flat-rate plan), so up is
// emerald and down is neutral slate — never red.
const DeltaChip: React.FC<{ current: number; previous: number }> = ({ current, previous }) => {
  if (previous <= 0) {
    return current > 0
      ? <span className='text-[10px] text-faint'>new this period</span>
      : <span className='text-[10px] text-ghost'>—</span>;
  }
  const pct = ((current - previous) / previous) * 100;
  if (!Number.isFinite(pct)) return null;
  const up = pct >= 0;
  const cls = up ? 'text-ok' : 'text-muted';
  return (
    <span className={`text-[10px] font-medium ${cls}`}>
      {up ? '↑' : '↓'} {Math.abs(pct) >= 100 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%
    </span>
  );
};

const StatTile: React.FC<{
  label: string;
  value: string;
  delta?: React.ReactNode;
  sub?: string;
}> = ({ label, value, delta, sub }) => (
  <div className='flex-1 min-w-0 bg-glass/40 border border-edge/40 rounded-xl px-4 py-3'>
    <p className='text-[10px] uppercase tracking-widest text-faint'>{label}</p>
    <p className='text-xl font-semibold text-strong leading-tight mt-1 truncate' title={value}>{value}</p>
    <div className='mt-1 flex items-center gap-1.5 min-h-[14px]'>
      {delta}
      {sub && <span className='text-[10px] text-faint truncate'>{sub}</span>}
    </div>
  </div>
);

export const SummaryHeroCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useSummary(range);
  const vsLabel = `vs prev ${range}`;

  if (loading && !data) {
    return (
      <div className='mb-5 flex gap-3'>
        {[0, 1, 2, 3].map((i) => <SkeletonLine key={i} width='25%' height='4.5rem' />)}
      </div>
    );
  }
  if (!data) return null;
  const { current, previous } = data;
  if (current.sessions === 0 && previous.sessions === 0) {
    return (
      <div className='mb-5 bg-glass/60 backdrop-blur-md border border-edge/70 rounded-2xl p-5'>
        <EmptyState message='No agent activity in this window yet.' />
      </div>
    );
  }

  return (
    <div className='mb-5 grid grid-cols-2 lg:grid-cols-4 gap-3'>
      <StatTile
        label='Active time'
        value={formatDuration(current.activeMs)}
        delta={<DeltaChip current={current.activeMs} previous={previous.activeMs} />}
        sub={vsLabel}
      />
      <StatTile
        label='Est. spend'
        value={formatUsd(current.costUsd)}
        delta={<DeltaChip current={current.costUsd} previous={previous.costUsd} />}
        sub={vsLabel}
      />
      <StatTile
        label='Sessions'
        value={current.sessions.toLocaleString()}
        delta={<DeltaChip current={current.sessions} previous={previous.sessions} />}
        sub={vsLabel}
      />
      <StatTile
        label='Top project'
        value={current.topProject?.displayName ?? '—'}
        sub={current.topProject ? `${formatDuration(current.topProject.activeMs)} active` : 'no project-tagged work'}
      />
    </div>
  );
};

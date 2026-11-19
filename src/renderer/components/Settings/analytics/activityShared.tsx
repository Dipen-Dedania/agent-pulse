import React from 'react';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { Eyebrow } from '../../Shared';

// Building blocks shared by the three activity cards (prompt size, lines
// changed, subagent use) so they read as one family.

export const ACTIVITY_EMPTY =
  'No data yet. This fills in as Claude Code and Codex sessions run; history is read in the background shortly after launch.';

// Labelled number tile, same look as the cache/context cards' KPI tiles.
export const StatTile: React.FC<{
  label: string;
  children: React.ReactNode;       // the value
  sub?: React.ReactNode;
  valueClass?: string;
}> = ({ label, children, sub, valueClass = 'text-primary' }) => (
  <div className='glass-secondary p-3 min-w-0'>
    <Eyebrow size='sm' className='mb-1'>{label}</Eyebrow>
    <p className={`text-xl font-semibold font-mono tabular-nums leading-tight ${valueClass}`}>{children}</p>
    {sub && <p className='text-[11px] text-muted mt-0.5 truncate'>{sub}</p>}
  </div>
);

// Agent icon + name, followed by whatever the card shows for that agent.
export const AgentRow: React.FC<{ toolId: ToolId; children: React.ReactNode }> = ({ toolId, children }) => {
  const meta = TOOL_META[toolId];
  return (
    <div className='flex items-center gap-2.5 text-xs'>
      {meta && (
        <div className='w-5 h-5 rounded-md bg-control/60 flex items-center justify-center shrink-0'>
          <img src={meta.icon} alt='' className='w-3.5 h-3.5 object-contain' />
        </div>
      )}
      <span className='text-body flex-1 truncate'>{meta?.label ?? toolId}</span>
      {children}
    </div>
  );
};

// Long ranges (90d / 1y) have too many days for one bar each — sum them into
// weeks, the same readability guard the other day-bucketed cards use.
export function rollupDays<T extends { date: string }>(
  byDay: T[],
  merge: (chunk: T[]) => T,
): { buckets: T[]; weekly: boolean } {
  if (byDay.length <= 60) return { buckets: byDay, weekly: false };
  const weeks: T[] = [];
  for (let i = 0; i < byDay.length; i += 7) weeks.push(merge(byDay.slice(i, i + 7)));
  return { buckets: weeks, weekly: true };
}

// First / middle / last date under a day chart.
export const DayAxis: React.FC<{ dates: string[] }> = ({ dates }) => {
  if (dates.length < 2) return null;
  const picks = [dates[0], dates[Math.floor((dates.length - 1) / 2)], dates[dates.length - 1]];
  return (
    <div className='flex justify-between mt-1 text-[10px] text-faint font-mono'>
      {picks.map((d, i) => <span key={`${d}-${i}`}>{d}</span>)}
    </div>
  );
};

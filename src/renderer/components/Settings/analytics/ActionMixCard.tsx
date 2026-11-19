import React from 'react';
import { ActionCategory } from '../../../../common/action-mix';
import { ActionMixCategoryCount } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { AnimatedNumber, Eyebrow } from '../../Shared';
import { useActionMix } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoTooltip, SkeletonLine, formatCompactNumber, useChartTip } from './shared';

const CATEGORY_META: Record<ActionCategory, { label: string; color: string }> = {
  explore:  { label: 'Read & search', color: '#60a5fa' },
  edit:     { label: 'Edit files',    color: '#34d399' },
  shell:    { label: 'Run commands',  color: '#fbbf24' },
  web:      { label: 'Web',           color: '#22d3ee' },
  mcp:      { label: 'MCP tools',     color: '#a78bfa' },
  delegate: { label: 'Subagents',     color: '#f472b6' },
  plan:     { label: 'Plan & ask',    color: '#fb923c' },
  other:    { label: 'Other',         color: '#94a3b8' },
};

const COVERAGE_NOTE =
  'Counted from the tool name each agent reports before a tool call. Tool names are not stored ' +
  'while “Redact task text” is on, so those periods are missing here.';

// "mcp__chrome-devtools__take_screenshot" → "chrome-devtools › take_screenshot";
// Cursor's "MCP:firecrawl_search" → "firecrawl_search". Other names pass through.
function displayToolName(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/i.exec(name);
  if (mcp) return `${mcp[1]} › ${mcp[2]}`;
  return name.replace(/^mcp:/i, '');
}

const pctLabel = (pct: number) => (pct > 0 && pct < 1 ? '<1%' : `${pct.toFixed(0)}%`);

type TipHandlers = ReturnType<typeof useChartTip>['tipHandlers'];

// Category shares as a donut. Arcs are stroked circles in a 100-unit viewBox,
// rotated so the first slice starts at 12 o'clock and slices run clockwise in
// ACTION_CATEGORIES order (same technique as the Backlog card's task-mix donut).
const CategoryDonut: React.FC<{
  categories: ActionMixCategoryCount[];
  size: number;
  strokeWidth: number;
  tipHandlers: TipHandlers;
  children?: React.ReactNode;       // rendered in the hole
}> = ({ categories, size, strokeWidth, tipHandlers, children }) => {
  const r = 50 - strokeWidth / 2 - 1;
  const c = 2 * Math.PI * r;
  let start = 0;
  return (
    <div className='relative shrink-0' style={{ width: size, height: size }}>
      <svg viewBox='0 0 100 100' width={size} height={size}>
        <circle cx={50} cy={50} r={r} fill='none' stroke='currentColor' strokeWidth={strokeWidth} className='text-edge/40' />
        {categories.map((cat) => {
          const len = cat.pct / 100;
          const rotate = start * 360 - 90;
          start += len;
          if (len <= 0) return null;
          const meta = CATEGORY_META[cat.category];
          return (
            <circle
              key={cat.category}
              cx={50} cy={50} r={r} fill='none'
              stroke={meta.color} strokeWidth={strokeWidth} strokeLinecap='butt'
              strokeDasharray={`${len * c} ${c}`}
              transform={`rotate(${rotate} 50 50)`}
              style={{ cursor: 'default' }}
              {...tipHandlers(
                <span>
                  <span className='font-semibold text-strong'>{meta.label} {pctLabel(cat.pct)}</span>
                  <span className='text-muted'> · {formatCompactNumber(cat.calls)} calls</span>
                </span>,
              )}
            />
          );
        })}
      </svg>
      {children && (
        <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center'>
          {children}
        </div>
      )}
    </div>
  );
};

export const ActionMixCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useActionMix(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  return (
    <Card
      title='Agent actions'
      subtitle='What your agents spend their tool calls on: reading, editing, running commands, and more.'
      right={
        <InfoTooltip label='How this is counted'>
          <span className='text-[11px] text-body leading-snug'>{COVERAGE_NOTE}</span>
        </InfoTooltip>
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='8rem' />
      ) : !data || data.totalCalls === 0 ? (
        <EmptyState message='No tool calls recorded in this window. Tool names are not stored while “Redact task text” is on.' />
      ) : (
        <div>
          {/* All agents: donut with the total in the hole + full legend */}
          <div className='flex items-center gap-6 flex-wrap'>
            <CategoryDonut categories={data.categories} size={148} strokeWidth={13} tipHandlers={tipHandlers}>
              <span className='text-xl font-semibold font-mono tabular-nums text-strong leading-none'>
                <AnimatedNumber value={data.totalCalls} format={formatCompactNumber} />
              </span>
              <Eyebrow size='sm' as='span' className='mt-1'>tool calls</Eyebrow>
            </CategoryDonut>
            <div className='flex-1 min-w-[16rem] grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2'>
              {data.categories.map((c) => (
                <div key={c.category} className='flex items-center gap-2 text-xs min-w-0'>
                  <span className='w-2.5 h-2.5 rounded-sm shrink-0' style={{ backgroundColor: CATEGORY_META[c.category].color }} />
                  <span className='text-body truncate flex-1'>{CATEGORY_META[c.category].label}</span>
                  <span className='text-faint font-mono tabular-nums shrink-0'>{formatCompactNumber(c.calls)}</span>
                  <span className='text-primary font-mono tabular-nums shrink-0 w-9 text-right'>{pctLabel(c.pct)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Per agent: a small donut each, so their mixes compare side by side */}
          <div className='mt-5 grid grid-cols-1 lg:grid-cols-2 gap-2'>
            {data.agents.map((a) => {
              const meta = TOOL_META[a.toolId as ToolId];
              return (
                <div key={a.toolId} className='glass-secondary p-3 flex items-center gap-4'>
                  <CategoryDonut categories={a.categories} size={72} strokeWidth={16} tipHandlers={tipHandlers} />
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2.5'>
                      {meta && (
                        <div className='w-6 h-6 rounded-md bg-control/60 flex items-center justify-center shrink-0'>
                          <img src={meta.icon} alt={meta.label} className='w-4 h-4 object-contain' />
                        </div>
                      )}
                      <span className='text-sm font-medium text-primary flex-1 truncate'>{meta?.label ?? a.toolId}</span>
                      <span className='text-xs text-muted font-mono tabular-nums shrink-0'>
                        <AnimatedNumber value={a.calls} format={formatCompactNumber} className='text-primary' /> calls
                      </span>
                    </div>
                    <p className='text-[11px] text-muted mt-2 leading-relaxed'>
                      {a.topTools.map((t, i) => (
                        <span key={t.name}>
                          {i > 0 && ' · '}
                          <span className='whitespace-nowrap'>
                            {displayToolName(t.name)}{' '}
                            <span className='font-mono tabular-nums text-body'>{formatCompactNumber(t.calls)}</span>
                          </span>
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

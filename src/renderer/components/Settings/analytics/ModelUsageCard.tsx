import React, { useState } from 'react';
import { ModelUsageRange, ModelUsageMode } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { formatUsd } from '../../../../common/pricing';
import { useModelUsage } from './useAnalytics';
import { Card, EmptyState, InfoPill, Segmented, SkeletonLine, formatCompactNumber } from './shared';

const COVERAGE_NOTE =
  'Captures models from Claude Code (via transcripts). Antigravity coverage depends on hook payload. ' +
  'Cursor, VS Code Copilot, and Kiro don\'t expose model info via their hooks.';

export const ModelUsageCard: React.FC = () => {
  const [range, setRange] = useState<ModelUsageRange>('30d');
  const [mode, setMode] = useState<ModelUsageMode>('tokens');
  const { data, loading } = useModelUsage(range, mode);

  const total = data
    ? mode === 'tokens'
      ? data.totalTokens
      : mode === 'cost'
        ? data.totalCostUsd
        : data.totalSessions
    : 0;

  return (
    <Card
      title='Model usage'
      subtitle='Which models did the work.'
      right={
        <div className='flex gap-2 flex-wrap'>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as ModelUsageMode)}
            options={[
              { value: 'tokens',   label: 'By tokens' },
              { value: 'cost',     label: 'By cost' },
              { value: 'sessions', label: 'By sessions' },
            ]}
          />
          <Segmented
            value={range}
            onChange={(v) => setRange(v as ModelUsageRange)}
            options={[
              { value: '7d',  label: '7d' },
              { value: '30d', label: '30d' },
            ]}
          />
        </div>
      }
    >
      <div className='mb-3 flex items-center gap-2 flex-wrap'>
        <InfoPill>Source coverage</InfoPill>
        <span className='text-[11px] text-slate-400'>{COVERAGE_NOTE}</span>
      </div>

      {loading && !data ? (
        <SkeletonLine width='100%' height='3rem' />
      ) : !data || data.rows.length === 0 ? (
        <EmptyState message='No model data yet. Run Claude Code in a project to populate this.' />
      ) : (
        <div className='flex flex-col gap-2'>
          {data.rows.map((row) => {
            const value = mode === 'tokens'
              ? row.tokensIn + row.tokensOut
              : mode === 'cost'
                ? row.costUsd
                : row.sessions;
            const pct = total > 0 ? (value / total) * 100 : 0;
            const meta = row.toolId ? TOOL_META[row.toolId as ToolId] : null;
            return (
              <div key={row.model} className='bg-slate-900/40 border border-slate-700/40 rounded-xl p-3'>
                <div className='flex items-center gap-2.5 mb-2'>
                  {meta && (
                    <div className='w-6 h-6 rounded-md bg-slate-700/60 flex items-center justify-center shrink-0'>
                      <img src={meta.icon} alt={meta.label} className='w-4 h-4 object-contain' />
                    </div>
                  )}
                  <p className='text-sm font-medium text-slate-100 flex-1 truncate font-mono'>{row.model}</p>
                  {!row.priced && <InfoPill tone='warn'>unpriced</InfoPill>}
                  <p className='text-xs text-slate-300 font-mono tabular-nums shrink-0'>
                    {mode === 'cost' ? formatUsd(row.costUsd) : `${pct.toFixed(1)}%`}
                  </p>
                </div>
                <div className='h-1.5 bg-slate-900/60 rounded-full overflow-hidden mb-2'>
                  <div className='h-full bg-blue-500' style={{ width: `${pct}%` }} />
                </div>
                <div className='flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums'>
                  <span>
                    in <span className='text-slate-200'>{formatCompactNumber(row.tokensIn)}</span> ·
                    out <span className='text-slate-200'>{formatCompactNumber(row.tokensOut)}</span> ·
                    <span className='text-slate-200'> {formatUsd(row.costUsd)}</span>
                  </span>
                  <span>
                    {row.sessions} {row.sessions === 1 ? 'session' : 'sessions'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

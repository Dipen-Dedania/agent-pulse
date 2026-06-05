import React, { useState } from 'react';
import { ToolMixRange } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { formatUsd } from '../../../../common/pricing';
import { useToolMix } from './useAnalytics';
import { Card, EmptyState, InfoPill, Segmented, SkeletonLine, formatCompactNumber, formatDuration } from './shared';

const COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee'];

const COVERAGE_NOTE =
  'Cost is estimated at API list prices from token usage. Only agents that expose tokens ' +
  '(Claude Code, OpenAI Codex, Antigravity) can be priced — Cursor, Copilot, and Kiro show activity only.';

export const ToolMixCard: React.FC = () => {
  const [range, setRange] = useState<ToolMixRange>('30d');
  const { data, loading } = useToolMix(range);

  return (
    <Card
      title='Agent scorecard'
      subtitle='Active time, tokens, and estimated cost per agent.'
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
      <div className='mb-3 flex items-center gap-2 flex-wrap'>
        <InfoPill>Estimated cost</InfoPill>
        <span className='text-[11px] text-slate-400'>{COVERAGE_NOTE}</span>
      </div>

      {loading && !data ? (
        <SkeletonLine width='100%' height='3rem' />
      ) : !data || data.slices.length === 0 ? (
        <EmptyState message='No activity in this window.' />
      ) : (
        <div>
          {/* Share-of-active-time bar */}
          <div className='flex h-3 rounded-full overflow-hidden bg-slate-900/60'>
            {data.slices.map((s, i) => (
              <div
                key={s.toolId}
                title={`${TOOL_META[s.toolId as ToolId]?.label ?? s.toolId}: ${s.pct.toFixed(1)}% (${formatDuration(s.activeMs)})`}
                style={{ width: `${s.pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
              />
            ))}
          </div>

          {/* Per-agent rows */}
          <div className='mt-4 flex flex-col gap-2'>
            {data.slices.map((s, i) => {
              const meta = TOOL_META[s.toolId as ToolId];
              return (
                <div key={s.toolId} className='bg-slate-900/40 border border-slate-700/40 rounded-xl p-3'>
                  <div className='flex items-center gap-2.5 mb-2'>
                    <span className='w-2.5 h-2.5 rounded-sm shrink-0' style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    {meta && (
                      <div className='w-6 h-6 rounded-md bg-slate-700/60 flex items-center justify-center shrink-0'>
                        <img src={meta.icon} alt={meta.label} className='w-4 h-4 object-contain' />
                      </div>
                    )}
                    <span className='text-sm font-medium text-slate-100 flex-1 truncate'>{meta?.label ?? s.toolId}</span>
                    {s.hasTokenData ? (
                      <span className='text-sm font-semibold text-emerald-300 font-mono tabular-nums shrink-0'>
                        {formatUsd(s.costUsd)}
                      </span>
                    ) : (
                      <InfoPill tone='warn'>no token data</InfoPill>
                    )}
                  </div>
                  <div className='flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums'>
                    <span>
                      {formatDuration(s.activeMs)} active
                      {s.hasTokenData && (
                        <>
                          {' · '}in <span className='text-slate-200'>{formatCompactNumber(s.tokensIn)}</span>
                          {' · '}out <span className='text-slate-200'>{formatCompactNumber(s.tokensOut)}</span>
                        </>
                      )}
                    </span>
                    <span>
                      {s.hasTokenData ? `${s.costPct.toFixed(1)}% of spend` : `${s.pct.toFixed(1)}% of time`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className='text-[11px] text-slate-500 mt-3 flex items-center justify-between'>
            <span>
              Total active: <span className='text-slate-300 font-mono'>{formatDuration(data.totalActiveMs)}</span>
            </span>
            <span>
              Est. spend: <span className='text-emerald-300 font-mono'>{formatUsd(data.totalCostUsd)}</span>
            </span>
          </p>
        </div>
      )}
    </Card>
  );
};

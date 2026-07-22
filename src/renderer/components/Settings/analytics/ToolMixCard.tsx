import React from 'react';
import { motion } from 'framer-motion';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { formatUsd } from '../../../../common/pricing';
import { AnimatedNumber, Tooltip } from '../../Shared';
import { smooth } from '../../../motion';
import { useToolMix } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoPill, InfoTooltip, SkeletonLine, formatCompactNumber, formatDuration } from './shared';

const COLORS = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee'];

const COVERAGE_NOTE =
  'Cost is estimated at API list prices from token usage. Only agents that expose tokens ' +
  '(Claude Code, OpenAI Codex, Antigravity) can be priced — Cursor, Copilot, and Kiro show activity only.';

export const ToolMixCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useToolMix(range);

  return (
    <Card
      title='Agent scorecard'
      subtitle='Active time, tokens, and estimated cost per agent.'
      right={
        <span className='inline-flex items-center gap-1.5'>
          <InfoPill>Estimated cost</InfoPill>
          <InfoTooltip label='Cost coverage'>
            <span className='text-[11px] text-body leading-snug'>{COVERAGE_NOTE}</span>
          </InfoTooltip>
        </span>
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='3rem' />
      ) : !data || data.slices.length === 0 ? (
        <EmptyState message='No activity in this window.' />
      ) : (
        <div>
          {/* Share-of-active-time bar — each segment springs to its width on data change */}
          <div className='flex h-3 rounded-full overflow-hidden bg-glass/60'>
            {data.slices.map((s, i) => (
              <Tooltip key={s.toolId} content={`${TOOL_META[s.toolId as ToolId]?.label ?? s.toolId}: ${s.pct.toFixed(1)}% (${formatDuration(s.activeMs)})`}>
                <motion.div
                  animate={{ width: `${s.pct}%` }}
                  transition={smooth}
                  style={{ width: `${s.pct}%`, backgroundColor: COLORS[i % COLORS.length] }}
                />
              </Tooltip>
            ))}
          </div>

          {/* Per-agent rows */}
          <div className='mt-4 flex flex-col gap-2'>
            {data.slices.map((s, i) => {
              const meta = TOOL_META[s.toolId as ToolId];
              return (
                <div key={s.toolId} className='glass-secondary p-3'>
                  <div className='flex items-center gap-2.5 mb-2'>
                    <span className='w-2.5 h-2.5 rounded-sm shrink-0' style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    {meta && (
                      <div className='w-6 h-6 rounded-md bg-control/60 flex items-center justify-center shrink-0'>
                        <img src={meta.icon} alt={meta.label} className='w-4 h-4 object-contain' />
                      </div>
                    )}
                    <span className='text-sm font-medium text-primary flex-1 truncate'>{meta?.label ?? s.toolId}</span>
                    {s.hasTokenData ? (
                      <span className='text-sm font-semibold text-ok font-mono tabular-nums shrink-0'>
                        <AnimatedNumber value={s.costUsd} format={formatUsd} />
                      </span>
                    ) : (
                      <InfoPill tone='warn'>no token data</InfoPill>
                    )}
                  </div>
                  <div className='flex items-center justify-between text-[11px] text-muted font-mono tabular-nums'>
                    <span>
                      {/* formatDuration output is non-numeric ("2h 15m") — left static */}
                      {formatDuration(s.activeMs)} active
                      {s.hasTokenData && (
                        <>
                          {' · '}in{' '}
                          <AnimatedNumber value={s.tokensIn} format={formatCompactNumber} className='text-primary' />
                          {' · '}out{' '}
                          <AnimatedNumber value={s.tokensOut} format={formatCompactNumber} className='text-primary' />
                        </>
                      )}
                    </span>
                    <span>
                      {s.hasTokenData
                        ? <AnimatedNumber value={s.costPct} format={(n) => `${n.toFixed(1)}% of spend`} />
                        : <AnimatedNumber value={s.pct} format={(n) => `${n.toFixed(1)}% of time`} />}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <p className='text-[11px] text-faint mt-3 flex items-center justify-between'>
            <span>
              {/* formatDuration output is non-numeric ("2h 15m") — left static */}
              Total active: <span className='text-body font-mono'>{formatDuration(data.totalActiveMs)}</span>
            </span>
            <span>
              Est. spend:{' '}
              <AnimatedNumber value={data.totalCostUsd} format={formatUsd} className='text-ok font-mono' />
            </span>
          </p>
        </div>
      )}
    </Card>
  );
};

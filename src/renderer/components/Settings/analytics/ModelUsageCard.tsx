import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ModelUsageMode } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { estimateCostBreakdown, formatUsd } from '../../../../common/pricing';
import { AnimatedNumber } from '../../Shared';
import { smooth } from '../../../motion';
import { useModelUsage } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, CostBreakdownContent, EmptyState, InfoPill, InfoTooltip, Segmented, SkeletonLine, formatCompactNumber } from './shared';

const COVERAGE_NOTE =
  'Captures models from Claude Code (via transcripts). Antigravity coverage depends on hook payload. ' +
  'Cursor, VS Code Copilot, and Kiro don\'t expose model info via their hooks.';

export const ModelUsageCard: React.FC = () => {
  const range = useGlobalRange();
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
        <div className='flex items-center gap-2 flex-wrap'>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as ModelUsageMode)}
            options={[
              { value: 'tokens',   label: 'By tokens' },
              { value: 'cost',     label: 'By cost' },
              { value: 'sessions', label: 'By sessions' },
            ]}
          />
          <span className='inline-flex items-center gap-1.5'>
            <InfoPill>Source coverage</InfoPill>
            <InfoTooltip label='Model source coverage'>
              <span className='text-[11px] text-body leading-snug'>{COVERAGE_NOTE}</span>
            </InfoTooltip>
          </span>
        </div>
      }
    >
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
              <div key={row.model} className='glass-secondary p-3'>
                <div className='flex items-center gap-2.5 mb-2'>
                  {meta && (
                    <div className='w-6 h-6 rounded-md bg-control/60 flex items-center justify-center shrink-0'>
                      <img src={meta.icon} alt={meta.label} className='w-4 h-4 object-contain' />
                    </div>
                  )}
                  <p className='text-sm font-medium text-primary flex-1 truncate font-mono'>{row.model}</p>
                  {!row.priced && <InfoPill tone='warn'>unpriced</InfoPill>}
                  <p className='text-xs text-body font-mono tabular-nums shrink-0'>
                    {mode === 'cost'
                      ? <AnimatedNumber value={row.costUsd} format={formatUsd} />
                      : <AnimatedNumber value={pct} format={(n) => `${n.toFixed(1)}%`} />}
                  </p>
                </div>
                <div className='h-1.5 bg-glass/60 rounded-full overflow-hidden mb-2'>
                  <motion.div
                    className='h-full bg-blue-500'
                    animate={{ width: `${pct}%` }}
                    transition={smooth}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className='flex items-center justify-between text-[11px] text-muted font-mono tabular-nums'>
                  <span className='inline-flex items-center gap-1.5'>
                    in <AnimatedNumber value={row.tokensIn} format={formatCompactNumber} className='text-primary' /> ·
                    out <AnimatedNumber value={row.tokensOut} format={formatCompactNumber} className='text-primary' /> ·
                    <AnimatedNumber value={row.costUsd} format={formatUsd} className='text-primary' />
                    {row.priced && (
                      <InfoTooltip label={`${row.model} cost breakdown`}>
                        <CostBreakdownContent
                          tokensIn={row.tokensIn}
                          tokensOut={row.tokensOut}
                          cacheWrite={row.cacheWrite}
                          cacheRead={row.cacheRead}
                          breakdown={estimateCostBreakdown(row.model, {
                            tokensIn: row.tokensIn,
                            tokensOut: row.tokensOut,
                            cacheWrite: row.cacheWrite,
                            cacheRead: row.cacheRead,
                          }).breakdown}
                          totalUsd={row.costUsd}
                        />
                      </InfoTooltip>
                    )}
                  </span>
                  <span>
                    <AnimatedNumber
                      value={row.sessions}
                      format={(n) => {
                        const r = Math.round(n);
                        return `${r.toLocaleString()} ${r === 1 ? 'session' : 'sessions'}`;
                      }}
                    />
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

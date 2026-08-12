import React from 'react';
import { CostBreakdown, formatUsd } from '../../../../common/pricing';
import { Badge } from '../../Shared';

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0m';
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatCompactNumber(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k';
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + 'M';
}

// Card and Segmented are app-wide primitives — their definitions now live in
// components/Shared. Re-exported here so the analytics cards can keep importing
// them from './shared' alongside the chart-only helpers below.
export { Card } from '../../Shared/Card';
export { Segmented } from '../../Shared/Segmented';

// Thin wrapper over the shared Badge (variant='tag'). Kept as a named export so
// the analytics cards keep importing `InfoPill` from './shared'.
export const InfoPill: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn' }> = ({ children, tone = 'info' }) => (
  <Badge tone={tone} variant='tag' size='sm'>{children}</Badge>
);

// InfoTooltip (the "i" popover) and useChartTip (the cursor-following chart
// tip) are app-wide primitives — they now live in components/Shared alongside
// Tooltip, sharing its portal, placement, and glass panel. Re-exported here so
// the analytics cards keep importing them from './shared'.
export { InfoTooltip } from '../../Shared/InfoTooltip';
export { useChartTip } from '../../Shared/useChartTip';

// Effective $/1M-token rate for a class, derived from the dollars actually
// attributed and the tokens counted. Equals the list rate for single-model
// rows; blends automatically when an aggregate spans several models.
function effectiveRate(costUsd: number, tokens: number): string {
  if (tokens <= 0) return '—';
  return `$${((costUsd / tokens) * 1_000_000).toFixed(2)}/M`;
}

const BreakdownRow: React.FC<{ label: string; tokens: number; costUsd: number }> = ({ label, tokens, costUsd }) => (
  <tr className='text-[11px] text-body'>
    <td className='py-0.5 pr-3 text-muted'>{label}</td>
    <td className='py-0.5 pr-3 text-right font-mono tabular-nums text-body'>{formatCompactNumber(tokens)}</td>
    <td className='py-0.5 pr-3 text-right font-mono tabular-nums text-faint'>{effectiveRate(costUsd, tokens)}</td>
    <td className='py-0.5 text-right font-mono tabular-nums text-ok'>{formatUsd(costUsd)}</td>
  </tr>
);

// Shared cost-breakdown popover body: a per-token-class table (tokens, effective
// rate, dollars) plus a footnote on cache discounting. Used by any card that
// shows an estimated cost and wants to explain how it was built.
export const CostBreakdownContent: React.FC<{
  tokensIn: number;
  tokensOut: number;
  cacheWrite: number;
  cacheRead: number;
  breakdown: CostBreakdown;
  totalUsd: number;
}> = ({ tokensIn, tokensOut, cacheWrite, cacheRead, breakdown, totalUsd }) => (
  <div className='text-primary'>
    <p className='text-[11px] font-semibold text-primary mb-1.5'>How this is estimated</p>
    <table className='w-full border-collapse'>
      <thead>
        <tr className='text-[9px] uppercase tracking-wider text-faint'>
          <th className='py-0.5 pr-3 text-left font-medium'>Class</th>
          <th className='py-0.5 pr-3 text-right font-medium'>Tokens</th>
          <th className='py-0.5 pr-3 text-right font-medium'>Rate</th>
          <th className='py-0.5 text-right font-medium'>Cost</th>
        </tr>
      </thead>
      <tbody>
        <BreakdownRow label='Input'       tokens={tokensIn}   costUsd={breakdown.input} />
        <BreakdownRow label='Output'      tokens={tokensOut}  costUsd={breakdown.output} />
        <BreakdownRow label='Cache write' tokens={cacheWrite} costUsd={breakdown.cacheWrite} />
        <BreakdownRow label='Cache read'  tokens={cacheRead}  costUsd={breakdown.cacheRead} />
      </tbody>
      <tfoot>
        <tr className='text-[11px] font-semibold border-t border-edge/70'>
          <td className='pt-1.5 pr-3 text-primary' colSpan={3}>Total</td>
          <td className='pt-1.5 text-right font-mono tabular-nums text-ok'>{formatUsd(totalUsd)}</td>
        </tr>
      </tfoot>
    </table>
    <p className='text-[10px] text-faint mt-2 leading-snug'>
      Cache writes bill at ≈1.25× the input rate; cache reads at ≈0.1× (≈90% cheaper). Rates are
      Anthropic API list prices and blend if an aggregate spans multiple models.
    </p>
  </div>
);

// EmptyState is an app-wide primitive — its definition now lives in
// components/Shared. Re-exported here so the analytics cards keep importing it
// from './shared' alongside the chart-only helpers.
export { EmptyState } from '../../Shared/EmptyState';

export const SkeletonLine: React.FC<{ width?: string; height?: string }> = ({ width = '100%', height = '0.75rem' }) => (
  <div className='bg-control/40 rounded animate-pulse' style={{ width, height }} />
);

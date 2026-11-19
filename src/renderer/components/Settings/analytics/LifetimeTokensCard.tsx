import React from 'react';
import { formatUsd } from '../../../../common/pricing';
import { AnimatedNumber, Eyebrow, Tooltip } from '../../Shared';
import { useLifetimeTokens } from './useAnalytics';
import { Card, EmptyState, SkeletonLine, formatCompactNumber } from './shared';

// One entry per token class, in the order they are drawn in the composition
// bar. Cache read is emerald to match the Cache efficiency card (cached input
// is the cheap part of the total).
const CLASSES = [
  { key: 'tokensIn',   label: 'Input',       dot: 'bg-blue-400' },
  { key: 'tokensOut',  label: 'Output',      dot: 'bg-violet-400' },
  { key: 'cacheRead',  label: 'Cache read',  dot: 'bg-emerald-500' },
  { key: 'cacheWrite', label: 'Cache write', dot: 'bg-amber-400' },
] as const;

// Springed values are fractional mid-animation; round before compacting.
const formatTokens = (n: number) => formatCompactNumber(Math.round(n));

function formatSince(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// Top-of-tab hero: every token recorded since Agent Pulse started tracking.
// Deliberately ignores the range filter — it sits above it.
export const LifetimeTokensCard: React.FC = () => {
  const { data, loading } = useLifetimeTokens();

  if (loading && !data) {
    return (
      <Card>
        <SkeletonLine width='100%' height='7.5rem' />
      </Card>
    );
  }
  // Timeline unavailable — the banner above already explains why.
  if (!data) return null;

  if (data.totalTokens === 0) {
    return (
      <Card>
        <Eyebrow className='mb-2'>Tokens to date</Eyebrow>
        <EmptyState message='No token usage recorded yet.' />
      </Card>
    );
  }

  const total = data.totalTokens;

  return (
    <Card>
      <div className='flex items-end justify-between gap-4 flex-wrap mb-4'>
        <div className='min-w-0'>
          <Eyebrow className='mb-1'>Tokens to date</Eyebrow>
          <Tooltip content={`${total.toLocaleString()} tokens`}>
            <p className='text-4xl font-semibold text-strong leading-none font-mono tabular-nums'>
              <AnimatedNumber value={total} format={formatTokens} />
            </p>
          </Tooltip>
          <p className='text-xs text-muted mt-2'>
            {data.firstSessionAt != null && <>since {formatSince(data.firstSessionAt)} · </>}
            {data.sessions.toLocaleString()} sessions
          </p>
        </div>
        <div className='text-right shrink-0'>
          <Eyebrow size='sm' className='mb-1'>Est. API value</Eyebrow>
          <p className='text-xl font-semibold text-ok font-mono tabular-nums leading-tight'>
            <AnimatedNumber value={data.costUsd} format={formatUsd} />
          </p>
        </div>
      </div>

      {/* Composition: one bar, four token classes, widths proportional. */}
      <div className='flex h-2 rounded-full overflow-hidden bg-glass/60 mb-3'>
        {CLASSES.map((c) => {
          const pct = (data[c.key] / total) * 100;
          return pct > 0 ? <div key={c.key} className={c.dot} style={{ width: `${pct}%` }} /> : null;
        })}
      </div>

      <div className='grid grid-cols-2 lg:grid-cols-4 gap-3'>
        {CLASSES.map((c) => {
          const value = data[c.key];
          const pct = (value / total) * 100;
          return (
            <div key={c.key} className='glass-secondary px-3 py-2 min-w-0'>
              <div className='flex items-center gap-1.5'>
                <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} />
                <Eyebrow size='sm' as='span'>{c.label}</Eyebrow>
              </div>
              <Tooltip content={`${value.toLocaleString()} tokens`}>
                <p className='text-base font-semibold text-primary font-mono tabular-nums mt-1 truncate'>
                  <AnimatedNumber value={value} format={formatTokens} />
                </p>
              </Tooltip>
              <p className='text-[10px] text-faint font-mono tabular-nums'>
                {pct > 0 && pct < 1 ? '<1' : pct.toFixed(0)}% of total
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

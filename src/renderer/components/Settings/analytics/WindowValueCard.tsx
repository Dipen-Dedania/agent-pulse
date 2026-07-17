import React from 'react';
import { WindowValueSlice } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { formatUsd } from '../../../../common/pricing';
import { useWindowValue } from './useAnalytics';
import { Card, CostBreakdownContent, EmptyState, InfoPill, InfoTooltip, SkeletonLine, formatCompactNumber } from './shared';

const WindowBlock: React.FC<{ label: string; slice: WindowValueSlice }> = ({ label, slice }) => (
  <div className='flex-1 min-w-0 bg-glass/40 border border-edge/40 rounded-xl p-4'>
    <p className='text-[10px] uppercase tracking-widest text-faint mb-1'>{label}</p>
    <div className='flex items-center gap-1.5'>
      <p className='text-2xl font-bold text-ok leading-tight font-mono tabular-nums'>
        {formatUsd(slice.costUsd)}
      </p>
      <InfoTooltip label={`${label} cost breakdown`}>
        <CostBreakdownContent
          tokensIn={slice.tokensIn}
          tokensOut={slice.tokensOut}
          cacheWrite={slice.cacheWrite}
          cacheRead={slice.cacheRead}
          breakdown={slice.costBreakdown}
          totalUsd={slice.costUsd}
        />
      </InfoTooltip>
    </div>
    <p className='text-[11px] text-faint mt-1 font-mono'>
      in {formatCompactNumber(slice.tokensIn)} · out {formatCompactNumber(slice.tokensOut)}
      {' · '}cache {formatCompactNumber(slice.cacheRead)}
    </p>
    <p className='text-[10px] text-ghost mt-0.5'>
      {slice.sessions} {slice.sessions === 1 ? 'session' : 'sessions'}
    </p>
  </div>
);

export const WindowValueCard: React.FC = () => {
  const { data, loading } = useWindowValue();
  const toolLabel = data ? (TOOL_META[data.toolId]?.label ?? data.toolId) : 'Claude Code';

  return (
    <Card
      title='Claude usage value'
      subtitle={`Estimated API-equivalent spend for ${toolLabel} — how much you're extracting from your plan.`}
    >
      <div className='mb-3 flex items-center gap-1.5'>
        <InfoPill>Estimated cost</InfoPill>
        <InfoTooltip label='How this cost is estimated'>
          <span className='text-[11px] text-body leading-snug'>
            Trailing windows priced at API list rates. The flat-rate plan you pay is fixed — this is what the
            same usage would cost on the API.
          </span>
        </InfoTooltip>
      </div>

      {loading && !data ? (
        <SkeletonLine width='100%' height='5rem' />
      ) : !data || data.last7d.sessions === 0 ? (
        <EmptyState message='No Claude Code activity in the last 7 days yet.' />
      ) : (
        <>
          <div className='flex flex-col sm:flex-row gap-3'>
            <WindowBlock label='Last 5 hours' slice={data.last5h} />
            <WindowBlock label='Last 7 days'  slice={data.last7d} />
          </div>
          <div className='mt-3 flex items-center justify-between text-[11px] text-muted font-mono tabular-nums'>
            <span>
              Burn rate <span className='text-primary'>{formatUsd(data.burnRateUsdPerHour)}/hr</span>
            </span>
            <span>
              Projected 5h at this pace <span className='text-warn'>{formatUsd(data.projected5hUsd)}</span>
            </span>
          </div>
        </>
      )}
    </Card>
  );
};

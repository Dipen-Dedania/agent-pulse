import React, { useState } from 'react';
import { GuardrailsAnalyticsRange } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { useGuardrailsAnalytics } from './useAnalytics';
import { Card, EmptyState, Segmented, SkeletonLine, formatCompactNumber } from './shared';

export const GuardrailsCard: React.FC = () => {
  const [range, setRange] = useState<GuardrailsAnalyticsRange>('30d');
  const { data, loading } = useGuardrailsAnalytics(range);

  return (
    <Card
      title='Guardrail trips'
      subtitle='Commands the engine flagged before they ran — totals, tool spread, and the rules that fired.'
      right={
        <Segmented
          value={range}
          onChange={(v) => setRange(v as GuardrailsAnalyticsRange)}
          options={[
            { value: '7d',  label: '7d' },
            { value: '30d', label: '30d' },
          ]}
        />
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='4rem' />
      ) : !data || data.total === 0 ? (
        <EmptyState message='No guardrail activity in this window.' />
      ) : (
        <div>
          <div className='grid grid-cols-3 gap-3 mb-5'>
            <Stat label='Total trips'  value={data.total} tone='neutral' />
            <Stat label='Warned'        value={data.warn}  tone='warn' />
            <Stat label='Blocked'       value={data.block} tone='block' />
          </div>

          {data.byTool.length > 0 && (
            <div className='mb-5'>
              <p className='text-[11px] uppercase tracking-wide text-slate-500 mb-2'>By tool</p>
              <div className='space-y-1.5'>
                {data.byTool.map((t) => {
                  const label = TOOL_META[t.toolId as ToolId]?.label ?? t.toolId;
                  return (
                    <div key={t.toolId} className='flex items-center gap-3 text-xs'>
                      <span className='text-slate-300 flex-1 truncate'>{label}</span>
                      <span className='text-slate-400 font-mono tabular-nums w-10 text-right'>{t.total}</span>
                      <span className='text-amber-300/90 font-mono tabular-nums w-12 text-right' title='Warn'>
                        {t.warn}w
                      </span>
                      <span className='text-rose-300/90 font-mono tabular-nums w-12 text-right' title='Block'>
                        {t.block}b
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data.byRule.length > 0 && (
            <div>
              <p className='text-[11px] uppercase tracking-wide text-slate-500 mb-2'>Top rules</p>
              <div className='space-y-1.5'>
                {data.byRule.slice(0, 8).map((r) => (
                  <div key={r.ruleId} className='flex items-start gap-3 text-xs'>
                    <span className='text-slate-300 flex-1 leading-snug'>
                      <span className='block truncate'>{r.message}</span>
                      <span className='block text-[10px] text-slate-500 font-mono truncate'>{r.ruleId}</span>
                    </span>
                    <span className='text-slate-400 font-mono tabular-nums shrink-0 mt-0.5'>
                      {formatCompactNumber(r.count)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

const Stat: React.FC<{ label: string; value: number; tone: 'neutral' | 'warn' | 'block' }> = ({ label, value, tone }) => {
  const toneCls =
    tone === 'warn'  ? 'text-amber-200 border-amber-500/30 bg-amber-500/10' :
    tone === 'block' ? 'text-rose-200  border-rose-500/30  bg-rose-500/10'  :
                       'text-slate-200 border-slate-700/60 bg-slate-900/40';
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneCls}`}>
      <p className='text-[10px] uppercase tracking-wide opacity-70'>{label}</p>
      <p className='text-lg font-semibold font-mono tabular-nums leading-tight mt-0.5'>
        {formatCompactNumber(value)}
      </p>
    </div>
  );
};

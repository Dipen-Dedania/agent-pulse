import React from 'react';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { Tooltip } from '../../Shared';
import { useSecretAccessAnalytics } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, SkeletonLine, formatCompactNumber } from './shared';

export const SecretProtectionCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useSecretAccessAnalytics(range);

  return (
    <Card
      title='Protected file reads'
      subtitle='Reads of secret files (.env, keys, credentials) the engine flagged — totals, tool spread, and the files agents kept reaching for.'
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='4rem' />
      ) : !data || data.total === 0 ? (
        <EmptyState message='No protected-file activity in this window.' />
      ) : (
        <div>
          <div className='grid grid-cols-3 gap-3 mb-5'>
            <Stat label='Total reads' value={data.total} tone='neutral' />
            <Stat label='Observed'    value={data.warn}  tone='warn' />
            <Stat label='Blocked'     value={data.block} tone='block' />
          </div>

          {data.byTool.length > 0 && (
            <div className='mb-5'>
              <p className='text-[11px] uppercase tracking-wide text-faint mb-2'>By tool</p>
              <div className='space-y-1.5'>
                {data.byTool.map((t) => {
                  const label = TOOL_META[t.toolId as ToolId]?.label ?? t.toolId;
                  return (
                    <div key={t.toolId} className='flex items-center gap-3 text-xs'>
                      <span className='text-body flex-1 truncate'>{label}</span>
                      <span className='text-muted font-mono tabular-nums w-10 text-right'>{t.total}</span>
                      <Tooltip content='Observed (warn)'>
                        <span className='text-warn/90 font-mono tabular-nums w-12 text-right'>
                          {t.warn}w
                        </span>
                      </Tooltip>
                      <Tooltip content='Blocked'>
                        <span className='text-danger/90 font-mono tabular-nums w-12 text-right'>
                          {t.block}b
                        </span>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {data.byFile.length > 0 && (
            <div className='mb-5'>
              <p className='text-[11px] uppercase tracking-wide text-faint mb-2'>Top files</p>
              <div className='space-y-1.5'>
                {data.byFile.slice(0, 8).map((f) => (
                  <div key={f.filePath} className='flex items-center gap-3 text-xs'>
                    <Tooltip content={f.filePath}>
                      <span className='text-body flex-1 font-mono truncate'>
                        {f.filePath}
                      </span>
                    </Tooltip>
                    <span className='text-muted font-mono tabular-nums shrink-0'>
                      {formatCompactNumber(f.count)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.byRule.length > 0 && (
            <div>
              <p className='text-[11px] uppercase tracking-wide text-faint mb-2'>Top rules</p>
              <div className='space-y-1.5'>
                {data.byRule.slice(0, 8).map((r) => (
                  <div key={r.ruleId} className='flex items-start gap-3 text-xs'>
                    <span className='text-body flex-1 leading-snug'>
                      <span className='block truncate'>{r.message}</span>
                      <span className='block text-[10px] text-faint font-mono truncate'>{r.ruleId}</span>
                    </span>
                    <span className='text-muted font-mono tabular-nums shrink-0 mt-0.5'>
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
    tone === 'warn'  ? 'text-warn border-amber-500/30 bg-amber-500/10' :
    tone === 'block' ? 'text-danger border-rose-500/30 bg-rose-500/10'  :
                       'text-primary border-edge/60 bg-inset/40';
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneCls}`}>
      <p className='text-[10px] uppercase tracking-wide opacity-70'>{label}</p>
      <p className='text-lg font-semibold font-mono tabular-nums leading-tight mt-0.5'>
        {formatCompactNumber(value)}
      </p>
    </div>
  );
};

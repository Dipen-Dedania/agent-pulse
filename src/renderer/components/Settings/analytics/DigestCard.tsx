import React from 'react';
import { DailyDigest } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { ToolId } from '../../../../common/types';
import { formatUsd } from '../../../../common/pricing';
import { useDigest } from './useAnalytics';
import { Card, EmptyState, InfoPill, SkeletonLine, formatCompactNumber, formatDuration } from './shared';

const DayColumn: React.FC<{ label: string; digest: DailyDigest | undefined }> = ({ label, digest }) => {
  if (!digest) {
    return (
      <div className='flex-1 min-w-0'>
        <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2'>{label}</p>
        <SkeletonLine width='60%' />
      </div>
    );
  }
  const hasAny = digest.perTool.length > 0;
  return (
    <div className='flex-1 min-w-0'>
      <div className='flex items-baseline gap-2 mb-3'>
        <p className='text-xs font-semibold uppercase tracking-widest text-slate-500'>{label}</p>
        <p className='text-[10px] text-slate-600 font-mono'>{digest.date}</p>
      </div>
      {!hasAny ? (
        <p className='text-sm text-slate-500 italic'>No agent activity yet.</p>
      ) : (
        <>
          <p className='text-2xl font-bold text-white leading-tight'>
            {formatDuration(digest.totalActiveMs)}
          </p>
          <p className='text-xs text-slate-500 mt-0.5'>total active</p>
          <div className='mt-4 flex flex-col gap-2'>
            {digest.perTool.map((t) => {
              const meta = TOOL_META[t.toolId as ToolId];
              return (
                <div key={t.toolId} className='flex items-center gap-2.5'>
                  <div className='w-6 h-6 rounded-md bg-slate-700/60 flex items-center justify-center shrink-0'>
                    <img src={meta?.icon} alt={meta?.label ?? t.toolId} className='w-4 h-4 object-contain' />
                  </div>
                  <div className='flex-1 min-w-0'>
                    <p className='text-xs font-medium text-slate-200 truncate'>{meta?.label ?? t.toolId}</p>
                    {t.topTask && <p className='text-[10px] text-slate-500 truncate'>{t.topTask}</p>}
                  </div>
                  <div className='text-right shrink-0'>
                    <p className='text-xs font-mono text-slate-300'>{formatDuration(t.activeMs)}</p>
                    <p className='text-[10px] text-slate-500'>{t.sessions} {t.sessions === 1 ? 'session' : 'sessions'}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {digest.tokens && (
            <div className='mt-4 pt-3 border-t border-slate-700/60'>
              <div className='flex items-center gap-2 mb-2'>
                <p className='text-[10px] uppercase tracking-widest text-slate-500'>Tokens</p>
                <InfoPill>token-reporting agents</InfoPill>
              </div>
              <div className='grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono'>
                <span className='text-slate-400'>in</span>
                <span className='text-slate-200 text-right'>{formatCompactNumber(digest.tokens.tokensIn)}</span>
                <span className='text-slate-400'>out</span>
                <span className='text-slate-200 text-right'>{formatCompactNumber(digest.tokens.tokensOut)}</span>
                <span className='text-slate-400'>cache rd</span>
                <span className='text-slate-200 text-right'>{formatCompactNumber(digest.tokens.cacheRead)}</span>
                <span className='text-slate-400'>cache wr</span>
                <span className='text-slate-200 text-right'>{formatCompactNumber(digest.tokens.cacheWrite)}</span>
              </div>
              {digest.tokens.costUsd > 0 && (
                <div className='flex items-center justify-between mt-2 pt-2 border-t border-slate-700/40'>
                  <span className='text-[10px] uppercase tracking-widest text-slate-500'>Est. spend</span>
                  <span className='text-sm font-semibold text-emerald-300 font-mono tabular-nums'>
                    {formatUsd(digest.tokens.costUsd)}
                  </span>
                </div>
              )}
            </div>
          )}
          {digest.quota.length > 0 && (
            <div className='mt-4 pt-3 border-t border-slate-700/60'>
              <p className='text-[10px] uppercase tracking-widest text-slate-500 mb-2'>Quota burned</p>
              <div className='flex flex-col gap-1.5'>
                {digest.quota.map((q) => (
                  <div key={`${q.toolId}/${q.windowKey}`} className='flex items-center justify-between text-[11px]'>
                    <span className='text-slate-400'>
                      {TOOL_META[q.toolId as ToolId]?.label ?? q.toolId} · {q.windowKey}
                    </span>
                    <span className={`font-mono ${q.deltaPct != null && q.deltaPct > 0 ? 'text-amber-300' : 'text-slate-500'}`}>
                      {q.deltaPct != null ? `${q.deltaPct.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const DigestCard: React.FC = () => {
  const { data, loading } = useDigest();

  return (
    <Card
      title='Daily digest'
      subtitle='Active time, sessions, tokens, and quota burned for today and yesterday.'
    >
      {loading && !data ? (
        <div className='flex flex-col gap-3'>
          <SkeletonLine width='40%' />
          <SkeletonLine width='80%' />
          <SkeletonLine width='60%' />
        </div>
      ) : !data ? (
        <EmptyState message='Analytics unavailable. Restart the app to retry.' />
      ) : (
        <div className='flex flex-col md:flex-row gap-6'>
          <DayColumn label='Today' digest={data.today} />
          <div className='hidden md:block w-px bg-slate-700/60' />
          <DayColumn label='Yesterday' digest={data.yesterday} />
        </div>
      )}
    </Card>
  );
};

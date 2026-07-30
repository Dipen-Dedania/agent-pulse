import React from 'react';
import { useBacklogStats } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, SkeletonLine, InfoPill, InfoTooltip, formatCompactNumber, formatDuration, useChartTip } from './shared';
import { formatUsd } from '../../../../common/pricing';

// Overnight Backlog — what the backlog planner actually shipped. Sourced from
// the backlog DB (applied execution cards), NOT the timeline. Bar charts only,
// per product preference. Costs are ESTIMATED API list prices (attempt
// cost_usd), consistent with the rest of the Analytics tab — never plan billing.

// One KPI in the hero row. Kept dependency-free so the four stats read as a set.
const Stat: React.FC<{ label: string; value: string; hint?: React.ReactNode; tone?: 'ok' | 'default' }> = ({
  label, value, hint, tone = 'default',
}) => (
  <div className='flex-1 min-w-[7rem]'>
    <div className='flex items-center gap-1'>
      <p className='text-[11px] uppercase tracking-wider text-faint'>{label}</p>
      {hint}
    </div>
    <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone === 'ok' ? 'text-ok' : 'text-strong'}`}>{value}</p>
  </div>
);

export const BacklogShippedCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useBacklogStats(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  const hasData = data && (data.shipped > 0 || data.alreadyPresent > 0 || data.doneWithDiff > 0 || data.awaitingReview > 0);
  const dayMax = data ? Math.max(...data.perDay.map((d) => d.autorun + d.manual), 1) : 1;
  const projMax = data ? Math.max(...data.perProject.map((p) => p.shipped), 1) : 1;
  const autonomousPct = data && data.shipped > 0 ? Math.round((data.fromAutorun / data.shipped) * 100) : 0;

  return (
    <Card
      title='Overnight Backlog'
      subtitle='What the backlog planner shipped into your projects — applied worktree diffs.'
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='11rem' />
      ) : !hasData ? (
        <EmptyState message='No backlog diffs shipped in this window yet. Apply an execution card to the project to see it here.' />
      ) : (
        <div className='flex flex-col gap-5'>
          {/* Hero KPIs */}
          <div className='flex flex-wrap gap-4'>
            <Stat label='Shipped' value={String(data!.shipped)} tone='ok' />
            <Stat
              label='Ship rate'
              value={`${data!.shipRatePct}%`}
              hint={
                <InfoTooltip label='How ship rate is computed'>
                  Of the {data!.doneWithDiff} execution card{data!.doneWithDiff === 1 ? '' : 's'} that produced a
                  reviewable diff in this window, {data!.shipped} {data!.shipped === 1 ? 'was' : 'were'} applied to the project.
                </InfoTooltip>
              }
            />
            <Stat
              label='Autonomous'
              value={`${autonomousPct}%`}
              hint={
                <InfoTooltip label='What autonomous means'>
                  Share of shipped diffs produced by an unattended autorun (the scheduler) rather than a manual
                  “Run now” — i.e. work the planner did for you overnight.
                </InfoTooltip>
              }
            />
            <Stat label='Work landed' value={formatDuration(data!.minutesLanded * 60_000)} hint={
              <InfoTooltip label='Work landed'>
                Sum of your own time estimates on the shipped cards — a rough “how much queued work landed”, not measured wall-clock.
              </InfoTooltip>
            } />
          </div>

          {/* Shipped per period — stacked autorun / manual bars */}
          <div>
            <div className='flex items-center justify-between mb-1.5'>
              <p className='text-[11px] text-muted'>Shipped over time</p>
              <div className='flex items-center gap-3 text-[10px] text-faint'>
                <span className='flex items-center gap-1'><span className='w-2 h-2 rounded-sm bg-emerald-400/70' /> autorun</span>
                <span className='flex items-center gap-1'><span className='w-2 h-2 rounded-sm bg-sky-400/70' /> manual</span>
              </div>
            </div>
            <div className='relative flex items-end gap-[3px] h-24'>
              {data!.perDay.map((d) => {
                const total = d.autorun + d.manual;
                const pct = total === 0 ? 0 : Math.max(4, (total / dayMax) * 100);
                return (
                  <div
                    key={d.date}
                    className='flex-1 flex flex-col justify-end'
                    style={{ height: '100%' }}
                    {...tipHandlers(
                      <span>
                        <span className='font-semibold text-strong'>{total} shipped</span>
                        <span className='text-muted'> · {d.date} · {d.autorun} autorun / {d.manual} manual</span>
                      </span>,
                    )}
                  >
                    {/* One bar, split proportionally: manual on top, autorun at the base. */}
                    <div className='w-full rounded-t overflow-hidden flex flex-col' style={{ height: `${pct}%` }}>
                      {d.manual > 0 && <div className='bg-sky-400/60' style={{ flexGrow: d.manual }} />}
                      {d.autorun > 0 && <div className='bg-emerald-400/60' style={{ flexGrow: d.autorun }} />}
                      {total === 0 && <div className='bg-control/30 h-full' />}
                    </div>
                  </div>
                );
              })}
            </div>
            {data!.perDay.length > 0 && (
              <div className='flex justify-between mt-1.5 text-[10px] text-faint font-mono'>
                <span>{data!.perDay[0].date}</span>
                <span>{data!.perDay[data!.perDay.length - 1].date}</span>
              </div>
            )}
          </div>

          {/* Shipped by project — horizontal bars */}
          {data!.perProject.length > 0 && (
            <div>
              <p className='text-[11px] text-muted mb-1.5'>By project</p>
              <div className='flex flex-col gap-1'>
                {data!.perProject.map((p) => (
                  <div key={p.projectId} className='flex items-center gap-2'>
                    <span className='w-28 shrink-0 truncate text-[11px] text-body' title={p.name}>{p.name}</span>
                    <div className='flex-1 h-3.5 rounded bg-inset/40 overflow-hidden'>
                      <div
                        className='h-full bg-emerald-400/50 rounded'
                        style={{ width: `${Math.max(6, (p.shipped / projMax) * 100)}%` }}
                        {...tipHandlers(<span><span className='font-semibold text-strong'>{p.shipped}</span> shipped · {p.name}</span>)}
                      />
                    </div>
                    <span className='w-6 text-right text-[11px] font-mono tabular-nums text-muted'>{p.shipped}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Method + code volume + estimated cost, and the review backlog */}
          <div className='flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 border-t border-edge/40 text-[11px] text-muted'>
            <span className='font-mono tabular-nums'>
              <span className='text-ok'>+{formatCompactNumber(data!.additions)}</span>{' '}
              <span className='text-danger'>−{formatCompactNumber(data!.deletions)}</span>{' '}
              <span className='text-faint'>across {data!.filesTouched} file{data!.filesTouched === 1 ? '' : 's'}</span>
            </span>
            <span className='text-faint'>
              clean {data!.methodBreakdown.clean} · 3-way {data!.methodBreakdown.threeWay} · stashed {data!.methodBreakdown.stashed}
              {data!.methodBreakdown.manual > 0 && ` · manual ${data!.methodBreakdown.manual}`}
              {data!.alreadyPresent > 0 && ` · already-present ${data!.alreadyPresent}`}
            </span>
            <span className='flex items-center gap-1'>
              ≈{formatUsd(data!.costUsdLanded)}
              <InfoTooltip label='Estimated cost'>
                Total estimated API-list-price spend across the runs that produced these shipped diffs. An estimate, not your plan billing.
              </InfoTooltip>
            </span>
            {data!.awaitingReview > 0 && (
              <span className='ml-auto'>
                <InfoPill tone='warn'>
                  {data!.awaitingReview} diff{data!.awaitingReview === 1 ? '' : 's'} awaiting review
                </InfoPill>
              </span>
            )}
          </div>
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

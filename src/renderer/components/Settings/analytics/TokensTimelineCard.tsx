import React, { useMemo, useState } from 'react';
import { TokensTimelineBucket } from '../../../../common/timeline-types';
import { formatUsd } from '../../../../common/pricing';
import { useTokensTimeline } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, Segmented, SkeletonLine, formatCompactNumber, useChartTip } from './shared';

const W = 600;
const H = 140;
const PAD_X = 4;
const PAD_TOP = 6;

const FRESH_FILL   = 'rgba(96, 165, 250, 0.22)';   // blue-400
const FRESH_STROKE = 'rgba(96, 165, 250, 0.95)';
const RATIO_FILL   = 'rgba(148, 163, 184, 0.12)';  // slate-400
const RATIO_STROKE = 'rgba(148, 163, 184, 0.85)';

type Metric = 'tokens' | 'cost';
type TokenView = 'fresh' | 'ratio';

interface Point { x: number; y: number; }

function buildArea(points: Point[]): string {
  if (points.length === 0) return '';
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  const last  = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x.toFixed(2)},${H} L ${first.x.toFixed(2)},${H} Z`;
}

function buildLine(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

// Cache-read share of all input the model saw that day. 0 when the day had
// no input at all.
function cacheRatio(b: TokensTimelineBucket): number {
  const denom = b.cacheRead + b.tokensIn;
  return denom > 0 ? b.cacheRead / denom : 0;
}

export const TokensTimelineCard: React.FC = () => {
  const range = useGlobalRange();
  const [metric, setMetric] = useState<Metric>('tokens');
  const [tokenView, setTokenView] = useState<TokenView>('fresh');
  const { data, loading } = useTokensTimeline(range);
  const { tipHandlers, tipOverlay } = useChartTip();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const isCost = metric === 'cost';
  const isRatio = !isCost && tokenView === 'ratio';
  const n = data?.buckets.length ?? 0;
  const innerW = W - PAD_X * 2;
  const step = n > 1 ? innerW / (n - 1) : 0;
  const xs = (i: number) => PAD_X + i * step;
  const yScale = (v: number, max: number) =>
    max > 0 ? H - PAD_TOP - (v / max) * (H - PAD_TOP) : H;

  // Discrete bars stop being readable past ~100 buckets (the 3px gaps alone
  // would overflow the card), so the cost view rolls long ranges up to weeks.
  const barsAreWeekly = n > 100;
  const costBars = useMemo<TokensTimelineBucket[]>(() => {
    if (!data) return [];
    if (!barsAreWeekly) return data.buckets;
    const weeks: TokensTimelineBucket[] = [];
    for (let i = 0; i < data.buckets.length; i += 7) {
      const chunk = data.buckets.slice(i, i + 7);
      const week = { date: chunk[0].date, tokensIn: 0, tokensOut: 0, cacheRead: 0, costUsd: 0 };
      for (const b of chunk) {
        week.tokensIn  += b.tokensIn;
        week.tokensOut += b.tokensOut;
        week.cacheRead += b.cacheRead;
        week.costUsd   += b.costUsd;
      }
      weeks.push(week);
    }
    return weeks;
  }, [data, barsAreWeekly]);
  const costBarMax = useMemo(
    () => costBars.reduce((max, b) => Math.max(max, b.costUsd), 0),
    [costBars],
  );

  // Primary SVG series: fresh tokens, or the cache-read ratio on a fixed
  // 0–100% scale (one axis — never two scales overlaid on one plot).
  const primaryPoints: Point[] = data
    ? data.buckets.map((b, i) => ({
        x: xs(i),
        y: isRatio
          ? yScale(cacheRatio(b), 1)
          : yScale(b.tokensIn + b.tokensOut, data.maxFresh),
      }))
    : [];
  const stroke = isRatio ? RATIO_STROKE : FRESH_STROKE;
  const fill   = isRatio ? RATIO_FILL   : FRESH_FILL;

  const avgRatio = useMemo(() => {
    if (!data) return 0;
    const withInput = data.buckets.filter((b) => b.cacheRead + b.tokensIn > 0);
    if (withInput.length === 0) return 0;
    return withInput.reduce((s, b) => s + cacheRatio(b), 0) / withInput.length;
  }, [data]);

  const axisLabels = data
    ? (() => {
        const last = data.buckets.length - 1;
        if (last <= 0) return [] as { i: number; date: string }[];
        const mid = Math.floor(last / 2);
        return [
          { i: 0,    date: data.buckets[0].date },
          { i: mid,  date: data.buckets[mid].date },
          { i: last, date: data.buckets[last].date },
        ];
      })()
    : [];

  const bucketTip = (b: TokensTimelineBucket) => (
    <span>
      <span className='font-semibold text-strong'>
        {isRatio ? `${(cacheRatio(b) * 100).toFixed(0)}% cache` : formatCompactNumber(b.tokensIn + b.tokensOut)}
      </span>
      <span className='text-muted'>
        {' '}· {b.date} · in {formatCompactNumber(b.tokensIn)} / out {formatCompactNumber(b.tokensOut)}
        {' '}· cache {formatCompactNumber(b.cacheRead)} · {formatUsd(b.costUsd)} est.
      </span>
    </span>
  );

  return (
    <Card
      title={isCost ? (barsAreWeekly ? 'Spend per week' : 'Spend per day') : isRatio ? 'Cache hit ratio' : 'Tokens per day'}
      subtitle={isCost
        ? `Estimated API-equivalent cost by ${barsAreWeekly ? 'week' : 'day'} — spot expensive ${barsAreWeekly ? 'weeks' : 'days'} at a glance.`
        : isRatio
          ? 'Share of input the prompt cache served each day — higher is cheaper.'
          : 'Fresh in+out tokens by day — spot heavy-spend days at a glance.'}
      right={
        <div className='flex gap-2 flex-wrap'>
          <Segmented
            value={metric}
            onChange={(v) => setMetric(v as Metric)}
            options={[
              { value: 'tokens', label: 'Tokens' },
              { value: 'cost',   label: 'Cost' },
            ]}
          />
          {!isCost && (
            <Segmented
              value={tokenView}
              onChange={(v) => setTokenView(v as TokenView)}
              options={[
                { value: 'fresh', label: 'Fresh' },
                { value: 'ratio', label: 'Cache %' },
              ]}
            />
          )}
        </div>
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='9rem' />
      ) : !data || data.totalFresh + data.totalCacheRead === 0 ? (
        <EmptyState message='No token activity in this window yet.' />
      ) : (
        <div>
          {/* Peak/average annotation carries the scale the missing y-axis would. */}
          <div className='mb-2 flex items-center gap-4 text-[11px] text-muted font-mono tabular-nums'>
            {isCost ? (
              <>
                <span>est. spend <span className='text-ok'>{formatUsd(data.totalCostUsd)}</span></span>
                <span>peak <span className='text-primary'>{formatUsd(costBarMax)}</span>/{barsAreWeekly ? 'wk' : 'day'}</span>
              </>
            ) : isRatio ? (
              <span>avg <span className='text-primary'>{(avgRatio * 100).toFixed(0)}%</span> of input served from cache</span>
            ) : (
              <>
                <span>fresh <span className='text-primary'>{formatCompactNumber(data.totalFresh)}</span></span>
                <span>cache <span className='text-primary'>{formatCompactNumber(data.totalCacheRead)}</span></span>
                <span>peak <span className='text-primary'>{formatCompactNumber(data.maxFresh)}</span>/day</span>
              </>
            )}
          </div>
          {isCost ? (
            <div className='flex items-end gap-[3px] h-36'>
              {costBars.map((b) => {
                const fresh = b.tokensIn + b.tokensOut;
                // Floor a non-zero bucket at 4% so a tiny spend still shows a sliver.
                const pct = b.costUsd > 0 && costBarMax > 0
                  ? Math.max(4, (b.costUsd / costBarMax) * 100)
                  : 0;
                const bucketLabel = barsAreWeekly ? `week of ${b.date}` : b.date;
                return (
                  <div
                    key={b.date}
                    className='flex-1 bg-emerald-500/40 hover:bg-emerald-400/70 rounded-t transition-colors'
                    style={{ height: `${pct}%` }}
                    {...tipHandlers(
                      <span>
                        <span className='font-semibold text-strong'>{formatUsd(b.costUsd)} est.</span>
                        <span className='text-muted'> · {bucketLabel} · fresh {formatCompactNumber(fresh)} tokens</span>
                      </span>,
                    )}
                  />
                );
              })}
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio='none'
              className='w-full h-36'
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Recessive hairline at half scale for magnitude reading. */}
              <line x1={0} x2={W} y1={(H + PAD_TOP) / 2} y2={(H + PAD_TOP) / 2}
                stroke='rgba(51, 65, 85, 0.5)' strokeWidth={1} vectorEffect='non-scaling-stroke' />
              <path d={buildArea(primaryPoints)} fill={fill} />
              <path d={buildLine(primaryPoints)} fill='none' stroke={stroke} strokeWidth={1.5} vectorEffect='non-scaling-stroke' />
              {/* Crosshair snaps to the hovered bucket. */}
              {hoverIdx != null && (
                <line
                  x1={xs(hoverIdx)} x2={xs(hoverIdx)} y1={0} y2={H}
                  stroke='rgba(148, 163, 184, 0.5)' strokeWidth={1} vectorEffect='non-scaling-stroke'
                />
              )}
              {/* Hover hit-targets, one per bucket */}
              {data.buckets.map((b, i) => {
                const rectW = step > 0 ? step : innerW;
                const rectX = step > 0 ? xs(i) - step / 2 : PAD_X;
                const handlers = tipHandlers(bucketTip(b));
                return (
                  <rect
                    key={b.date}
                    x={Math.max(0, rectX)}
                    y={0}
                    width={rectW}
                    height={H}
                    fill='transparent'
                    {...handlers}
                    onMouseEnter={(e) => { setHoverIdx(i); handlers.onMouseEnter(e); }}
                  />
                );
              })}
            </svg>
          )}
          <div className='flex justify-between mt-1 text-[10px] text-faint font-mono'>
            {axisLabels.map((l) => (
              <span key={l.date}>{l.date}</span>
            ))}
          </div>
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

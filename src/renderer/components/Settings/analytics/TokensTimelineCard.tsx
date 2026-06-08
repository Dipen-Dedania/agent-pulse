import React, { useState } from 'react';
import { TokensTimelineRange } from '../../../../common/timeline-types';
import { formatUsd } from '../../../../common/pricing';
import { useTokensTimeline } from './useAnalytics';
import { Card, EmptyState, Segmented, SkeletonLine, formatCompactNumber } from './shared';

const W = 600;
const H = 140;
const PAD_X = 4;
const PAD_TOP = 6;

const FRESH_FILL   = 'rgba(96, 165, 250, 0.22)';   // blue-400
const FRESH_STROKE = 'rgba(96, 165, 250, 0.95)';
const CACHE_FILL   = 'rgba(148, 163, 184, 0.10)';  // slate-400, faint
const CACHE_STROKE = 'rgba(148, 163, 184, 0.55)';
const COST_FILL    = 'rgba(52, 211, 153, 0.20)';   // emerald-400
const COST_STROKE  = 'rgba(52, 211, 153, 0.95)';

type Metric = 'tokens' | 'cost';

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

export const TokensTimelineCard: React.FC = () => {
  const [range, setRange] = useState<TokensTimelineRange>('30d');
  const [metric, setMetric] = useState<Metric>('tokens');
  const [showCache, setShowCache] = useState<'on' | 'off'>('off');
  const { data, loading } = useTokensTimeline(range);

  const isCost = metric === 'cost';
  const n = data?.buckets.length ?? 0;
  const innerW = W - PAD_X * 2;
  const step = n > 1 ? innerW / (n - 1) : 0;
  const xs = (i: number) => PAD_X + i * step;
  const yScale = (v: number, max: number) =>
    max > 0 ? H - PAD_TOP - (v / max) * (H - PAD_TOP) : H;

  // Primary series: fresh tokens, or estimated cost.
  const primaryMax = data ? (isCost ? data.maxCost : data.maxFresh) : 0;
  const primaryFill   = isCost ? COST_FILL   : FRESH_FILL;
  const primaryStroke = isCost ? COST_STROKE : FRESH_STROKE;
  const primaryPoints: Point[] = data
    ? data.buckets.map((b, i) => ({
        x: xs(i),
        y: yScale(isCost ? b.costUsd : b.tokensIn + b.tokensOut, primaryMax),
      }))
    : [];
  const cachePoints: Point[] = data
    ? data.buckets.map((b, i) => ({ x: xs(i), y: yScale(b.cacheRead, data.maxCacheRead) }))
    : [];

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

  return (
    <Card
      title={isCost ? 'Spend per day' : 'Tokens per day'}
      subtitle={isCost
        ? 'Estimated API-equivalent cost by day — spot expensive days at a glance.'
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
              value={showCache}
              onChange={(v) => setShowCache(v as 'on' | 'off')}
              options={[
                { value: 'off', label: 'Fresh' },
                { value: 'on',  label: '+ Cache' },
              ]}
            />
          )}
          <Segmented
            value={range}
            onChange={(v) => setRange(v as TokensTimelineRange)}
            options={[
              { value: '7d',  label: '7d' },
              { value: '30d', label: '30d' },
              { value: '90d', label: '90d' },
            ]}
          />
        </div>
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='9rem' />
      ) : !data || data.totalFresh + data.totalCacheRead === 0 ? (
        <EmptyState message='No token activity in this window yet.' />
      ) : (
        <div>
          <div className='mb-2 flex items-center gap-4 text-[11px] text-slate-400 font-mono tabular-nums'>
            {isCost ? (
              <span>
                est. spend <span className='text-emerald-300'>{formatUsd(data.totalCostUsd)}</span>
              </span>
            ) : (
              <>
                <span>
                  fresh <span className='text-slate-200'>{formatCompactNumber(data.totalFresh)}</span>
                </span>
                <span>
                  cache <span className='text-slate-200'>{formatCompactNumber(data.totalCacheRead)}</span>
                </span>
                {showCache === 'on' && (
                  <span className='text-[10px] text-slate-500'>cache scaled independently</span>
                )}
              </>
            )}
          </div>
          {/* Cost: discrete daily bars (solid CSS bars, matching the
              Hour-of-day rhythm chart so the two read as a family). Tokens:
              smooth SVG area+line, which suits a continuous flow. */}
          {isCost ? (
            <div className='flex items-end gap-[3px] h-36'>
              {data.buckets.map((b) => {
                const fresh = b.tokensIn + b.tokensOut;
                // Floor a non-zero day at 4% so a tiny spend still shows a sliver.
                const pct = b.costUsd > 0 && primaryMax > 0
                  ? Math.max(4, (b.costUsd / primaryMax) * 100)
                  : 0;
                return (
                  <div
                    key={b.date}
                    className='flex-1 bg-emerald-500/40 hover:bg-emerald-400/60 rounded-t transition-colors'
                    style={{ height: `${pct}%` }}
                    title={`${b.date} · ${formatUsd(b.costUsd)} est. · fresh ${fresh.toLocaleString()} tokens`}
                  />
                );
              })}
            </div>
          ) : (
            <svg
              viewBox={`0 0 ${W} ${H}`}
              preserveAspectRatio='none'
              className='w-full h-36'
            >
              {showCache === 'on' && data.maxCacheRead > 0 && (
                <>
                  <path d={buildArea(cachePoints)}  fill={CACHE_FILL} />
                  <path d={buildLine(cachePoints)}  fill='none' stroke={CACHE_STROKE} strokeWidth={1} vectorEffect='non-scaling-stroke' />
                </>
              )}
              {primaryMax > 0 && (
                <>
                  <path d={buildArea(primaryPoints)} fill={primaryFill} />
                  <path d={buildLine(primaryPoints)} fill='none' stroke={primaryStroke} strokeWidth={1.5} vectorEffect='non-scaling-stroke' />
                </>
              )}
              {/* Hover hit-targets, one per bucket */}
              {data.buckets.map((b, i) => {
                const fresh = b.tokensIn + b.tokensOut;
                const rectW = step > 0 ? step : innerW;
                const rectX = step > 0 ? xs(i) - step / 2 : PAD_X;
                return (
                  <rect
                    key={b.date}
                    x={Math.max(0, rectX)}
                    y={0}
                    width={rectW}
                    height={H}
                    fill='transparent'
                  >
                    <title>
                      {`${b.date} · fresh ${fresh.toLocaleString()} (in ${b.tokensIn.toLocaleString()} / out ${b.tokensOut.toLocaleString()}) · cache ${b.cacheRead.toLocaleString()} · ${formatUsd(b.costUsd)} est.`}
                    </title>
                  </rect>
                );
              })}
            </svg>
          )}
          <div className='flex justify-between mt-1 text-[10px] text-slate-500 font-mono'>
            {axisLabels.map((l) => (
              <span key={l.date}>{l.date}</span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

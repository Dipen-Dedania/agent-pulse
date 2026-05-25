import React, { useState } from 'react';
import { TokensTimelineRange } from '../../../../common/timeline-types';
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
  const [showCache, setShowCache] = useState<'on' | 'off'>('off');
  const { data, loading } = useTokensTimeline(range);

  const n = data?.buckets.length ?? 0;
  const innerW = W - PAD_X * 2;
  const step = n > 1 ? innerW / (n - 1) : 0;
  const xs = (i: number) => PAD_X + i * step;
  const yScale = (v: number, max: number) =>
    max > 0 ? H - PAD_TOP - (v / max) * (H - PAD_TOP) : H;

  const freshPoints: Point[] = data
    ? data.buckets.map((b, i) => ({ x: xs(i), y: yScale(b.tokensIn + b.tokensOut, data.maxFresh) }))
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
      title='Tokens per day'
      subtitle='Fresh in+out tokens by day — spot heavy-spend days at a glance.'
      right={
        <div className='flex gap-2 flex-wrap'>
          <Segmented
            value={showCache}
            onChange={(v) => setShowCache(v as 'on' | 'off')}
            options={[
              { value: 'off', label: 'Fresh' },
              { value: 'on',  label: '+ Cache' },
            ]}
          />
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
            <span>
              fresh <span className='text-slate-200'>{formatCompactNumber(data.totalFresh)}</span>
            </span>
            <span>
              cache <span className='text-slate-200'>{formatCompactNumber(data.totalCacheRead)}</span>
            </span>
            {showCache === 'on' && (
              <span className='text-[10px] text-slate-500'>
                cache scaled independently
              </span>
            )}
          </div>
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
            {data.maxFresh > 0 && (
              <>
                <path d={buildArea(freshPoints)} fill={FRESH_FILL} />
                <path d={buildLine(freshPoints)} fill='none' stroke={FRESH_STROKE} strokeWidth={1.5} vectorEffect='non-scaling-stroke' />
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
                    {`${b.date} · fresh ${fresh.toLocaleString()} (in ${b.tokensIn.toLocaleString()} / out ${b.tokensOut.toLocaleString()}) · cache ${b.cacheRead.toLocaleString()}`}
                  </title>
                </rect>
              );
            })}
          </svg>
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

import React from 'react';
import { AnimatedNumber, Eyebrow } from '../../Shared';
import { usePromptSize } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoTooltip, SkeletonLine, formatCompactNumber, useChartTip } from './shared';
import { ACTIVITY_EMPTY, AgentRow, StatTile } from './activityShared';

const NOTE =
  'Words in the messages you typed, read from Claude Code and ChatGPT (Codex) session files. Only the count is ' +
  'stored, never the text. Pasted text counts. Not counted: attached images and files, slash commands, ' +
  'the text of questions an agent asked you, and automated runs such as backlog cards.';

const round = (n: number) => Math.round(n).toString();

export const PromptSizeCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = usePromptSize(range);
  const { tipHandlers, tipOverlay } = useChartTip();

  const maxCount = data ? data.buckets.reduce((m, b) => Math.max(m, b.count), 0) : 0;

  return (
    <Card
      title='Prompt size'
      subtitle='How much you write per prompt, in words.'
      right={
        <InfoTooltip label='How this is counted'>
          <span className='text-[11px] text-body leading-snug'>{NOTE}</span>
        </InfoTooltip>
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='8rem' />
      ) : !data || data.prompts + data.imageOnlyPrompts === 0 ? (
        <EmptyState message={ACTIVITY_EMPTY} />
      ) : data.prompts === 0 ? (
        <EmptyState message={`Only image-only prompts in this window (${data.imageOnlyPrompts}), so there are no words to measure.`} />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-3 gap-3'>
            <StatTile label='Typical prompt' sub='median words'>
              <AnimatedNumber value={data.medianWords} format={round} />
            </StatTile>
            <StatTile label='Average' sub={`longest ${formatCompactNumber(data.longestWords)}`}>
              <AnimatedNumber value={data.avgWords} format={round} />
            </StatTile>
            <StatTile
              label='Prompts'
              sub={data.imageOnlyPrompts > 0 ? `+ ${data.imageOnlyPrompts} image-only` : 'with text'}
            >
              <AnimatedNumber value={data.prompts} format={formatCompactNumber} />
            </StatTile>
          </div>

          {/* How prompt lengths are spread */}
          <div>
            <Eyebrow size='sm' className='mb-2'>Words per prompt</Eyebrow>
            <div className='flex items-end gap-2 h-24'>
              {data.buckets.map((b) => {
                const pct = b.count > 0 && maxCount > 0 ? Math.max(6, (b.count / maxCount) * 100) : 0;
                const share = data.prompts > 0 ? (b.count / data.prompts) * 100 : 0;
                return (
                  <div
                    key={b.label}
                    className={`flex-1 rounded-t transition-colors ${
                      b.count > 0 ? 'bg-sky-500/45 hover:bg-sky-400/70' : 'bg-inset/40'
                    }`}
                    style={{ height: b.count > 0 ? `${pct}%` : '2px' }}
                    {...tipHandlers(
                      <span>
                        <span className='font-semibold text-strong'>{b.count} {b.count === 1 ? 'prompt' : 'prompts'}</span>
                        <span className='text-muted'> · {b.label} words · {share.toFixed(0)}%</span>
                      </span>,
                    )}
                  />
                );
              })}
            </div>
            <div className='flex gap-2 mt-1 text-[10px] text-faint font-mono'>
              {data.buckets.map((b) => <span key={b.label} className='flex-1 text-center'>{b.label}</span>)}
            </div>
          </div>

          <div className='space-y-1.5'>
            {data.agents.map((a) => (
              <AgentRow key={a.toolId} toolId={a.toolId}>
                <span className='text-muted font-mono tabular-nums shrink-0'>{formatCompactNumber(a.prompts)} prompts</span>
                <span className='text-primary font-mono tabular-nums shrink-0 w-24 text-right'>
                  {round(a.medianWords)} <span className='text-faint'>median</span>
                </span>
              </AgentRow>
            ))}
          </div>
          {tipOverlay}
        </div>
      )}
    </Card>
  );
};

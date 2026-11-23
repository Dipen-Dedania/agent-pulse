import React, { useMemo } from 'react';
import { Button } from '../../../Shared';
import { useCraft } from '../useAnalytics';
import { useGlobalRange } from '../rangeContext';
import { Card, SkeletonLine } from '../shared';
import { CraftInsight, evaluateCraft, topInsights } from './craftModel';

const KIND_CLASS: Record<CraftInsight['kind'], string> = {
  'needs-work': 'text-warn',
  slipped: 'text-warn',
  improved: 'text-ok',
};

/**
 * Overview's headline: the few craft findings worth acting on, each linking to
 * the full scorecard. Shares the Your craft fetch (useCraft), so opening the
 * craft tab afterwards costs nothing.
 */
export const TopInsightsCard: React.FC<{ onOpenCraft: () => void }> = ({ onOpenCraft }) => {
  const range = useGlobalRange();
  const { data, loading } = useCraft(range);
  const skills = useMemo(() => (data ? evaluateCraft(data) : []), [data]);
  const insights = useMemo(() => topInsights(skills), [skills]);
  const anyJudged = skills.some((s) => s.judged && s.enoughData);

  // Nothing to say without the timeline; the tab's banner already explains why.
  if (!loading && !data) return null;

  return (
    <Card
      title='Top insights'
      subtitle='What stands out in how you work with your agents.'
      right={
        <Button variant='ghost' size='xs' onClick={onOpenCraft}>
          Your craft →
        </Button>
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='4rem' />
      ) : !anyJudged ? (
        <p className='text-xs text-muted'>Not enough activity in this range yet. Try a longer range.</p>
      ) : insights.length === 0 ? (
        <p className='text-xs text-muted'>Nothing stands out: every skill is holding steady. Nice.</p>
      ) : (
        <ul className='flex flex-col gap-3'>
          {insights.map((ins) => (
            <li key={ins.skill} className='flex flex-col gap-0.5'>
              <p className='text-sm font-medium text-strong flex items-center gap-2'>
                <span className={`size-1.5 rounded-full bg-current shrink-0 ${KIND_CLASS[ins.kind]}`} aria-hidden />
                {ins.title}
              </p>
              <p className='text-xs text-body leading-snug'>{ins.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

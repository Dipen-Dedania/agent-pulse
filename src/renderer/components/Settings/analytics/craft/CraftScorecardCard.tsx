import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Eyebrow } from '../../../Shared';
import { tabContent, tabContentTransition } from '../../../../motion';
import { useCraft } from '../useAnalytics';
import { RANGE_LABEL, useGlobalRange } from '../rangeContext';
import { Card, EmptyState, InfoTooltip, SkeletonLine } from '../shared';
import { PromptSizeCard } from '../PromptSizeCard';
import { SubagentUseCard } from '../SubagentUseCard';
import { CadenceCard } from '../CadenceCard';
import { WaitingCard } from '../WaitingCard';
import { ContextPressureCard } from '../ContextPressureCard';
import { CacheHealthCard } from '../CacheHealthCard';
import { CompactionsCard } from '../CompactionsCard';
import { LifecycleCard } from '../LifecycleCard';
import { HourRhythmCard } from '../HourRhythmCard';
import { correlationInsight, evaluateCraft, pickFocus, SkillId, SkillView, sortSkills } from './craftModel';
import { BandBadge, SignalDelta, TipIcon, TrendLabel, formatSignal } from './craftUi';

// The existing analytics cards behind each skill, always shown under the scorecard
// for the selected skill (a toggle hid them from anyone who never clicked it).
const RELATED: Record<SkillId, { label: string; cards: React.FC[] }> = {
  clarity: { label: 'Prompt size', cards: [PromptSizeCard] },
  context: { label: 'Context pressure, cache health, compactions', cards: [ContextPressureCard, CacheHealthCard, CompactionsCard] },
  delegation: { label: 'Subagent use', cards: [SubagentUseCard] },
  flow: { label: 'Waiting on you', cards: [WaitingCard] },
  shape: { label: 'Cadence, session lifecycle, hour rhythm', cards: [CadenceCard, LifecycleCard, HourRhythmCard] },
};

// ─── Tile strip ──────────────────────────────────────────────────────────────

const SkillTile: React.FC<{
  skill: SkillView;
  selected: boolean;
  focus: boolean;
  onSelect: () => void;
}> = ({ skill, selected, focus, onSelect }) => {
  const dim = !skill.judged || !skill.enoughData;
  return (
    <button
      type='button'
      onClick={onSelect}
      aria-pressed={selected}
      className={`glass-secondary text-left px-3.5 py-3 flex flex-col gap-2 cursor-pointer transition-colors
        ${selected ? 'ring-2 ring-edge-strong/70' : 'hover:ring-1 hover:ring-edge-strong/50'}
        ${dim && !selected ? 'opacity-70' : ''}`}
    >
      <span className='flex items-center gap-1.5 min-w-0'>
        {focus && <span className='size-1.5 rounded-full bg-warn shrink-0' aria-label='Start here' />}
        <span className='text-sm font-semibold text-strong leading-tight truncate'>{skill.name}</span>
      </span>
      <span className='flex items-center gap-2 flex-wrap'>
        <BandBadge band={skill.band} enoughData={skill.enoughData} judged={skill.judged} />
        <TrendLabel trend={skill.trend} />
      </span>
    </button>
  );
};

// ─── Detail panel ────────────────────────────────────────────────────────────

const SkillDetail: React.FC<{
  skill: SkillView;
  focus: boolean;
  insight: string | null;
}> = ({ skill, focus, insight }) => (
  <div className='glass-secondary p-5'>
    {focus && (
      <Eyebrow size='sm' tone='muted' className='mb-2'>Start here: your biggest lever</Eyebrow>
    )}
    <div className='flex items-center gap-2 flex-wrap'>
      <h4 className='text-base font-semibold text-strong leading-tight'>{skill.name}</h4>
      <BandBadge band={skill.band} enoughData={skill.enoughData} judged={skill.judged} />
      <TrendLabel trend={skill.trend} />
      <span className='ml-auto'>
        <InfoTooltip label={`How ${skill.name.toLowerCase()} is judged`}>
          <span className='text-[11px] text-body leading-snug'>{skill.rule}</span>
        </InfoTooltip>
      </span>
    </div>
    {skill.reason && <p className='mt-1.5 text-sm text-body leading-snug'>{skill.reason}</p>}

    <div className='mt-4 flex flex-wrap gap-x-10 gap-y-3'>
      {skill.signals.map((s) => (
        <div key={s.label} className='min-w-0'>
          <Eyebrow size='sm'>{s.label}</Eyebrow>
          <p className='mt-0.5 text-lg font-mono tabular-nums text-primary flex items-baseline gap-1.5'>
            {formatSignal(s.value, s.format)}
            <SignalDelta trend={s.trend} direction={s.direction} />
          </p>
        </div>
      ))}
    </div>

    {insight && <p className='mt-3 text-xs text-body leading-snug'>{insight}</p>}

    <div className='mt-4 flex gap-2.5 items-start rounded-xl bg-info/10 px-3.5 py-3'>
      <TipIcon className='text-info shrink-0 mt-0.5' />
      <p className='text-sm text-body leading-snug'>{skill.tip}</p>
    </div>
    {skill.note && <p className='mt-2 text-[11px] text-faint leading-snug'>{skill.note}</p>}
  </div>
);

// ─── Card ────────────────────────────────────────────────────────────────────

export const CraftScorecardCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useCraft(range);
  const skills = useMemo(() => (data ? evaluateCraft(data) : []), [data]);
  const ordered = useMemo(() => sortSkills(skills), [skills]);
  const focus = useMemo(() => pickFocus(skills), [skills]);
  const insight = data ? correlationInsight(data.correlation) : null;

  // null → follow the focus skill (or the first tile when nothing needs attention).
  const [picked, setPicked] = useState<SkillId | null>(null);
  const activeId = picked ?? focus?.id ?? ordered[0]?.id ?? null;
  const active = ordered.find((s) => s.id === activeId) ?? null;

  const comparison = range === '1y'
    ? 'No trend for a 1-year range: history is kept for one year, so there is nothing earlier to compare.'
    : 'Trends compare with the period of the same length just before it.';

  const Related = active ? RELATED[active.id].cards : [];

  return (
    <>
      <Card
        title='Your craft'
        subtitle={`How you work with your agents, ${RANGE_LABEL[range]}. ${comparison}`}
      >
        {loading && !data ? (
          <SkeletonLine width='100%' height='14rem' />
        ) : !data || !active ? (
          <EmptyState message='Craft insights are unavailable while the Pulse Timeline is not running.' />
        ) : (
          <div className='flex flex-col gap-3'>
            {!focus && skills.some((s) => s.judged && s.enoughData) && (
              <p className='text-xs text-ok leading-snug'>Nothing needs attention right now. Pick a skill to see its numbers.</p>
            )}
            <div className='grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5'>
              {ordered.map((s) => (
                <SkillTile
                  key={s.id}
                  skill={s}
                  selected={s.id === active.id}
                  focus={s.id === focus?.id}
                  onSelect={() => setPicked(s.id)}
                />
              ))}
            </div>

            <AnimatePresence mode='wait'>
              <motion.div
                key={active.id}
                variants={tabContent}
                initial='initial'
                animate='animate'
                exit='exit'
                transition={tabContentTransition}
              >
                <SkillDetail
                  skill={active}
                  focus={active.id === focus?.id}
                  insight={active.id === 'clarity' ? insight : null}
                />
              </motion.div>
            </AnimatePresence>

            <p className='text-[11px] text-faint leading-snug'>
              Ratings use simple rules of thumb, not benchmarks; the info icon shows each skill&apos;s exact rule.
              Prompt and subagent figures come from Claude Code and ChatGPT (Codex) session files; context and cache
              figures from the Claude Code status line.
            </p>
          </div>
        )}
      </Card>

      {active && (
        <AnimatePresence mode='wait'>
          <motion.section
            key={active.id}
            variants={tabContent}
            initial='initial'
            animate='animate'
            exit='exit'
            transition={tabContentTransition}
            aria-label={`The data behind ${active.name}`}
          >
            <div className='mb-3 px-1 flex items-baseline gap-2 flex-wrap'>
              <Eyebrow>The data behind {active.name}</Eyebrow>
              <span className='text-[11px] text-faint'>{RELATED[active.id].label}</span>
            </div>
            <div className={Related.length > 1 ? 'grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-5' : ''}>
              {Related.map((C, i) => <C key={i} />)}
            </div>
          </motion.section>
        </AnimatePresence>
      )}
    </>
  );
};

import React, { useMemo } from 'react';
import { ClaudeCommandCategory, ClaudeCommandRow } from '../../../../common/timeline-types';
import { TOOL_META } from '../../../../common/toolMeta';
import { AnimatedNumber, Badge, BadgeTone, Eyebrow, Meter } from '../../Shared';
import { useClaudeCommands, useCompactions, useCraft } from './useAnalytics';
import { useGlobalRange } from './rangeContext';
import { Card, EmptyState, InfoTooltip, SkeletonLine, formatCompactNumber } from './shared';
import { StatTile } from './activityShared';
import { commandTips } from './craft/commandTips';
import { evaluateCraft } from './craft/craftModel';
import { TipIcon } from './craft/craftUi';

const TOP_COUNT = 10;

const CATEGORY_LABEL: Record<ClaudeCommandCategory, string> = {
  builtin: 'Built-in',
  custom: 'Your skill',
  plugin: 'Plugin / MCP',
  unknown: 'Other',
};
const CATEGORY_TONE: Record<ClaudeCommandCategory, BadgeTone> = {
  builtin: 'neutral',
  custom: 'info',
  plugin: 'ok',
  unknown: 'neutral',
};
const CATEGORY_BAR: Record<ClaudeCommandCategory, string> = {
  builtin: 'bg-blue-500/45',
  custom: 'bg-pink-500/45',
  plugin: 'bg-emerald-500/45',
  unknown: 'bg-control',
};

const NO_HISTORY =
  'No Claude Code command history found on this computer. Claude Code may be set not to save prompt history.';

// `/name` spans in a tip are written in backticks; show them as code.
const TipText: React.FC<{ text: string }> = ({ text }) => (
  <span>
    {text.split('`').map((part, i) => (
      i % 2 === 1
        ? <code key={i} className='font-mono text-primary'>{part}</code>
        : <React.Fragment key={i}>{part}</React.Fragment>
    ))}
  </span>
);

// "includes /new ×492" when a bar folds aliases into its main command.
function aliasNote(row: ClaudeCommandRow): string | null {
  const others = row.aliases.filter((a) => a.name !== row.canonical);
  if (others.length === 0) return null;
  return `includes ${others.map((a) => `/${a.name} ×${a.count}`).join(', ')}`;
}

function trendText(total: number, previous: number | null): string {
  if (previous === null) return 'typed in this range';
  if (previous === 0) return total > 0 ? 'none in the previous period' : 'same as the previous period';
  const pct = Math.round(((total - previous) / previous) * 100);
  if (pct === 0) return 'same as the previous period';
  return `${pct > 0 ? '+' : ''}${pct}% vs the previous period`;
}

export const SlashCommandsCard: React.FC = () => {
  const range = useGlobalRange();
  const { data, loading } = useClaudeCommands(range);
  const { data: compactions } = useCompactions(range);
  const { data: craft } = useCraft(range);

  const top = useMemo(() => (data?.top ?? []).slice(0, TOP_COUNT), [data]);
  const maxCount = top.reduce((m, row) => Math.max(m, row.count), 0);
  const typos = useMemo(() => (data?.unknown ?? []).filter((u) => u.suggestion !== null), [data]);
  const typoUses = typos.reduce((sum, u) => sum + u.count, 0);
  // Mentions can belong to a skill too rarely typed to reach the top list, so
  // they are also summed on the tile.
  const inlineMentions = (data?.top ?? []).reduce((sum, row) => sum + row.inline, 0);

  const tips = useMemo(() => {
    if (!data || data.total === 0) return [];
    const contextBand = craft ? evaluateCraft(craft).find((s) => s.id === 'context')?.band ?? null : null;
    return commandTips(data, {
      compactions: compactions ? { total: compactions.total, manual: compactions.manual } : null,
      contextBand,
    });
  }, [data, compactions, craft]);

  const since = data?.firstRecordedAt
    ? new Date(data.firstRecordedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  return (
    <Card
      title={
        <span className='inline-flex items-center gap-2 flex-wrap'>
          <img src={TOOL_META['claude-code'].icon} alt='' className='w-4 h-4 object-contain' />
          <span>Slash commands</span>
          <Badge tone='info' variant='tag' size='xs'>Claude Code only</Badge>
        </span>
      }
      subtitle="From Claude Code's prompt history. ChatGPT (Codex) doesn't save the commands you type, so it isn't counted here."
      right={
        <InfoTooltip label='How this is counted'>
          <span className='text-[11px] text-body leading-snug'>
            Read from <code className='font-mono'>history.jsonl</code> in your Claude Code config folder. Only the
            command name and its time are kept: never its arguments, the rest of your prompt or the project path.
            A command mentioned in the middle of a prompt counts only when it is one of your own skills or a plugin
            command.{since ? ` History starts ${since}.` : ''}
          </span>
        </InfoTooltip>
      }
    >
      {loading && !data ? (
        <SkeletonLine width='100%' height='8rem' />
      ) : !data || (!data.available && data.firstRecordedAt === null) ? (
        <EmptyState message={NO_HISTORY} />
      ) : data.total === 0 ? (
        <EmptyState message='No slash commands in this range' />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-2 md:grid-cols-4 gap-3'>
            <StatTile label='Commands run' sub={trendText(data.total, data.previousTotal)}>
              <AnimatedNumber value={data.total} format={formatCompactNumber} />
            </StatTile>
            <StatTile label='Distinct commands' sub={`in ${data.sessionsWithCommands} ${data.sessionsWithCommands === 1 ? 'session' : 'sessions'}`}>
              <AnimatedNumber value={data.distinct} format={formatCompactNumber} />
            </StatTile>
            <StatTile label='Your skills and commands' sub={
                inlineMentions > 0 ? `plus ${inlineMentions} mentioned mid-prompt`
                  : data.byCategory.plugin > 0 ? `plus ${data.byCategory.plugin} from plugins`
                    : 'runs of your own'
              }>
              <AnimatedNumber value={data.byCategory.custom} format={formatCompactNumber} />
            </StatTile>
            <StatTile label='Possible typos' sub={typoUses > 0 ? 'see below' : 'none found'} valueClass={typoUses > 0 ? 'text-warn' : 'text-primary'}>
              <AnimatedNumber value={typoUses} format={formatCompactNumber} />
            </StatTile>
          </div>

          <div>
            <Eyebrow size='sm' className='mb-2'>Top commands</Eyebrow>
            <div className='space-y-2'>
              {top.map((row) => {
                const pct = row.count > 0 && maxCount > 0 ? Math.max(2, (row.count / maxCount) * 100) : 0;
                const alias = aliasNote(row);
                return (
                  <div key={row.canonical} className='text-xs'>
                    <div className='flex items-center gap-2'>
                      <span className='font-mono text-body truncate'>/{row.canonical}</span>
                      <Badge tone={CATEGORY_TONE[row.category]} variant='tag' size='xs'>{CATEGORY_LABEL[row.category]}</Badge>
                      <span className='flex-1' />
                      <span className='text-primary font-mono tabular-nums shrink-0'>{formatCompactNumber(row.count)}</span>
                    </div>
                    <div className='mt-1'>
                      <Meter value={pct} size='sm' fillClass={CATEGORY_BAR[row.category]} />
                    </div>
                    {(alias || row.inline > 0) && (
                      <p className='text-[11px] text-muted mt-0.5'>
                        {[alias, row.inline > 0 ? `also mentioned mid-prompt ×${row.inline}` : null].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {typos.length > 0 && (
            <div>
              <Eyebrow size='sm' className='mb-2'>Possible typos</Eyebrow>
              <ul className='space-y-1'>
                {typos.map((u) => (
                  <li key={u.name} className='flex items-center gap-2 text-xs'>
                    <span className='font-mono text-body'>/{u.name}</span>
                    <span className='text-muted'>
                      did you mean <code className='font-mono text-primary'>/{u.suggestion}</code>?
                    </span>
                    <span className='flex-1' />
                    <span className='text-muted font-mono tabular-nums shrink-0'>×{u.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tips.length > 0 && (
            <ul className='flex flex-col gap-2'>
              {tips.map((tip) => (
                <li key={tip.id} className='text-xs text-body leading-snug flex gap-2'>
                  <TipIcon className={`${tip.tone === 'positive' ? 'text-ok' : 'text-info'} shrink-0 mt-px`} />
                  <TipText text={tip.text} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
};

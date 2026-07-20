import React from 'react';
import { BacklogCard, BacklogCardState } from '../../../common/backlog-types';
import { projectColor } from './project-colors';

export const TIER_META: Record<BacklogCard['riskTier'], { dot: string; label: string; hint: string }> = {
  green: { dot: 'bg-emerald-400', label: 'Green', hint: 'autoruns in scheduled windows' },
  amber: { dot: 'bg-amber-400', label: 'Amber', hint: 'manual Run now only' },
  red:   { dot: 'bg-red-400',   label: 'Red',   hint: 'manual Run now only' },
};

const ActionButton: React.FC<{
  onClick: () => void;
  title: string;
  danger?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ onClick, title, danger, disabled, children }) => (
  <button
    onClick={onClick}
    title={title}
    aria-label={title}
    disabled={disabled}
    className={`h-6 min-w-6 px-1 flex items-center justify-center rounded-md text-[11px] transition-colors ${
      disabled
        ? 'bg-control/30 text-ghost cursor-default'
        : danger
          ? 'bg-control/50 text-muted hover:bg-red-500/30 hover:text-danger cursor-pointer'
          : 'bg-control/50 text-body hover:bg-control-strong cursor-pointer'
    }`}
  >
    {children}
  </button>
);

// Compact "time in this column" — surfaces stuck cards per the spec's
// Failure Modes section. Quiet under an hour to keep fresh boards clean.
function formatAge(sinceMs: number): string | null {
  const mins = Math.floor((Date.now() - sinceMs) / 60_000);
  if (mins < 60) return null;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface Props {
  card: BacklogCard;
  projectName: string;
  /** What a flag-less run in this project resolves to — shown when the card has no override. */
  projectDefaultModel: string | null;
  isRunning: boolean;
  unmetPrereqs: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (state: BacklogCardState) => void;
  onRunNow: () => void;
  onStop: () => void;
  onReorder: (direction: -1 | 1) => void;
  onViewDetail: () => void;
  /** Blocked execution cards: discard the worktree, then re-run from a clean checkout. */
  onRestart: () => void;
}

export const CardTile: React.FC<Props> = ({
  card, projectName, projectDefaultModel, isRunning, unmetPrereqs, canMoveUp, canMoveDown,
  onEdit, onDelete, onMove, onRunNow, onStop, onReorder, onViewDetail, onRestart,
}) => {
  const tier = TIER_META[card.riskTier];
  const age = isRunning ? null : formatAge(card.updatedAt);

  return (
    <div className='bg-glass/40 border border-edge/50 rounded-xl p-3 flex flex-col gap-2'>
      <div className='flex items-start gap-2'>
        <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${tier.dot}`} title={`${tier.label} — ${tier.hint}`} />
        <p className='flex-1 min-w-0 text-sm font-medium text-strong leading-snug break-words'>{card.title}</p>
        {isRunning && (
          <span className='w-3.5 h-3.5 mt-0.5 border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin shrink-0' title='Running' />
        )}
      </div>

      <div className='flex items-center gap-2 flex-wrap text-[11px] text-muted'>
        {/* Task type: quiet "R" for research, called-out chips for execution/qa */}
        <span
          className={`px-1.5 py-0.5 rounded font-mono ${
            card.taskType === 'execution' ? 'bg-cyan-500/15 text-cyan-300'
              : card.taskType === 'qa' ? 'bg-purple-500/15 text-purple-300'
              : 'bg-control/40 text-faint'
          }`}
          title={
            card.taskType === 'execution' ? 'Execution — edits files in an isolated worktree'
              : card.taskType === 'qa' ? 'QA — read-only browser verification of the running app'
              : 'Research — read-only, produces a report'
          }
        >
          {card.taskType === 'execution' ? '⚡ exec' : card.taskType === 'qa' ? '👁 qa' : 'R'}
        </span>
        <span className={`px-1.5 py-0.5 rounded ${projectColor(card.projectId).chip}`}>{projectName}</span>
        {card.worktreePath && (
          <span title={`Worktree: ${card.worktreePath}`}>📁</span>
        )}
        {/* Effective model: card override stands out, inherited default stays quiet */}
        {(card.model ?? projectDefaultModel) && (
          <span
            className={`px-1.5 py-0.5 rounded ${
              card.model ? 'bg-indigo-500/15 text-indigo-300' : 'bg-control/40 text-faint'
            }`}
            title={card.model ? 'Model override for this card' : 'Project default model'}
          >
            {card.model ?? projectDefaultModel}
          </span>
        )}
        {card.estimatedMinutes != null && <span>~{card.estimatedMinutes}m</span>}
        {card.estimatedCostUsd != null && <span>~${card.estimatedCostUsd.toFixed(2)}</span>}
        {unmetPrereqs > 0 && (card.state === 'todo' || card.state === 'paused') && (
          <span
            className='px-1.5 py-0.5 rounded bg-amber-500/15 text-warn'
            title={`Autorun skips this card until ${unmetPrereqs} prerequisite card${unmetPrereqs === 1 ? ' is' : 's are'} Done — "Run now" overrides`}
          >
            ⧗ {unmetPrereqs} prereq{unmetPrereqs === 1 ? '' : 's'}
          </span>
        )}
        {age && (
          <span className='ml-auto text-faint' title='Time in this column since last activity'>
            {age}
          </span>
        )}
      </div>

      {card.state === 'blocked' && card.blockedReason && (
        <p className='text-[11px] text-danger/90 leading-snug break-words' title={card.blockedReason}>
          {card.blockedReason}
        </p>
      )}
      {card.state === 'paused' && (
        <p className='text-[11px] text-warn/80'>Interrupted — re-runs first in the next window.</p>
      )}
      {card.state === 'rework' && (
        <p className='text-[11px] text-orange-300/80'>QA failed — retries once automatically, then blocks.</p>
      )}

      <div className='flex items-center gap-1 flex-wrap'>
        {card.state === 'todo' && (
          <>
            {/* Only when the queue is actually reorderable — a lone card gets no arrows. */}
            {(canMoveUp || canMoveDown) && (
              <>
                <ActionButton onClick={() => onReorder(-1)} title='Move up' disabled={!canMoveUp}>↑</ActionButton>
                <ActionButton onClick={() => onReorder(1)} title='Move down' disabled={!canMoveDown}>↓</ActionButton>
              </>
            )}
            <ActionButton onClick={onRunNow} title='Run now'>▶ Run</ActionButton>
          </>
        )}
        {card.state === 'refinement' && (
          <ActionButton onClick={() => onMove('todo')} title='Queue for execution'>→ Todo</ActionButton>
        )}
        {card.state === 'paused' && (
          <>
            <ActionButton onClick={onRunNow} title='Run now'>▶ Run</ActionButton>
            <ActionButton onClick={() => onMove('todo')} title='Back to Todo'>→ Todo</ActionButton>
          </>
        )}
        {card.state === 'blocked' && (
          <>
            <ActionButton onClick={onViewDetail} title='Open the latest run’s summary, diff, and history — start here to see why it blocked'>
              📄 Report
            </ActionButton>
            <ActionButton
              onClick={onRunNow}
              title={
                card.taskType === 'execution' && card.worktreePath
                  ? 'Retry — re-run now in the existing worktree. Partial file changes are kept, and the agent gets the full prompt again (description, criteria, attachments).'
                  : 'Retry — re-run now with the full prompt (description and attachments).'
              }
            >
              ↻ Retry
            </ActionButton>
            {card.taskType === 'execution' && card.worktreePath && (
              <ActionButton
                onClick={onRestart}
                title='Restart — discard the worktree and re-run from a fresh checkout of the project. Any partial file changes are lost.'
                danger
              >
                ⟲ Restart
              </ActionButton>
            )}
          </>
        )}
        {card.state === 'rework' && (
          <>
            <ActionButton onClick={onRunNow} title='Run now'>▶ Run</ActionButton>
            <ActionButton onClick={() => onMove('todo')} title='Back to Todo'>→ Todo</ActionButton>
          </>
        )}
        {card.state === 'done' && (
          <>
            <ActionButton onClick={onViewDetail} title='View report'>📄 Report</ActionButton>
            <ActionButton onClick={() => onMove('todo')} title='Queue again'>→ Todo</ActionButton>
          </>
        )}
        {(card.state === 'in-progress' || card.state === 'claimed') && (
          <ActionButton onClick={onStop} title='Stop — discards the run, card moves to Paused' danger>
            ⏹ Stop
          </ActionButton>
        )}

        {card.state !== 'in-progress' && card.state !== 'claimed' && (
          <span className='ml-auto flex items-center gap-1'>
            {/* Done and Blocked already surface an explicit Report button. */}
            {card.state !== 'done' && card.state !== 'blocked' && (
              <ActionButton onClick={onViewDetail} title='History'>🕘</ActionButton>
            )}
            <ActionButton onClick={onEdit} title='Edit card'>✎</ActionButton>
            <ActionButton onClick={onDelete} title='Delete card' danger>✕</ActionButton>
          </span>
        )}
      </div>
    </div>
  );
};

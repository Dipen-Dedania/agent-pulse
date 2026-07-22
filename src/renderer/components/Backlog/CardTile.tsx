import React from 'react';
import { motion } from 'framer-motion';
import { BacklogCard, BacklogCardState } from '../../../common/backlog-types';
import { projectColor } from './project-colors';
import { hoverLift } from '../../motion';
import { Tooltip } from '../Shared';

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
  <Tooltip content={title}>
    <button
      onClick={onClick}
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
  </Tooltip>
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
    // hoverLift: subtle scale-up on hover, scale-down on press — springs back
    // via the shared `smooth` spring so it feels weighted, not snappy.
    <motion.div {...hoverLift} className='glass-secondary p-3 flex flex-col gap-2'>
      <div className='flex items-start gap-2'>
        <Tooltip content={`${tier.label} — ${tier.hint}`}>
          <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${tier.dot}`} />
        </Tooltip>
        <p className='flex-1 min-w-0 text-sm font-medium text-strong leading-snug break-words'>{card.title}</p>
        {isRunning && (
          <Tooltip content='Running'>
            <span className='w-3.5 h-3.5 mt-0.5 border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin shrink-0' />
          </Tooltip>
        )}
      </div>

      <div className='flex items-center gap-2 flex-wrap text-[11px] text-muted'>
        {/* Task type: quiet "R" for research, called-out chips for execution/qa */}
        <Tooltip
          content={
            card.taskType === 'execution' ? 'Execution — edits files in an isolated worktree'
              : card.taskType === 'qa' ? 'QA — read-only browser verification of the running app'
              : 'Research — read-only, produces a report'
          }
        >
          <span
            className={`px-1.5 py-0.5 rounded font-mono ${
              card.taskType === 'execution' ? 'bg-cyan-500/15 text-cyan-300 light:text-cyan-700'
                : card.taskType === 'qa' ? 'bg-purple-500/15 text-purple-300 light:text-purple-700'
                : 'bg-control/40 text-faint'
            }`}
          >
            {card.taskType === 'execution' ? '⚡ exec' : card.taskType === 'qa' ? '👁 qa' : 'R'}
          </span>
        </Tooltip>
        <span className={`px-1.5 py-0.5 rounded ${projectColor(card.projectId).chip}`}>{projectName}</span>
        {card.worktreePath && (
          <Tooltip content={`Worktree: ${card.worktreePath}`}>
            <span>📁</span>
          </Tooltip>
        )}
        {/* Effective model: card override stands out, inherited default stays quiet */}
        {(card.model ?? projectDefaultModel) && (
          <Tooltip content={card.model ? 'Model override for this card' : 'Project default model'}>
            <span
              className={`px-1.5 py-0.5 rounded ${
                card.model ? 'bg-indigo-500/15 text-indigo-300 light:text-indigo-700' : 'bg-control/40 text-faint'
              }`}
            >
              {card.model ?? projectDefaultModel}
            </span>
          </Tooltip>
        )}
        {card.estimatedMinutes != null && <span>~{card.estimatedMinutes}m</span>}
        {card.estimatedCostUsd != null && <span>~${card.estimatedCostUsd.toFixed(2)}</span>}
        {unmetPrereqs > 0 && (card.state === 'todo' || card.state === 'paused') && (
          <Tooltip content={`Autorun skips this card until ${unmetPrereqs} prerequisite card${unmetPrereqs === 1 ? ' is' : 's are'} Done — "Run now" overrides`}>
            <span className='px-1.5 py-0.5 rounded bg-amber-500/15 text-warn'>
              ⧗ {unmetPrereqs} prereq{unmetPrereqs === 1 ? '' : 's'}
            </span>
          </Tooltip>
        )}
        {age && (
          <Tooltip content='Time in this column since last activity'>
            <span className='ml-auto text-faint'>
              {age}
            </span>
          </Tooltip>
        )}
      </div>

      {card.state === 'blocked' && card.blockedReason && (
        <Tooltip content={card.blockedReason}>
          <p className='text-[11px] text-danger/90 leading-snug break-words'>
            {card.blockedReason}
          </p>
        </Tooltip>
      )}
      {card.state === 'paused' && (
        <p className='text-[11px] text-warn/80'>Interrupted — re-runs first in the next window.</p>
      )}
      {card.state === 'rework' && (
        <p className='text-[11px] text-orange-300/80 light:text-orange-700/90'>QA failed — retries once automatically, then blocks.</p>
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
    </motion.div>
  );
};

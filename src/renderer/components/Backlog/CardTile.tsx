import React from 'react';
import { motion } from 'framer-motion';
import { BacklogCard, BacklogCardState } from '../../../common/backlog-types';
import { projectColor } from './project-colors';
import { hoverLift } from '../../motion';
import { Spinner, Tooltip } from '../Shared';
import { SourceIcon } from './SourceIcon';

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

// Always-present relative time for the "Shipped" ribbon tooltip (formatAge goes
// quiet under an hour, which would read as "never shipped" on a fresh apply).
function formatSince(sinceMs: number): string {
  const mins = Math.floor((Date.now() - sinceMs) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// Human label for how the diff landed — the '3-way'/'stashed' paths merged onto
// a drifted/dirty tree, so they carry a "review" nudge.
const APPLY_METHOD_META: Record<NonNullable<BacklogCard['applyMethod']>, { note: string; review: boolean }> = {
  'clean':          { note: 'clean apply',            review: false },
  'three-way':      { note: '3-way merge — review',   review: true },
  'stashed':        { note: 'stash + apply — review', review: true },
  'already-present':{ note: 'already present',         review: false },
  'manual':         { note: 'marked applied by hand',  review: false },
};

// The board already differentiates by column; this ribbon makes "shipped to the
// project" legible at a glance without adding a card state. Kept subtle: emerald
// for a clean ship, amber when the apply merged and wants a review, muted when
// the diff was already in the tree (nothing new landed).
const ShippedRibbon: React.FC<{ card: BacklogCard }> = ({ card }) => {
  if (card.appliedAt == null) return null;
  const method = card.applyMethod ?? 'clean';
  const meta = APPLY_METHOD_META[method];
  const alreadyPresent = method === 'already-present';
  const adds = card.appliedAdditions;
  const dels = card.appliedDeletions;
  const tone = alreadyPresent
    ? 'bg-control/40 text-faint'
    : meta.review
      ? 'bg-amber-500/15 text-warn'
      : 'bg-emerald-500/15 text-ok';
  const tip =
    `${alreadyPresent ? 'Already present in the project' : 'Shipped to the project'} ` +
    `${formatSince(card.appliedAt)} · ${meta.note} · ` +
    `${card.appliedAutorun ? 'from an overnight autorun' : 'from a manual run'}`;
  return (
    <Tooltip content={tip}>
      <span className={`px-1.5 py-0.5 rounded font-medium ${tone}`}>
        {alreadyPresent ? '✓ Applied' : '✓ Shipped'}
        {!alreadyPresent && adds != null && dels != null && (
          <span className='ml-1 font-mono tabular-nums'>
            <span className='text-ok'>+{adds}</span> <span className='text-danger'>−{dels}</span>
          </span>
        )}
      </span>
    </Tooltip>
  );
};

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
  /** Refinement cards: open an interactive plan-mode session (plan auto-attaches). */
  onRefine: () => void;
  /** Refinement cards: pull the plan from the session transcript now (fallback). */
  onImportPlan: () => void;
  /** Execution cards: flag a diff landed outside Agent Pulse as shipped (method 'manual'). */
  onMarkApplied: () => void;
  /** Execution cards: undo a manual "Mark applied" (hand-marked cards only). */
  onClearApplied: () => void;
}

export const CardTile: React.FC<Props> = ({
  card, projectName, projectDefaultModel, isRunning, unmetPrereqs, canMoveUp, canMoveDown,
  onEdit, onDelete, onMove, onRunNow, onStop, onReorder, onViewDetail, onRestart,
  onRefine, onImportPlan, onMarkApplied, onClearApplied,
}) => {
  const tier = TIER_META[card.riskTier];
  const age = isRunning ? null : formatAge(card.updatedAt);
  // "Mark applied" is offered for execution cards that produced a diff but
  // haven't been recorded as landed — the manual override for work you merged
  // outside Agent Pulse. "Unmark" only for hand-marks (a real git-apply record
  // is a fact and stays put).
  const canMarkApplied =
    !isRunning && card.taskType === 'execution' && card.appliedAt == null &&
    (card.worktreePath != null || card.state === 'done');
  const canUnmarkApplied = !isRunning && card.applyMethod === 'manual';

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
            {/* Wrapper span is the tooltip trigger — Tooltip clones DOM-element
                handlers onto its child, which a Spinner component wouldn't forward. */}
            <span className='mt-0.5 shrink-0 inline-flex'>
              <Spinner size='sm' ariaLabel='Running' />
            </span>
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
        {card.sourceFingerprint?.startsWith('gitlab:') && card.sourceUrl && (
          <Tooltip content={`GitLab issue — open ${card.sourceUrl}`}>
            <button
              onClick={(e) => { e.stopPropagation(); void window.electron.invoke('open-external', card.sourceUrl); }}
              className='px-1.5 py-0.5 rounded font-mono bg-orange-500/15 text-orange-300 light:text-orange-700 hover:bg-orange-500/25 cursor-pointer transition-colors inline-flex items-center gap-1'
            >
              <SourceIcon kind='gitlab' className='w-3 h-3' /> #{card.sourceFingerprint.split(':').pop()}
            </button>
          </Tooltip>
        )}
        {card.worktreePath && (
          <Tooltip content={`Worktree: ${card.worktreePath}`}>
            <span>📁</span>
          </Tooltip>
        )}
        <ShippedRibbon card={card} />
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
      {card.state === 'refinement' && card.refinementSessionId && (
        <p className='text-[11px] text-muted leading-snug'>
          Planning session open in a terminal — the plan attaches automatically when you present one.
        </p>
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
          <>
            <ActionButton
              onClick={onRefine}
              title={
                card.refinementSessionId
                  ? 'Re-open the interactive plan-mode session'
                  : 'Refine — open an interactive plan-mode session; the plan auto-attaches to this card when you present one'
              }
            >
              ✨ {card.refinementSessionId ? 'Re-plan' : 'Refine'}
            </ActionButton>
            {card.refinementSessionId && (
              <ActionButton onClick={onImportPlan} title='Import the plan from the session now (it also attaches automatically)'>
                ⬇ Plan
              </ActionButton>
            )}
            <ActionButton onClick={() => onMove('todo')} title='Queue for execution'>→ Todo</ActionButton>
          </>
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
            {canUnmarkApplied ? (
              <ActionButton
                onClick={onClearApplied}
                title='Unmark applied — this card was marked applied by hand; clear it and it drops out of the Shipped count'
              >
                ↺ Unmark
              </ActionButton>
            ) : canMarkApplied && (
              <ActionButton
                onClick={onMarkApplied}
                title='Mark as applied — for a diff you landed outside Agent Pulse (your own merge/commit). Counts toward Shipped so the overnight total isn’t undercounted.'
              >
                ✓ Applied
              </ActionButton>
            )}
            <ActionButton onClick={onEdit} title='Edit card'>✎</ActionButton>
            <ActionButton onClick={onDelete} title='Delete card' danger>✕</ActionButton>
          </span>
        )}
      </div>
    </motion.div>
  );
};

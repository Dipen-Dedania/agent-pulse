import React, { useEffect, useState } from 'react';
import { BacklogArtifact, BacklogArtifactKind, BacklogAttempt, BacklogCard } from '../../../common/backlog-types';
import { logger } from '../../../common/logger';
import { useBacklogStore } from '../../store/useBacklogStore';
import { appAlert, appConfirm } from '../Dialog/AppDialog';
import { DiffView } from './DiffView';
import { Markdown } from './Markdown';

// Card detail: attempt history + artifacts (research report / execution diff
// + QA report) +, for execution cards, the worktree the diff came from.
// Files live under userData/backlog-artifacts; "Open file"/"Open folder"
// reuse the existing open-path IPC so users can inspect them in their own
// editor/explorer.

interface Props {
  card: BacklogCard;
  onClose: () => void;
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDuration(attempt: BacklogAttempt): string | null {
  if (!attempt.endedAt) return null;
  const mins = Math.round((attempt.endedAt - attempt.startedAt) / 60_000);
  return mins < 1 ? '<1m' : `${mins}m`;
}

const OUTCOME_COLOR: Record<string, string> = {
  success: 'text-emerald-300',
  failed: 'text-red-300',
  paused: 'text-amber-300',
  killed: 'text-amber-300',
  'qa-failed': 'text-orange-300',
  'no-changes': 'text-amber-300',
  blocked: 'text-rose-300',
};

const OUTCOME_LABEL: Record<string, string> = {
  'qa-failed': 'QA failed',
  'no-changes': 'no changes',
  blocked: 'blocked',
};

/**
 * First ~2 meaningful lines of a report preview, for the at-a-glance attempt
 * summary. Drops blank lines, markdown heading hashes, and the trailing STATUS
 * marker so the reader sees the agent's own opening sentences.
 */
function attemptSummary(preview: string | undefined): string | null {
  if (!preview) return null;
  const lines = preview
    .split('\n')
    .map((l) => l.trim().replace(/^#+\s*/, ''))
    .filter((l) => l.length > 0 && !/^STATUS:\s*(completed|partial|blocked)\b/i.test(l));
  const text = lines.slice(0, 2).join(' ');
  return text.length > 0 ? text : null;
}

// report = markdown summary, diff = git patch (rendered monospace, no wrap),
// qa-report = QA command output (first line carries the pass/fail verdict).
const KIND_LABEL: Record<BacklogArtifactKind, string> = {
  report: 'Summary',
  diff: 'Diff',
  'qa-report': 'QA report',
};
const KIND_ORDER: BacklogArtifactKind[] = ['report', 'diff', 'qa-report'];

/** Parses the qa.ts-written verdict line, e.g. "# QA: PASSED" / "# QA: FAILED". */
function parseQaVerdict(content: string | null): 'passed' | 'failed' | null {
  if (!content) return null;
  const firstLine = content.split('\n', 1)[0]?.trim() ?? '';
  if (/^#\s*QA:\s*PASSED/i.test(firstLine)) return 'passed';
  if (/^#\s*QA:\s*FAILED/i.test(firstLine)) return 'failed';
  return null;
}

export const ArtifactViewer: React.FC<Props> = ({ card, onClose }) => {
  const removeWorktree = useBacklogStore((s) => s.removeWorktree);
  const applyWorktree = useBacklogStore((s) => s.applyWorktree);
  const applyWorktreeStashed = useBacklogStore((s) => s.applyWorktreeStashed);
  const [applying, setApplying] = useState(false);
  const [attempts, setAttempts] = useState<BacklogAttempt[]>([]);
  const [artifacts, setArtifacts] = useState<BacklogArtifact[]>([]);
  const [selected, setSelected] = useState<BacklogArtifact | null>(null);
  const [content, setContent] = useState<string | null>(null);
  // True when only the ~500-char preview was available (artifact file unreadable).
  const [contentTruncated, setContentTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  // Hides the worktree panel immediately after a successful removal — the
  // `card` prop is a snapshot from the board and won't itself update until
  // the next hydrate + re-open.
  const [worktreeGone, setWorktreeGone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.electron.invoke('backlog:get-attempts', { cardId: card.id });
        if (cancelled) return;
        setAttempts(res?.attempts ?? []);
        setArtifacts(res?.artifacts ?? []);
        if (res?.artifacts?.length) setSelected(res.artifacts[0]); // newest first
      } catch (e) {
        logger.error('[ArtifactViewer] failed to load attempts', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [card.id]);

  useEffect(() => {
    if (!selected) { setContent(null); setContentTruncated(false); return; }
    let cancelled = false;
    window.electron.invoke('backlog:read-artifact', { artifactId: selected.id })
      .then((res: { content: string | null; truncated?: boolean }) => {
        if (cancelled) return;
        setContent(res?.content ?? null);
        setContentTruncated(Boolean(res?.truncated));
      })
      .catch((e: unknown) => logger.error('[ArtifactViewer] failed to read artifact', e));
    return () => { cancelled = true; };
  }, [selected]);

  const openFile = () => {
    if (selected) void window.electron.invoke('open-path', selected.path);
  };

  const openWorktreeFolder = () => {
    if (card.worktreePath) void window.electron.invoke('open-path', card.worktreePath);
  };

  const applySuccessMessage = (res: { empty?: boolean; alreadyApplied?: boolean; threeWay?: boolean; stashed?: boolean; stashConflicted?: boolean; changedFiles?: string[] }): string => {
    if (res.alreadyApplied) {
      const files = res.changedFiles ?? [];
      const list = files.length
        ? `\n\nGit reports these files already match the worktree:\n${files.slice(0, 20).map((f) => `• ${f}`).join('\n')}${files.length > 20 ? `\n…and ${files.length - 20} more` : ''}\n\nIf you expected other files (e.g. a new folder) that aren’t listed here, the worktree’s live changes differ from the saved diff — they may be untracked/ignored. Open the worktree folder to check.`
        : '';
      return `These changes already appear to be present in the project — nothing new to apply.${list}`;
    }
    if (res.empty) return 'The worktree had no changes to apply.';
    if (res.stashConflicted) {
      return 'Worktree changes applied. Your own local changes could not be re-merged automatically — they’re preserved in a git stash (run `git stash list`). Resolve the conflict markers, then `git stash drop`.';
    }
    if (res.stashed) {
      return 'Your local changes were stashed, the worktree was applied, and your changes were restored on top. Review the working tree before committing.';
    }
    if (res.threeWay) return 'Changes applied to the project via a 3-way merge. Review the working tree before committing.';
    return 'Changes applied to the project. Review the working tree before committing.';
  };

  const handleApplyWorktree = async () => {
    const ok = await appConfirm({
      title: 'Apply to project?',
      message:
        'This applies the worktree’s changes onto your project’s working directory, left unstaged for you to review and commit. The worktree stays until you remove it.',
      confirmLabel: 'Apply to project',
    });
    if (!ok) return;
    setApplying(true);
    try {
      const res = await applyWorktree(card.id);
      if (res.ok) {
        void appAlert(applySuccessMessage(res), 'Backlog');
      } else if (res.dirtyTarget) {
        // The project's working tree overlaps the patch. Offer the automatic
        // stash → apply → pop path right here instead of a dead-end alert.
        const doStash = await appConfirm({
          title: 'Stash local changes and apply?',
          message:
            `${res.reason}\n\nAlternatively, Agent Pulse can stash your local changes, apply the worktree, then restore your changes on top. Overlapping edits are left as conflict markers to resolve.`,
          confirmLabel: 'Stash, apply & restore',
        });
        if (doStash) {
          const stashRes = await applyWorktreeStashed(card.id);
          if (stashRes.ok) void appAlert(applySuccessMessage(stashRes), 'Backlog');
          else if (stashRes.reason) void appAlert(stashRes.reason, 'Backlog');
        }
      } else if (res.reason) {
        void appAlert(res.reason, 'Backlog');
      }
    } finally {
      setApplying(false);
    }
  };

  const handleRemoveWorktree = async () => {
    const ok = await appConfirm({
      title: 'Remove worktree?',
      message: 'This discards the uncommitted changes in the worktree. The captured diff artifact stays on the card.',
      confirmLabel: 'Remove worktree',
      danger: true,
    });
    if (!ok) return;
    const res = await removeWorktree(card.id);
    if (res.ok) setWorktreeGone(true);
    else if (res.reason) void appAlert(res.reason, 'Backlog');
  };

  const qaVerdict = selected?.kind === 'qa-report' ? parseQaVerdict(content) : null;
  // Diffs need room for the file rail + side-by-side hunks; other artifacts
  // stay in the narrow reading column.
  const isDiff = selected?.kind === 'diff';

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm' onClick={onClose}>
      <div
        className={`apple-scroll relative w-full mx-4 bg-slate-900/95 border border-slate-700/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-3 overflow-y-auto ${
          isDiff ? 'max-w-[1600px] max-h-[92vh]' : 'max-w-3xl max-h-[85vh]'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>

        <div>
          <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'>Card history</p>
          <h2 className='text-lg font-bold text-white leading-tight pr-8'>{card.title}</h2>
        </div>

        {loading ? (
          <p className='text-sm text-slate-400'>Loading…</p>
        ) : (
          <>
            {/* Attempt history */}
            <div className='bg-slate-900/40 border border-slate-700/50 rounded-xl px-4 py-3'>
              <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold mb-1.5'>Attempts</p>
              {attempts.length === 0 ? (
                <p className='text-sm text-slate-400'>No runs yet.</p>
              ) : (
                <div className='flex flex-col gap-2'>
                  {attempts.map((a) => {
                    const report = artifacts.find((x) => x.attemptId === a.id && x.kind === 'report');
                    const diff = artifacts.find((x) => x.attemptId === a.id && x.kind === 'diff');
                    const summary = attemptSummary(report?.preview);
                    // A saved diff whose status listing is empty ⇒ the run changed
                    // nothing. Flag it even on older attempts recorded as 'success'
                    // before honest-outcome classification existed.
                    const noChanges = diff != null && diff.preview.trim() === '(no changes)';
                    return (
                      <div key={a.id} className='flex flex-col gap-0.5'>
                        <div className='flex items-center gap-3 text-xs flex-wrap'>
                          <span className='text-slate-400 w-32 shrink-0'>{formatWhen(a.startedAt)}</span>
                          <span className={`font-medium ${OUTCOME_COLOR[a.outcome ?? ''] ?? 'text-slate-300'}`}>
                            {OUTCOME_LABEL[a.outcome ?? ''] ?? a.outcome ?? 'running…'}
                          </span>
                          {noChanges && a.outcome !== 'no-changes' && (
                            <span className='px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] font-semibold uppercase tracking-wide'>
                              no file changes
                            </span>
                          )}
                          {formatDuration(a) && <span className='text-slate-500'>{formatDuration(a)}</span>}
                          {a.costUsd != null && <span className='text-slate-500'>${a.costUsd.toFixed(2)}</span>}
                          {a.numTurns != null && <span className='text-slate-500'>{a.numTurns} turns</span>}
                          {a.manual && <span className='text-slate-500'>manual</span>}
                          {/* reason only when there's no richer report summary (failed/killed
                              runs write no report) — avoids showing the same line twice. */}
                          {a.reason && !summary && (
                            <span className='text-slate-500 truncate max-w-64' title={a.reason}>{a.reason}</span>
                          )}
                        </div>
                        {summary && (
                          <p
                            className='text-slate-400 leading-snug line-clamp-2 pl-[8.75rem] text-xs'
                            title={report?.preview}
                          >
                            {summary}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Artifact — grouped by kind: Summary / Diff / QA report */}
            {artifacts.length > 0 && (
              <div className='bg-slate-900/40 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-3'>
                <div className='flex items-center gap-2 flex-wrap'>
                  <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold flex-1'>
                    {selected ? KIND_LABEL[selected.kind] : 'Report'}
                  </p>
                  {qaVerdict && (
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        qaVerdict === 'passed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'
                      }`}
                    >
                      {qaVerdict === 'passed' ? 'PASS' : 'FAIL'}
                    </span>
                  )}
                  {artifacts.length > 1 && (
                    <select
                      value={selected?.id ?? ''}
                      onChange={(e) => setSelected(artifacts.find((x) => x.id === e.target.value) ?? null)}
                      className='bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1 text-xs text-white cursor-pointer focus:outline-none'
                    >
                      {KIND_ORDER.map((kind) => {
                        const inKind = artifacts.filter((x) => x.kind === kind);
                        if (inKind.length === 0) return null;
                        return (
                          <optgroup key={kind} label={KIND_LABEL[kind]}>
                            {inKind.map((x) => (
                              <option key={x.id} value={x.id}>{formatWhen(x.createdAt)}</option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  )}
                  <button
                    onClick={openFile}
                    className='px-3 py-1 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 cursor-pointer transition-colors'
                  >
                    Open file
                  </button>
                </div>
                {selected?.kind === 'diff' ? (
                  content == null ? (
                    <p className='text-sm text-slate-400'>Loading diff…</p>
                  ) : (
                    <DiffView patch={content} truncated={contentTruncated} />
                  )
                ) : selected?.kind === 'report' ? (
                  // Summary reports are plain markdown — render a formatted
                  // preview instead of raw source. Falls back to the ~500-char
                  // preview when the artifact file couldn't be read.
                  content == null ? (
                    <p className='text-sm text-slate-400'>Loading…</p>
                  ) : (
                    <div className='max-h-96 overflow-y-auto apple-scroll'>
                      <Markdown content={content} />
                      {contentTruncated && (
                        <p className='mt-2 text-[11px] text-slate-500 italic'>
                          Preview truncated — use “Open file” to read the full report.
                        </p>
                      )}
                    </div>
                  )
                ) : (
                  <pre className='whitespace-pre-wrap text-xs text-slate-200 leading-relaxed font-mono max-h-96 overflow-y-auto apple-scroll'>
                    {content ?? 'Loading…'}
                  </pre>
                )}
              </div>
            )}

            {/* Worktree — execution cards only, preserved until removed by hand */}
            {card.taskType === 'execution' && card.worktreePath && !worktreeGone && (
              <div className='bg-slate-900/40 border border-slate-700/50 rounded-xl px-4 py-3 flex flex-col gap-2'>
                <div className='flex items-baseline gap-2 min-w-0'>
                  <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold shrink-0'>Worktree</p>
                  <span className='text-xs text-slate-300 font-mono truncate flex-1 min-w-0' title={card.worktreePath}>
                    {card.worktreePath}
                  </span>
                  {card.baseSha && (
                    <span className='text-xs text-slate-500 shrink-0'>
                      base <span className='font-mono text-slate-400'>{card.baseSha.slice(0, 7)}</span>
                    </span>
                  )}
                </div>
                <div className='flex items-center gap-2'>
                  <button
                    onClick={() => void handleApplyWorktree()}
                    disabled={applying}
                    className='px-3 py-1 rounded-lg text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                  >
                    {applying ? 'Applying…' : 'Apply to project'}
                  </button>
                  <button
                    onClick={openWorktreeFolder}
                    className='px-3 py-1 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 cursor-pointer transition-colors'
                  >
                    Open folder
                  </button>
                  <button
                    onClick={() => void handleRemoveWorktree()}
                    className='px-3 py-1 rounded-lg text-xs font-medium bg-slate-700 hover:bg-red-500/30 text-slate-300 hover:text-red-300 cursor-pointer transition-colors'
                  >
                    Remove worktree
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

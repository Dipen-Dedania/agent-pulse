import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BACKLOG_AGENTS, BacklogAgent, BacklogCard, BacklogCardState, BacklogPopulationConfig, BacklogSchedulerConfig, agentLabel, countUnmetPrereqs, isAwaitingReview } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { logger } from '../../../common/logger';
import { BoardColumn } from './BoardColumn';
import {
  BOARD_RANGE_LABEL, BOARD_RANGE_OPTIONS, BoardRange, boardRangeCutoff,
  DONE_FILTER_META, DONE_FILTER_ORDER, DONE_FILTER_PREDICATES, DoneFilter,
  passesViewFilters,
} from './board-filters';
import { appAlert, appConfirm, Button, Card, ChipGroup, type ChipGroupOption, Eyebrow, IconButton, Segmented, Spinner, Tooltip } from '../Shared';
import { CardTile } from './CardTile';
import { CardEditorModal } from './CardEditorModal';
import { BacklogSearchPalette } from './BacklogSearchPalette';
import { ArtifactViewer } from './ArtifactViewer';
import { IssueSourceHeaderActions, IssueSourceProjectStrip } from './IssueSourceControls';
import { IssueImportModal } from './IssueImportModal';
import { SOURCE_META } from './source-meta';
import { SourceIcon } from './SourceIcon';
import { BacklogSetupChecklist } from './BacklogSetupChecklist';
import { BacklogSettingsModal, BacklogSettingsTab } from './BacklogSettingsModal';
import { listItem } from '../../motion';

// Global Kanban board (backlog.md Phase 1): all projects on one board, every
// card labelled by project and filterable down to one. The Todo column is the
// autorun queue for the Backlog Scheduler (⚙ in the header below).

const FLOW_COLUMNS: { state: BacklogCardState; title: string; hint?: string; accent?: string }[] = [
  { state: 'refinement', title: 'Refinement', hint: 'raw ideas' },
  { state: 'todo', title: 'Todo', hint: 'autorun queue' },
  { state: 'in-progress', title: 'In Progress' },
  // Blocked sits in the flow (before Done) rather than the attention rail so it
  // reads as a stage of the pipeline; still never a drop target (see DROP_TARGETS).
  { state: 'blocked', title: 'Blocked', hint: 'needs your attention', accent: 'text-danger' },
  { state: 'done', title: 'Done', hint: 'report attached' },
];

// Columns a card can be dragged into. In Progress is engine-only (moveCard
// rejects it in main), so it never lights up as a drop target.
const DROP_TARGETS: BacklogCardState[] = ['refinement', 'todo', 'done'];

// data-tour anchor ids per flow column, for the Backlog guided tour to spotlight.
const COLUMN_TOUR: Partial<Record<BacklogCardState, string>> = {
  refinement: 'backlog-col-refinement',
  todo: 'backlog-col-todo',
  'in-progress': 'backlog-col-inprogress',
  blocked: 'backlog-col-blocked',
  done: 'backlog-col-done',
};

// Shortcut hint shown on the search trigger. Mac users press ⌘, everyone else Ctrl.
const SEARCH_SHORTCUT = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K';

// Tiles rendered per flow column before the "+N more" expander. Bounds both the
// scroll length and the number of layout-animated tiles on screen.
const MAX_VISIBLE_PER_COLUMN = 15;

// Renderer-only view preferences (which cards you're looking at), so they live
// in localStorage rather than user-config — same posture as DiffView's split
// setting. Never read by main; they must not influence what the engine runs.
const RANGE_KEY = 'pulse.board.historyRange';
const DONE_FILTER_KEY = 'pulse.board.doneFilter';

function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const raw = localStorage.getItem(key) as T | null;
    return raw && allowed.includes(raw) ? raw : fallback;
  } catch {
    return fallback; // private mode
  }
}

function savePref(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Done isn't one thing: an unreviewed diff wants you, a shipped one is history,
// a research report is neither. These chips split it so the actionable few stop
// hiding behind the many.
const DoneFilterChips: React.FC<{
  value: DoneFilter;
  counts: Record<DoneFilter, number>;
  onChange: (next: DoneFilter) => void;
}> = ({ value, counts, onChange }) => (
  <Segmented
    ariaLabel='Done filter'
    size='xs'
    value={value}
    onChange={(v) => onChange(v as DoneFilter)}
    options={DONE_FILTER_ORDER.map((f) => {
      const meta = DONE_FILTER_META[f];
      // An unreviewed diff is the only actionable Done category — flag it with
      // a dot so it stays noticeable even while another chip is selected.
      const urgent = f === 'needs-review' && counts[f] > 0;
      return { value: f, label: `${meta.label} ${counts[f]}`, hint: meta.hint, dot: urgent ? 'bg-amber-500' : undefined };
    })}
  />
);

// Sync (hydrate + broadcast subscription) lives in SettingsPanel via
// useBacklogSync so the scheduler section's glance stays live even when this
// tab isn't mounted.
interface BacklogBoardTabProps {
  /** Launches the in-panel guided tour (owned by SettingsPanel). */
  onStartTour?: () => void;
  /**
   * Backlog Scheduler + issue population configs for the ⚙ Backlog settings
   * modal. SettingsPanel owns both (one config loader + the
   * `backlog:*:config-updated` subscriptions for the whole panel); the board
   * only threads them through. null until loaded.
   */
  schedulerConfig?: BacklogSchedulerConfig | null;
  onSchedulerConfigChange?: (partial: Partial<BacklogSchedulerConfig>) => void;
  populationConfig?: BacklogPopulationConfig | null;
  onPopulationConfigChange?: (partial: Partial<BacklogPopulationConfig>) => void;
}

export const BacklogBoardTab: React.FC<BacklogBoardTabProps> = ({
  onStartTour,
  schedulerConfig = null,
  onSchedulerConfigChange,
  populationConfig = null,
  onPopulationConfigChange,
}) => {
  const store = useBacklogStore();

  const [projectFilter, setProjectFilter] = useState<string>('all');
  // History window — global (one control scopes the board) but applied only to
  // log-like columns; see RANGE_FILTERED_STATES. Deliberately NOT wired to the
  // Analytics range: changing what the board shows must not move the stats.
  const [range, setRange] = useState<BoardRange>(() =>
    loadPref(RANGE_KEY, BOARD_RANGE_OPTIONS.map((o) => o.value), '30d'),
  );
  // Done splits into categories that want different attention. Defaults to
  // 'all' rather than 'needs-review' so a research-only board never looks empty.
  const [doneFilter, setDoneFilter] = useState<DoneFilter>(() =>
    loadPref(DONE_FILTER_KEY, DONE_FILTER_ORDER, 'all'),
  );
  const [editor, setEditor] = useState<{ open: boolean; card: BacklogCard | null }>({ open: false, card: null });
  const [detailCard, setDetailCard] = useState<BacklogCard | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Which ⚙ Backlog settings tab to open with; null = closed.
  const [settingsOpen, setSettingsOpen] = useState<BacklogSettingsTab | null>(null);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  // `${projectId}:${agent}` → default model (Claude: the project's
  // .claude/settings.json chain; Codex: ~/.codex/config.toml), so tiles can
  // show what a card without an override would actually run with.
  const [defaultModels, setDefaultModels] = useState<Record<string, string | null>>({});
  const defaultModelKey = (projectId: string, agent: BacklogAgent) => `${projectId}:${agent}`;

  const projectIdsKey = store.projects.map((p) => p.id).join(',');
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      store.projects.flatMap((p) =>
        BACKLOG_AGENTS.map(async (agent): Promise<[string, string | null]> => {
          try {
            const res = await window.electron.invoke('backlog:project-default-model', { projectId: p.id, agent });
            return [defaultModelKey(p.id, agent), res?.model ?? null];
          } catch {
            return [defaultModelKey(p.id, agent), null];
          }
        })),
    ).then((entries) => {
      if (!cancelled) setDefaultModels(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projects array identity churns on every hydrate
  }, [projectIdsKey]);

  // ⌘K / Ctrl-K opens the find-cards palette. Scoped to this tab's lifetime, so
  // it only binds while the Backlog board is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!store.loaded) {
    return (
      <div className='flex items-center gap-3 text-muted'>
        <Spinner size='md' />
        Loading board…
      </div>
    );
  }

  if (!store.available) {
    return (
      <Card title='Backlog board unavailable' subtitle={store.reason}>{null}</Card>
    );
  }

  const projectName = (id: string) => store.projects.find((p) => p.id === id)?.name ?? 'unknown';
  const visibleCards = store.cards.filter((c) => projectFilter === 'all' || c.projectId === projectFilter);
  const rangeCutoff = boardRangeCutoff(range, Date.now());

  // Raw column membership, before any view filter. 'claimed' is transient and
  // belongs with In Progress.
  const inState = (card: BacklogCard, state: BacklogCardState) =>
    state === 'in-progress' ? card.state === 'in-progress' || card.state === 'claimed' : card.state === state;

  // View filters (Done chips + history window, each scoped) live in
  // board-filters so the "unreviewed never ages out" rule is unit-tested.
  const byState = (state: BacklogCardState) =>
    visibleCards
      .filter((c) => inState(c, state) && passesViewFilters(c, state, { doneFilter, rangeCutoff }))
      .sort((a, b) => (state === 'todo' ? a.sortOrder - b.sortOrder : b.updatedAt - a.updatedAt));

  // Unfiltered size of a column, so the header can say "4 of 327" instead of
  // quietly dropping cards.
  const totalInState = (state: BacklogCardState) => visibleCards.filter((c) => inState(c, state)).length;

  // Chip counts reflect what clicking would actually show — same window rule,
  // including the awaiting-review exemption.
  const doneInWindow = visibleCards.filter(
    (c) => c.state === 'done' && (c.updatedAt >= rangeCutoff || isAwaitingReview(c)),
  );
  const doneCounts = Object.fromEntries(
    DONE_FILTER_ORDER.map((f) => [f, doneInWindow.filter(DONE_FILTER_PREDICATES[f]).length]),
  ) as Record<DoneFilter, number>;

  const pickRange = (next: BoardRange) => { setRange(next); savePref(RANGE_KEY, next); };
  const pickDoneFilter = (next: DoneFilter) => { setDoneFilter(next); savePref(DONE_FILTER_KEY, next); };

  const todoCards = byState('todo');

  const handleAddProject = async () => {
    try {
      const path = await window.electron.invoke('backlog:pick-project-folder');
      if (path) await store.addProject(path);
    } catch (e) {
      logger.error('[BacklogBoardTab] add project failed', e);
    }
  };

  const handleRemoveProject = async (id: string) => {
    const res = await store.removeProject(id);
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
    if (res.ok && projectFilter === id) setProjectFilter('all');
  };

  const handleRunNow = async (card: BacklogCard) => {
    if (card.riskTier !== 'green') {
      const ok = await appConfirm({
        title: `Run "${card.title}" now?`,
        message: `This is a ${card.riskTier} card (manual only). Running it will spend real ${agentLabel(card.agent)} usage.`,
        confirmLabel: 'Run now',
      });
      if (!ok) return;
    }
    const res = await store.runNow(card.id);
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  // Restart = discard the card's worktree, then re-run from a clean checkout.
  // The next run finds no worktree, creates a fresh one at current HEAD, and
  // sends the full prompt (no session resume) — a true from-scratch attempt.
  const handleRestart = async (card: BacklogCard) => {
    const ok = await appConfirm({
      title: `Restart "${card.title}" from scratch?`,
      message:
        'This deletes the card’s worktree — any uncommitted file changes from previous runs are discarded — and re-runs the task on a fresh checkout of the project. Saved reports and diffs stay on the card.',
      confirmLabel: 'Discard & restart',
      danger: true,
    });
    if (!ok) return;
    const rm = await store.removeWorktree(card.id);
    if (!rm.ok) {
      if (rm.reason) void appAlert(rm.reason, 'Backlog');
      return;
    }
    const res = await store.runNow(card.id);
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  const handleStop = async (card: BacklogCard) => {
    const ok = await appConfirm({
      title: `Stop "${card.title}"?`,
      message: 'The run is discarded and the card moves to Paused.',
      confirmLabel: 'Stop run',
      danger: true,
    });
    if (!ok) return;
    const res = await store.stopRun();
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  const handleMove = async (card: BacklogCard, state: BacklogCardState) => {
    const res = await store.moveCard(card.id, state);
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  // Opens an interactive plan-mode session; the plan auto-attaches as it's
  // presented (main watches the transcript).
  const handleRefine = async (card: BacklogCard) => {
    const res = await store.refineStart(card.id);
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  // Manual pull of the plan (fallback for the auto-attach watcher).
  const handleImportPlan = async (card: BacklogCard) => {
    const res = await store.importPlan(card.id);
    if (res.ok) void appAlert('Plan imported and attached to the card.', 'Backlog');
    else if (res.reason) void appAlert(res.reason, 'Backlog');
  };

  // Manual override for a diff landed outside Agent Pulse (your own merge/commit)
  // so it still counts toward "shipped overnight". Reversible via Unmark.
  const handleMarkApplied = async (card: BacklogCard) => {
    const res = await store.markApplied(card.id);
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  const handleClearApplied = async (card: BacklogCard) => {
    const res = await store.clearApplied(card.id);
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  const handleDelete = async (card: BacklogCard) => {
    const ok = await appConfirm({
      title: `Delete "${card.title}"?`,
      message: 'Its run history and reports go with it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) await store.deleteCard(card.id);
  };

  const handleReorder = (card: BacklogCard, direction: -1 | 1) => {
    // Reorder within the FULL todo queue (not the filtered view) so the
    // executor's pick order matches what the user arranged.
    const ordered = store.cards.filter((c) => c.state === 'todo').sort((a, b) => a.sortOrder - b.sortOrder).map((c) => c.id);
    const i = ordered.indexOf(card.id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    void store.reorderTodo(ordered);
  };

  // Fresh full todo order — read from getState() because drop handlers run
  // after awaited moves and this component's `store` snapshot is stale by then.
  const fullTodoOrder = () =>
    useBacklogStore.getState().cards
      .filter((c) => c.state === 'todo')
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => c.id);

  const dragCard = dragCardId ? store.cards.find((c) => c.id === dragCardId) ?? null : null;
  const columnDroppable = (state: BacklogCardState) =>
    dragCard != null && DROP_TARGETS.includes(state) && (dragCard.state !== state || state === 'todo');

  const handleDropOnColumn = async (state: BacklogCardState) => {
    const card = dragCard;
    setDragCardId(null);
    if (!card) return;
    if (card.state === state) {
      // Dropping a todo card onto its own column sends it to the back of the queue.
      if (state === 'todo') {
        const ordered = fullTodoOrder().filter((id) => id !== card.id);
        ordered.push(card.id);
        void store.reorderTodo(ordered);
      }
      return;
    }
    const res = await store.moveCard(card.id, state);
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  const handleDropOnTodoCard = async (target: BacklogCard) => {
    const card = dragCard;
    setDragCardId(null);
    if (!card || card.id === target.id) return;
    if (card.state !== 'todo') {
      const res = await store.moveCard(card.id, 'todo');
      if (!res.ok) {
        if (res.reason) void appAlert(res.reason, 'Backlog');
        return;
      }
    }
    // Insert the dragged card right before the tile it was dropped on.
    const ordered = fullTodoOrder().filter((id) => id !== card.id);
    const at = ordered.indexOf(target.id);
    ordered.splice(at < 0 ? ordered.length : at, 0, card.id);
    void store.reorderTodo(ordered);
  };

  const handleSave = async (
    input: Parameters<Parameters<typeof CardEditorModal>[0]['onSave']>[0],
    attachments: Parameters<Parameters<typeof CardEditorModal>[0]['onSave']>[1],
  ) => {
    const saved = editor.card
      ? await store.updateCard(editor.card.id, input)
      : await store.createCard(input);
    // Persist attachments once the card id is known (new cards have none until
    // create resolves). Skip when there's nothing to change on a fresh card.
    if (saved && (attachments.keepIds.length > 0 || attachments.add.length > 0 || editor.card)) {
      await store.setCardAttachments(saved.id, attachments);
    }
    setEditor({ open: false, card: null });
  };

  const status = store.status;
  const glance = (() => {
    if (!status) return null;
    if (status.runningCardTitle) return `Running: ${status.runningCardTitle}`;
    if (status.windowActive && status.windowEndsAt) {
      const mins = Math.max(0, Math.round((status.windowEndsAt - Date.now()) / 60_000));
      return `Window open · ${Math.floor(mins / 60)}h ${mins % 60}m left${status.waitingForIdle ? ' · waiting for idle' : ''}`;
    }
    if (status.nextWindowStartAt) {
      const d = new Date(status.nextWindowStartAt);
      return `Next window ${d.toLocaleDateString([], { weekday: 'short' })} ${formatClock(status.nextWindowStartAt)} · queue: ${status.queueReady} ready`;
    }
    return status.enabled
      ? `Queue: ${status.queueReady} ready`
      : 'Backlog autorun off — run cards with "Run now", or set windows under ⚙ Backlog settings';
  })();

  // `tourAnchor` marks a single tile as the guided tour's card anchor (the first
  // card of the first non-empty flow column). getBoundingClientRect needs a real
  // box, so it rides on the tile's own motion.div.
  const renderTile = (card: BacklogCard, tourAnchor = false) => {
    const todoIndex = todoCards.findIndex((c) => c.id === card.id);
    const draggable = card.state !== 'in-progress' && card.state !== 'claimed';
    // Todo tiles double as drop slots: dropping on one inserts the dragged
    // card before it (stopPropagation keeps the column's to-tail drop out).
    const isTodoDropSlot = card.state === 'todo' && dragCardId !== null && dragCardId !== card.id;
    // Disable layout animation while any drag is in flight — the HTML5 drag
    // ghost is positioned from the element's current bounding rect, so an
    // in-progress layout spring would shift the ghost mid-drag.
    const isDragging = dragCardId !== null;
    return (
      <motion.div
        key={card.id}
        data-tour={tourAnchor ? 'backlog-first-card' : undefined}
        layout={isDragging ? false : 'position'}
        variants={listItem}
        draggable={draggable}
        onDragStart={(e) => {
          (e as unknown as React.DragEvent).dataTransfer.effectAllowed = 'move';
          (e as unknown as React.DragEvent).dataTransfer.setData('text/plain', card.id);
          setDragCardId(card.id);
        }}
        onDragEnd={() => setDragCardId(null)}
        onDragOver={isTodoDropSlot ? (e) => (e as unknown as React.DragEvent).preventDefault() : undefined}
        onDrop={isTodoDropSlot ? (e) => {
          (e as unknown as React.DragEvent).preventDefault();
          (e as unknown as React.DragEvent).stopPropagation();
          void handleDropOnTodoCard(card);
        } : undefined}
        className={`${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${dragCardId === card.id ? 'opacity-40' : ''}`}
      >
        <CardTile
          card={card}
          projectName={projectName(card.projectId)}
          projectDefaultModel={defaultModels[defaultModelKey(card.projectId, card.agent)] ?? null}
          isRunning={card.state === 'in-progress' || card.state === 'claimed'}
          unmetPrereqs={countUnmetPrereqs(card, store.cards)}
          canMoveUp={todoIndex > 0}
          canMoveDown={todoIndex >= 0 && todoIndex < todoCards.length - 1}
          onEdit={() => setEditor({ open: true, card })}
          onDelete={() => void handleDelete(card)}
          onMove={(state) => void handleMove(card, state)}
          onRunNow={() => void handleRunNow(card)}
          onStop={() => void handleStop(card)}
          onReorder={(dir) => handleReorder(card, dir)}
          onViewDetail={() => setDetailCard(card)}
          onRestart={() => void handleRestart(card)}
          onRefine={() => void handleRefine(card)}
          onImportPlan={() => void handleImportPlan(card)}
          onMarkApplied={() => void handleMarkApplied(card)}
          onClearApplied={() => void handleClearApplied(card)}
        />
      </motion.div>
    );
  };

  const rework = byState('rework');
  const paused = byState('paused');

  // The guided tour spotlights one real card so it can teach ▶ Run / ✨ Refine:
  // the first card of the first non-empty flow column (Refinement preferred, as
  // it leads FLOW_COLUMNS and carries the ✨ Refine action).
  const anchorCardColumn = FLOW_COLUMNS.find((c) => byState(c.state).length > 0)?.state ?? null;

  // Board setup checklist state (real completion, not tour progress). "Ran one"
  // = anything that has left the planning columns, or a recorded engine run.
  const hasProject = store.projects.length > 0;
  const hasCard = store.cards.length > 0;
  const ranOne = status?.lastRun != null
    || store.cards.some((c) => c.state !== 'refinement' && c.state !== 'todo');

  return (
    // min-h fills the viewport below the panel header/tabs so the columns
    // stretch instead of hugging the top of a maximized window.
    <div className='flex flex-col gap-5 min-h-[calc(100vh-16rem)]'>
      {/* Header: glance + project filter + actions */}
      <div className='glass-primary p-4 flex flex-col gap-3'>
        <div className='flex items-center gap-3 flex-wrap'>
          <div className='flex-1 min-w-48' data-tour='backlog-glance'>
            {glance && <p className='text-sm text-strong'>{glance}</p>}
            {status?.lastRun && (
              <p className='text-xs text-muted mt-0.5'>
                Last run: {status.lastRun.cardTitle} —{' '}
                <span className={status.lastRun.outcome === 'success' ? 'text-ok' : 'text-warn'}>
                  {status.lastRun.outcome}
                </span>
              </p>
            )}
          </div>
          {/* Styled to read as a search field, not just another button, so the
              palette is discoverable without knowing the keyboard shortcut. */}
          <Tooltip content='Find a card by title, description, or project'>
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label='Search cards'
              className='flex items-center gap-2 px-3 py-1.5 rounded-lg bg-glass/60 border border-edge/70 text-sm text-muted hover:text-strong hover:border-edge-strong cursor-pointer transition-colors'
            >
              <svg viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth={2} className='w-3.5 h-3.5 shrink-0' aria-hidden='true'>
                <circle cx='9' cy='9' r='6' />
                <path d='M14 14l4 4' strokeLinecap='round' />
              </svg>
              <span>Search cards…</span>
              <kbd className='ml-1 px-1.5 py-0.5 rounded bg-control/60 border border-edge/60 text-[10px] leading-none text-faint'>
                {SEARCH_SHORTCUT}
              </kbd>
            </button>
          </Tooltip>
          <Button variant='secondary' size='sm' onClick={handleAddProject} data-tour='backlog-add-project'>
            + Add project
          </Button>
          <Tooltip content={store.projects.length === 0 ? 'Register a project folder first' : undefined}>
            <Button
              variant='primary'
              size='sm'
              onClick={() => setEditor({ open: true, card: null })}
              disabled={store.projects.length === 0}
              data-tour='backlog-new-card'
            >
              + New card
            </Button>
          </Tooltip>
          <IssueSourceHeaderActions projectFilter={projectFilter} onReview={() => setImportOpen(true)} />
          {/* Board settings live behind ⚙ rather than on a Settings tab: the
              night session's windows/gates and the issue-population defaults
              govern this board, and cards run on either agent, so no tool's
              Plans & Limits sub-tab is the right home. */}
          <Tooltip content={schedulerConfig ? 'Backlog settings — night session windows and issue population' : 'Backlog settings are loading…'}>
            <IconButton
              onClick={() => setSettingsOpen('scheduler')}
              disabled={!schedulerConfig || !onSchedulerConfigChange}
              aria-label='Open Backlog settings'
              data-tour='backlog-scheduler'
            >
              <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={1.75} strokeLinecap='round' strokeLinejoin='round' className='w-3.5 h-3.5' aria-hidden='true'>
                <circle cx='12' cy='12' r='3' />
                <path d='M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' />
              </svg>
            </IconButton>
          </Tooltip>
          {onStartTour && (
            <Tooltip content='Replay the guided tour'>
              <IconButton
                onClick={onStartTour}
                aria-label='Replay the guided tour'
              >
                <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth={1.75} className='w-3.5 h-3.5' aria-hidden='true'>
                  <circle cx='12' cy='12' r='9' strokeLinecap='round' strokeLinejoin='round' />
                  <polygon
                    points='15.5 8.5 13.2 13.2 8.5 15.5 10.8 10.8'
                    fill='currentColor'
                    strokeLinejoin='round'
                  />
                </svg>
              </IconButton>
            </Tooltip>
          )}
        </div>

        {store.projects.length > 0 && (
          <div className='flex items-center gap-1 flex-wrap' data-tour='backlog-projects'>
            <ChipGroup
              ariaLabel='Filter by project'
              value={projectFilter}
              onChange={(v) => setProjectFilter(v as string)}
              className='flex flex-wrap gap-1.5'
              options={[
                { value: 'all', label: 'All projects' },
                ...store.projects.map((p): ChipGroupOption => ({
                  value: p.id,
                  hue: p.id,
                  leading: p.source ? <SourceIcon kind={p.source.kind} /> : undefined,
                  label: (
                    <Tooltip content={p.source ? `${p.path} · ${SOURCE_META[p.source.kind].label} ${p.source.name}` : p.path}>
                      <span>{p.name}</span>
                    </Tooltip>
                  ),
                  trailing: (
                    <Tooltip content={`Remove ${p.name} from the board`}>
                      <IconButton
                        size='sm'
                        shape='circle'
                        tone='ghost'
                        aria-label={`Remove ${p.name}`}
                        onClick={() => void handleRemoveProject(p.id)}
                      >
                        <svg viewBox='0 0 20 20' fill='none' stroke='currentColor' strokeWidth={2} strokeLinecap='round' className='w-3 h-3' aria-hidden='true'>
                          <path d='M5 5l10 10M15 5L5 15' />
                        </svg>
                      </IconButton>
                    </Tooltip>
                  ),
                })),
              ]}
            />

            {/* History window — scopes the board's log-like columns (Done).
                Work queues ignore it, so the Todo order always matches what the
                engine will run. */}
            <span className='ml-auto flex items-center gap-2 pl-2'>
              <Tooltip content='How far back the Done column reaches. Work queues (Refinement, Todo, In Progress) and cards needing attention are never hidden by it. Separate from the Analytics tab’s range.'>
                <Eyebrow size='md' tone='muted' as='span'>History</Eyebrow>
              </Tooltip>
              <Segmented
                options={BOARD_RANGE_OPTIONS}
                value={range}
                onChange={(v) => pickRange(v as BoardRange)}
              />
            </span>
          </div>
        )}

        {/* Per-project issue-source link controls, shown when a single project is selected. */}
        {projectFilter !== 'all' && <IssueSourceProjectStrip projectId={projectFilter} />}
      </div>

      {onStartTour && (
        <BacklogSetupChecklist
          hasProject={hasProject}
          hasCard={hasCard}
          ranOne={ranOne}
          onStartTour={onStartTour}
          onAddProject={() => void handleAddProject()}
          onNewCard={() => setEditor({ open: true, card: null })}
        />
      )}

      {store.projects.length === 0 ? (
        <Card
          title='Add your first project'
          subtitle='Cards belong to a project (a repo folder — the agent runs there). Register one, queue research cards, and the night session (Claude Code or Codex, per card) works through them during your idle windows — so reports are waiting for you in the morning.'
        >
          <div className='flex items-center gap-2 flex-wrap'>
            <Button variant='primary' size='sm' onClick={() => void handleAddProject()}>
              + Add your first project
            </Button>
            {onStartTour && (
              <Button variant='secondary' size='sm' onClick={onStartTour}>
                Take the tour
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <>
          {/* Main flow — flex-1 + auto-rows-fr stretch the columns to fill the tab.
              Five columns (Blocked joins the flow), so big screens go 5-up. */}
          <div className='flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 auto-rows-fr gap-4'>
            {FLOW_COLUMNS.map((col) => {
              const cards = byState(col.state);
              const isDone = col.state === 'done';
              const anchorHere = col.state === anchorCardColumn;
              return (
                <BoardColumn
                  key={col.state}
                  title={col.title}
                  accent={col.accent}
                  dataTour={COLUMN_TOUR[col.state]}
                  // Done advertises the active window instead of a static hint,
                  // so a filtered column always explains itself.
                  hint={isDone && range !== 'all' ? BOARD_RANGE_LABEL[range] : col.hint}
                  count={cards.length}
                  total={totalInState(col.state)}
                  maxVisible={MAX_VISIBLE_PER_COLUMN}
                  filters={
                    isDone ? (
                      <DoneFilterChips value={doneFilter} counts={doneCounts} onChange={pickDoneFilter} />
                    ) : undefined
                  }
                  droppable={columnDroppable(col.state)}
                  onDropCard={() => void handleDropOnColumn(col.state)}
                >
                  {cards.map((c, i) => renderTile(c, anchorHere && i === 0))}
                </BoardColumn>
              );
            })}
          </div>

          {/* Attention rail — only when something needs it. Rework / Paused
              cards are never drop targets (see DROP_TARGETS above). Blocked now
              lives in the flow row. */}
          {(rework.length > 0 || paused.length > 0) && (
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
              {rework.length > 0 && (
                <BoardColumn title='Rework' count={rework.length} accent='text-orange-300 light:text-orange-700' hint='QA failed — retries once, then blocks'>
                  {rework.map((c) => renderTile(c))}
                </BoardColumn>
              )}
              {paused.length > 0 && (
                <BoardColumn title='Paused' count={paused.length} accent='text-warn' hint='resumes next window'>
                  {paused.map((c) => renderTile(c))}
                </BoardColumn>
              )}
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {editor.open && (
          <CardEditorModal
            card={editor.card}
            projects={store.projects}
            templates={store.templates}
            cards={store.cards}
            onSave={(input, attachments) => void handleSave(input, attachments)}
            onClose={() => setEditor({ open: false, card: null })}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {detailCard && <ArtifactViewer card={detailCard} onClose={() => setDetailCard(null)} />}
      </AnimatePresence>
      <AnimatePresence>
        {importOpen && <IssueImportModal projectFilter={projectFilter} onClose={() => setImportOpen(false)} />}
      </AnimatePresence>
      <AnimatePresence>
        {settingsOpen && schedulerConfig && onSchedulerConfigChange && (
          <BacklogSettingsModal
            config={schedulerConfig}
            status={status}
            onChange={onSchedulerConfigChange}
            populationConfig={populationConfig}
            onPopulationChange={onPopulationConfigChange ?? (() => {})}
            initialTab={settingsOpen}
            onClose={() => setSettingsOpen(null)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {paletteOpen && (
          <BacklogSearchPalette
            cards={store.cards}
            projects={store.projects}
            onPick={(card) => { setPaletteOpen(false); setEditor({ open: true, card }); }}
            onClose={() => setPaletteOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

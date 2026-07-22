import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { BacklogCard, BacklogCardState, countUnmetPrereqs } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { logger } from '../../../common/logger';
import { BoardColumn } from './BoardColumn';
import { appAlert, appConfirm, Button, Tooltip } from '../Shared';
import { CardTile } from './CardTile';
import { CardEditorModal } from './CardEditorModal';
import { ArtifactViewer } from './ArtifactViewer';
import { projectColor } from './project-colors';
import { listItem } from '../../motion';

// Global Kanban board (backlog.md Phase 1): all projects on one board, every
// card labelled by project and filterable down to one. The Todo column is the
// autorun queue for the Backlog Scheduler (Settings → Usage → Claude Code).

const FLOW_COLUMNS: { state: BacklogCardState; title: string; hint?: string }[] = [
  { state: 'refinement', title: 'Refinement', hint: 'raw ideas' },
  { state: 'todo', title: 'Todo', hint: 'autorun queue' },
  { state: 'in-progress', title: 'In Progress' },
  { state: 'done', title: 'Done', hint: 'report attached' },
];

// Columns a card can be dragged into. In Progress is engine-only (moveCard
// rejects it in main), so it never lights up as a drop target.
const DROP_TARGETS: BacklogCardState[] = ['refinement', 'todo', 'done'];

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Sync (hydrate + broadcast subscription) lives in SettingsPanel via
// useBacklogSync so the scheduler section's glance stays live even when this
// tab isn't mounted.
export const BacklogBoardTab: React.FC = () => {
  const store = useBacklogStore();

  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [editor, setEditor] = useState<{ open: boolean; card: BacklogCard | null }>({ open: false, card: null });
  const [detailCard, setDetailCard] = useState<BacklogCard | null>(null);
  const [dragCardId, setDragCardId] = useState<string | null>(null);
  // projectId → default model from its .claude/settings.json chain, so tiles
  // can show what a card without an override would actually run with.
  const [defaultModels, setDefaultModels] = useState<Record<string, string | null>>({});

  const projectIdsKey = store.projects.map((p) => p.id).join(',');
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      store.projects.map(async (p): Promise<[string, string | null]> => {
        try {
          const res = await window.electron.invoke('backlog:project-default-model', { projectId: p.id });
          return [p.id, res?.model ?? null];
        } catch {
          return [p.id, null];
        }
      }),
    ).then((entries) => {
      if (!cancelled) setDefaultModels(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projects array identity churns on every hydrate
  }, [projectIdsKey]);

  if (!store.loaded) {
    return (
      <div className='flex items-center gap-3 text-muted'>
        <div className='w-4 h-4 border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin' />
        Loading board…
      </div>
    );
  }

  if (!store.available) {
    return (
      <div className='glass-primary p-6'>
        <h2 className='text-lg font-bold text-strong'>Backlog board unavailable</h2>
        <p className='text-sm text-muted mt-2'>{store.reason}</p>
      </div>
    );
  }

  const projectName = (id: string) => store.projects.find((p) => p.id === id)?.name ?? 'unknown';
  const visibleCards = store.cards.filter((c) => projectFilter === 'all' || c.projectId === projectFilter);
  const byState = (state: BacklogCardState) =>
    visibleCards
      .filter((c) => (state === 'in-progress' ? c.state === 'in-progress' || c.state === 'claimed' : c.state === state))
      .sort((a, b) => (state === 'todo' ? a.sortOrder - b.sortOrder : b.updatedAt - a.updatedAt));

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
        message: `This is a ${card.riskTier} card (manual only). Running it will spend real Claude usage.`,
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
      : 'Backlog autorun off — run cards with "Run now", or enable windows in Usage → Claude Code';
  })();

  const renderTile = (card: BacklogCard) => {
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
          projectDefaultModel={defaultModels[card.projectId] ?? null}
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
        />
      </motion.div>
    );
  };

  const blocked = byState('blocked');
  const rework = byState('rework');
  const paused = byState('paused');

  return (
    // min-h fills the viewport below the panel header/tabs so the columns
    // stretch instead of hugging the top of a maximized window.
    <div className='flex flex-col gap-5 min-h-[calc(100vh-16rem)]'>
      {/* Header: glance + project filter + actions */}
      <div className='glass-primary p-4 flex flex-col gap-3'>
        <div className='flex items-center gap-3 flex-wrap'>
          <div className='flex-1 min-w-48'>
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
          <Button variant='secondary' size='sm' onClick={handleAddProject}>
            + Add project
          </Button>
          <Tooltip content={store.projects.length === 0 ? 'Register a project folder first' : undefined}>
            <Button
              variant='primary'
              size='sm'
              onClick={() => setEditor({ open: true, card: null })}
              disabled={store.projects.length === 0}
            >
              + New card
            </Button>
          </Tooltip>
        </div>

        {store.projects.length > 0 && (
          <div className='flex items-center gap-1 flex-wrap'>
            <button
              onClick={() => setProjectFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                projectFilter === 'all' ? 'bg-control text-strong shadow-inner' : 'text-muted hover:text-strong'
              }`}
            >
              All projects
            </button>
            {store.projects.map((p) => (
              <span key={p.id} className='flex items-center'>
                <Tooltip content={p.path}>
                  <button
                    onClick={() => setProjectFilter(p.id)}
                    className={`px-3 py-1 rounded-l-lg text-xs font-medium cursor-pointer transition-colors ${
                      projectFilter === p.id ? projectColor(p.id).filterActive : projectColor(p.id).filter
                    }`}
                  >
                    {p.name}
                  </button>
                </Tooltip>
                <Tooltip content={`Remove ${p.name} from the board`}>
                  <button
                    onClick={() => void handleRemoveProject(p.id)}
                    className='px-1.5 py-1 rounded-r-lg text-xs text-faint hover:text-danger hover:bg-red-500/20 cursor-pointer transition-colors'
                    aria-label={`Remove ${p.name}`}
                  >
                    ✕
                  </button>
                </Tooltip>
              </span>
            ))}
          </div>
        )}
      </div>

      {store.projects.length === 0 ? (
        <div className='glass-primary p-6'>
          <h2 className='text-lg font-bold text-strong'>Add your first project</h2>
          <p className='text-sm text-muted mt-2 max-w-xl'>
            Cards belong to a project (a repo folder — the agent runs there). Register one, queue research
            cards, and the Backlog Scheduler executes them during your idle windows — turning unused
            5-hour-window credit into reports waiting for you in the morning.
          </p>
        </div>
      ) : (
        <>
          {/* Main flow — flex-1 + auto-rows-fr stretch the columns to fill the tab */}
          <div className='flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 auto-rows-fr gap-4'>
            {FLOW_COLUMNS.map((col) => {
              const cards = byState(col.state);
              return (
                <BoardColumn
                  key={col.state}
                  title={col.title}
                  hint={col.hint}
                  count={cards.length}
                  droppable={columnDroppable(col.state)}
                  onDropCard={() => void handleDropOnColumn(col.state)}
                >
                  {cards.map(renderTile)}
                </BoardColumn>
              );
            })}
          </div>

          {/* Attention rail — only when something needs it. Blocked / Rework /
              Paused cards are never drop targets (see DROP_TARGETS above). */}
          {(blocked.length > 0 || rework.length > 0 || paused.length > 0) && (
            <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
              {blocked.length > 0 && (
                <BoardColumn title='Blocked' count={blocked.length} accent='text-danger' hint='needs your attention'>
                  {blocked.map(renderTile)}
                </BoardColumn>
              )}
              {rework.length > 0 && (
                <BoardColumn title='Rework' count={rework.length} accent='text-orange-300 light:text-orange-700' hint='QA failed — retries once, then blocks'>
                  {rework.map(renderTile)}
                </BoardColumn>
              )}
              {paused.length > 0 && (
                <BoardColumn title='Paused' count={paused.length} accent='text-warn' hint='resumes next window'>
                  {paused.map(renderTile)}
                </BoardColumn>
              )}
            </div>
          )}
        </>
      )}

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
      {detailCard && <ArtifactViewer card={detailCard} onClose={() => setDetailCard(null)} />}
    </div>
  );
};

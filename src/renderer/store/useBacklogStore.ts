import { create } from 'zustand';
import { useEffect } from 'react';
import {
  AttachmentIntent,
  BacklogAttachment,
  BacklogCard,
  BacklogCardState,
  BacklogProject,
  BacklogSchedulerStatus,
  BacklogState,
  BacklogTemplate,
  PendingAttachment,
} from '../../common/backlog-types';
import { logger } from '../../common/logger';

// Board state shared between the Backlog tab and the Backlog Scheduler
// section's status glance. Hydrated in one `backlog:get-state` call and kept
// fresh by the main process's `backlog:changed` / `backlog:status-updated`
// broadcasts. Mutations go straight to IPC; the follow-up broadcast (or the
// returned row) reconciles local state.

interface BacklogStore {
  loaded: boolean;
  available: boolean;
  reason?: string;
  projects: BacklogProject[];
  cards: BacklogCard[];
  templates: BacklogTemplate[];
  status: BacklogSchedulerStatus | null;

  hydrate: () => Promise<void>;
  setStatus: (status: BacklogSchedulerStatus) => void;

  addProject: (path: string) => Promise<BacklogProject | null>;
  removeProject: (id: string) => Promise<{ ok: boolean; reason?: string }>;
  createCard: (input: {
    title: string; description: string; projectId: string;
    state?: 'refinement' | 'todo';
    taskType?: BacklogCard['taskType'];
    riskTier?: BacklogCard['riskTier'];
    model?: string | null;
    estimatedMinutes?: number | null;
    estimatedCostUsd?: number | null;
    prereqIds?: string[];
    qaProvider?: BacklogCard['qaProvider'];
    qaCommand?: string | null;
    acceptanceCriteria?: string[];
  }) => Promise<BacklogCard | null>;
  updateCard: (id: string, patch: Partial<BacklogCard>) => Promise<BacklogCard | null>;
  deleteCard: (id: string) => Promise<void>;
  moveCard: (id: string, state: BacklogCardState) => Promise<{ ok: boolean; reason?: string }>;
  reorderTodo: (orderedIds: string[]) => Promise<void>;
  runNow: (cardId: string) => Promise<{ ok: boolean; reason?: string }>;
  stopRun: () => Promise<{ ok: boolean; reason?: string }>;
  removeWorktree: (cardId: string) => Promise<{ ok: boolean; reason?: string }>;
  applyWorktree: (cardId: string) => Promise<{ ok: boolean; reason?: string; empty?: boolean; alreadyApplied?: boolean; threeWay?: boolean; conflicted?: boolean; dirtyTarget?: boolean; changedFiles?: string[] }>;
  applyWorktreeStashed: (cardId: string) => Promise<{ ok: boolean; reason?: string; empty?: boolean; alreadyApplied?: boolean; threeWay?: boolean; stashed?: boolean; stashConflicted?: boolean; changedFiles?: string[] }>;
  updateTemplates: (templates: BacklogTemplate[]) => Promise<BacklogTemplate[] | null>;

  listAttachments: (cardId: string) => Promise<BacklogAttachment[]>;
  pickAttachments: () => Promise<{ items: PendingAttachment[]; skipped: { filename: string; reason: string }[] }>;
  setCardAttachments: (cardId: string, intent: AttachmentIntent) => Promise<BacklogAttachment[]>;
}

export const useBacklogStore = create<BacklogStore>((set, get) => ({
  loaded: false,
  available: false,
  projects: [],
  cards: [],
  templates: [],
  status: null,

  hydrate: async () => {
    try {
      const state: BacklogState = await window.electron.invoke('backlog:get-state');
      set({
        loaded: true,
        available: state.available,
        reason: state.reason,
        projects: state.projects,
        cards: state.cards,
        templates: state.templates,
        status: state.status,
      });
    } catch (e) {
      logger.error('[useBacklogStore] hydrate failed', e);
      set({ loaded: true, available: false, reason: 'failed to load backlog state' });
    }
  },

  setStatus: (status) => set({ status }),

  addProject: async (path) => {
    try {
      const project = await window.electron.invoke('backlog:add-project', { path });
      await get().hydrate();
      return project;
    } catch (e) {
      logger.error('[useBacklogStore] addProject failed', e);
      return null;
    }
  },

  removeProject: async (id) => {
    try {
      const res = await window.electron.invoke('backlog:remove-project', { id });
      if (res?.ok) await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] removeProject failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  createCard: async (input) => {
    try {
      const card = await window.electron.invoke('backlog:create-card', input);
      await get().hydrate();
      return card;
    } catch (e) {
      logger.error('[useBacklogStore] createCard failed', e);
      return null;
    }
  },

  updateCard: async (id, patch) => {
    try {
      const card = await window.electron.invoke('backlog:update-card', { id, patch });
      await get().hydrate();
      return card;
    } catch (e) {
      logger.error('[useBacklogStore] updateCard failed', e);
      return null;
    }
  },

  deleteCard: async (id) => {
    try {
      await window.electron.invoke('backlog:delete-card', { id });
      await get().hydrate();
    } catch (e) {
      logger.error('[useBacklogStore] deleteCard failed', e);
    }
  },

  moveCard: async (id, state) => {
    try {
      const res = await window.electron.invoke('backlog:move-card', { id, state });
      if (res?.ok) await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] moveCard failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  reorderTodo: async (orderedIds) => {
    // Optimistic: reflect the new order immediately, the broadcast reconciles.
    set((s) => {
      const rank = new Map(orderedIds.map((id, i) => [id, i]));
      const cards = [...s.cards].sort((a, b) => {
        if (a.state !== 'todo' || b.state !== 'todo') return 0;
        return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
      });
      return { cards };
    });
    try {
      await window.electron.invoke('backlog:reorder-todo', { orderedIds });
      await get().hydrate();
    } catch (e) {
      logger.error('[useBacklogStore] reorderTodo failed', e);
    }
  },

  runNow: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:run-now', { cardId });
      await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] runNow failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  // Discards the worktree's uncommitted changes (confirmed in the caller);
  // the captured diff artifact stays on the card either way.
  removeWorktree: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:remove-worktree', { cardId });
      if (res?.ok) await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] removeWorktree failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  // Lands the worktree's changes onto the project's working tree. Leaves the
  // worktree pointer intact, so no hydrate is needed on success.
  applyWorktree: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:apply-worktree', { cardId });
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] applyWorktree failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  // Stashes the project's local changes, applies the worktree, then pops the
  // stash back on top. Offered when applyWorktree reports a dirty target.
  applyWorktreeStashed: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:apply-worktree-stashed', { cardId });
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] applyWorktreeStashed failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  updateTemplates: async (templates) => {
    try {
      // Main revalidates (migrateBacklogTemplates) and returns the kept rows.
      const updated = await window.electron.invoke('backlog:templates:update', templates);
      if (Array.isArray(updated)) set({ templates: updated });
      return Array.isArray(updated) ? updated : null;
    } catch (e) {
      logger.error('[useBacklogStore] updateTemplates failed', e);
      return null;
    }
  },

  stopRun: async () => {
    try {
      // No hydrate here — the card settles asynchronously after the kill; the
      // engine's backlog:changed broadcast reconciles once it lands in Paused.
      const res = await window.electron.invoke('backlog:stop-run');
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] stopRun failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  listAttachments: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:list-attachments', { cardId });
      return Array.isArray(res?.attachments) ? res.attachments : [];
    } catch (e) {
      logger.error('[useBacklogStore] listAttachments failed', e);
      return [];
    }
  },

  pickAttachments: async () => {
    try {
      const res = await window.electron.invoke('backlog:pick-attachments');
      return { items: res?.items ?? [], skipped: res?.skipped ?? [] };
    } catch (e) {
      logger.error('[useBacklogStore] pickAttachments failed', e);
      return { items: [], skipped: [] };
    }
  },

  setCardAttachments: async (cardId, intent) => {
    try {
      const res = await window.electron.invoke('backlog:set-card-attachments', { cardId, intent });
      return Array.isArray(res?.attachments) ? res.attachments : [];
    } catch (e) {
      logger.error('[useBacklogStore] setCardAttachments failed', e);
      return [];
    }
  },
}));

/**
 * Hydrate once and keep the store synced to main-process broadcasts. Mount in
 * any component tree that renders backlog data (board tab, scheduler section).
 */
export function useBacklogSync(): void {
  const hydrate = useBacklogStore((s) => s.hydrate);
  const setStatus = useBacklogStore((s) => s.setStatus);
  useEffect(() => {
    void hydrate();
    const onChanged = () => { void hydrate(); };
    const onStatus = (_e: unknown, status: BacklogSchedulerStatus) => setStatus(status);
    const onTemplates = (_e: unknown, templates: BacklogTemplate[]) =>
      useBacklogStore.setState({ templates });
    window.electron.on('backlog:changed', onChanged);
    window.electron.on('backlog:status-updated', onStatus);
    window.electron.on('backlog:templates-updated', onTemplates);
    return () => {
      window.electron.off('backlog:changed', onChanged);
      window.electron.off('backlog:status-updated', onStatus);
      window.electron.off('backlog:templates-updated', onTemplates);
    };
  }, [hydrate, setStatus]);
}

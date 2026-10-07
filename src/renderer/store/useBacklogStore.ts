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
  IssueFilter,
  IssuePopulationState,
  JiraProject,
  JiraSite,
  LinearProject,
  LinearTeam,
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
  population: IssuePopulationState;

  hydrate: () => Promise<void>;
  setStatus: (status: BacklogSchedulerStatus) => void;

  // Issue population (Phase 3): GitLab + Linear
  linkGitlab: (projectId: string) => Promise<{ ok: boolean; reason?: string; projectPath?: string; host?: string; id?: number }>;
  listLinearTeams: () => Promise<{ ok: boolean; teams: LinearTeam[]; reason?: string }>;
  listLinearProjects: (teamId: string) => Promise<{ ok: boolean; projects: LinearProject[]; reason?: string }>;
  linkLinear: (projectId: string, team: LinearTeam, project?: LinearProject | null) => Promise<{ ok: boolean; reason?: string }>;
  listJiraSites: () => Promise<{ ok: boolean; sites: JiraSite[]; reason?: string }>;
  listJiraProjects: (cloudId: string) => Promise<{ ok: boolean; projects: JiraProject[]; reason?: string }>;
  linkJira: (projectId: string, site: JiraSite, project: JiraProject) => Promise<{ ok: boolean; reason?: string }>;
  unlinkSource: (projectId: string) => Promise<{ ok: boolean; reason?: string }>;
  setIssueFilter: (projectId: string, filter: IssueFilter) => Promise<{ ok: boolean; reason?: string }>;
  scan: (projectId?: string) => Promise<{ ok?: boolean; candidates?: number; reason?: string }>;
  importCandidates: (fingerprints: string[]) => Promise<{ ok: boolean; imported?: number; reason?: string }>;
  dismissCandidates: (fingerprints: string[]) => Promise<{ ok: boolean; dismissed?: number; reason?: string }>;

  addProject: (path: string) => Promise<BacklogProject | null>;
  removeProject: (id: string) => Promise<{ ok: boolean; reason?: string }>;
  createCard: (input: {
    title: string; description: string; projectId: string;
    state?: 'refinement' | 'todo';
    taskType?: BacklogCard['taskType'];
    agent?: BacklogCard['agent'];
    riskTier?: BacklogCard['riskTier'];
    model?: string | null;
    estimatedMinutes?: number | null;
    estimatedCostUsd?: number | null;
    prereqIds?: string[];
    qaProvider?: BacklogCard['qaProvider'];
    qaCommand?: string | null;
    qaUrl?: string | null;
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
  markApplied: (cardId: string) => Promise<{ ok: boolean; reason?: string }>;
  clearApplied: (cardId: string) => Promise<{ ok: boolean; reason?: string }>;
  resumeSession: (cardId: string) => Promise<{ ok: boolean; reason?: string }>;
  refineStart: (cardId: string) => Promise<{ ok: boolean; reason?: string }>;
  importPlan: (cardId: string) => Promise<{ ok: boolean; reason?: string; imported?: boolean; chars?: number }>;
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
  population: { candidates: [], connector: 'unknown', scanning: false, lastScanAt: null, lastReason: null },

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
        population: state.population,
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

  // ── Issue population (Phase 3): GitLab + Linear ────────────────────────────
  // All delegate to main, which broadcasts `backlog:changed`; we also await a
  // hydrate so the caller sees fresh state without waiting for the broadcast.

  linkGitlab: async (projectId) => {
    try {
      const res = await window.electron.invoke('backlog:link-gitlab', { projectId });
      await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] linkGitlab failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  // Read-only scout that lists Linear teams for the link picker. No state
  // change, so no hydrate.
  listLinearTeams: async () => {
    try {
      const res = await window.electron.invoke('backlog:list-linear-teams');
      return res ?? { ok: false, teams: [], reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] listLinearTeams failed', e);
      return { ok: false, teams: [], reason: String(e) };
    }
  },

  // Read-only scout that lists a team's Linear projects for the optional
  // narrowing step. No state change, so no hydrate.
  listLinearProjects: async (teamId) => {
    try {
      const res = await window.electron.invoke('backlog:list-linear-projects', { teamId });
      return res ?? { ok: false, projects: [], reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] listLinearProjects failed', e);
      return { ok: false, projects: [], reason: String(e) };
    }
  },

  linkLinear: async (projectId, team, project) => {
    try {
      const res = await window.electron.invoke('backlog:link-linear', {
        projectId, teamId: team.id, teamKey: team.key, teamName: team.name,
        scopeProjectId: project?.id, scopeProjectName: project?.name,
      });
      await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] linkLinear failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  // Read-only scout that lists Atlassian sites for the JIRA link Step-1 picker.
  // No state change, so no hydrate.
  listJiraSites: async () => {
    try {
      const res = await window.electron.invoke('backlog:list-jira-sites');
      return res ?? { ok: false, sites: [], reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] listJiraSites failed', e);
      return { ok: false, sites: [], reason: String(e) };
    }
  },

  // Read-only scout that lists a site's Jira projects for the Step-2 picker. No
  // state change, so no hydrate.
  listJiraProjects: async (cloudId) => {
    try {
      const res = await window.electron.invoke('backlog:list-jira-projects', { cloudId });
      return res ?? { ok: false, projects: [], reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] listJiraProjects failed', e);
      return { ok: false, projects: [], reason: String(e) };
    }
  },

  linkJira: async (projectId, site, project) => {
    try {
      const res = await window.electron.invoke('backlog:link-jira', {
        projectId, cloudId: site.cloudId, siteUrl: site.siteUrl, siteName: site.name,
        projectKey: project.key, projectName: project.name,
      });
      await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] linkJira failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  unlinkSource: async (projectId) => {
    try {
      const res = await window.electron.invoke('backlog:unlink-source', { projectId });
      await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] unlinkSource failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  setIssueFilter: async (projectId, filter) => {
    try {
      const res = await window.electron.invoke('backlog:set-issue-filter', { projectId, filter });
      await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] setIssueFilter failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  scan: async (projectId) => {
    try {
      const res = await window.electron.invoke('backlog:scan', { projectId });
      await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] scan failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  importCandidates: async (fingerprints) => {
    try {
      const res = await window.electron.invoke('backlog:import-candidates', { fingerprints });
      await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] importCandidates failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  dismissCandidates: async (fingerprints) => {
    try {
      const res = await window.electron.invoke('backlog:dismiss-candidates', { fingerprints });
      await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] dismissCandidates failed', e);
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

  // Manual override for diffs landed outside Agent Pulse — records the card as
  // shipped ('manual' method). Hydrate so the Shipped ribbon appears.
  markApplied: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:mark-applied', { cardId });
      if (res?.ok) await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] markApplied failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  // Undo a manual mark (hand-marked cards only). Hydrate so the ribbon clears.
  clearApplied: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:clear-applied', { cardId });
      if (res?.ok) await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] clearApplied failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  // Opens an interactive `claude --resume` terminal on the card's worktree.
  // Detaches in main — no state changes here, so no hydrate.
  resumeSession: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:resume-session', { cardId });
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] resumeSession failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  // Opens an interactive plan-mode session for a refinement card. The plan
  // auto-attaches as it's presented (main watches the transcript); hydrate so
  // the card reflects that a session is now open.
  refineStart: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:refine-start', { cardId });
      if (res?.ok) await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] refineStart failed', e);
      return { ok: false, reason: String(e) };
    }
  },

  // Manual pull of the plan from the session transcript (fallback for the
  // auto-attach watcher). Hydrate so the new attachment shows on the card.
  importPlan: async (cardId) => {
    try {
      const res = await window.electron.invoke('backlog:refine-import', { cardId });
      if (res?.ok) await get().hydrate();
      return res ?? { ok: false, reason: 'unavailable' };
    } catch (e) {
      logger.error('[useBacklogStore] importPlan failed', e);
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

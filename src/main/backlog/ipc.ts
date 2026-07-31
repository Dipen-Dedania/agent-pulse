// IPC surface for the backlog board. Always registered — when the SQLite
// store failed to load, every handler returns a clean unavailable result so
// the board tab renders its degraded state instead of hanging invokes
// (same posture as the timeline's IPC).

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { logger } from '../../common/logger';
import {
  ApplyMethod,
  ATTACHMENT_MAX_FILE_BYTES,
  AttachmentIntent,
  BacklogCardState,
  BacklogState,
  BacklogStatsRange,
  BacklogTemplate,
  IssueFilter,
  IssuePopulationState,
  PendingAttachment,
} from '../../common/backlog-types';
import { BacklogStore, CreateCardInput, UpdateCardPatch } from './store';
import { BacklogEngine } from './engine';
import { PopulationScheduler } from './population-scheduler';
import { resolveProjectDefaultModel, ProjectDefaultModel } from './claude-settings';
import { ApplyResult, applyWorktree, applyWorktreeStashed, removeWorktree } from './worktree';
import { isSafeSessionId } from './runner';
import { resolveClaudeBin, resetClaudeBinCache } from '../scheduler/opener';
import { launchResumeTerminal } from './resume-terminal';
import { launchPlanTerminal } from './refine-terminal';
import { readPlanFromTranscript } from './plan-transcript';
import { startPlanWatch, stopPlanWatch } from './refine-watch';

// The refinement plan lands as a single well-known attachment; re-imports and
// live auto-updates overwrite it while leaving the user's other attachments.
const PLAN_ATTACHMENT_FILENAME = 'refinement-plan.md';

/**
 * Save (or overwrite) the refinement plan as a card attachment. Attachments are
 * already inlined into the execution/QA prompt, so this is the whole hand-off
 * to the executor. Capped to the per-file attachment limit — an oversized plan
 * is truncated with a marker rather than silently dropped by the store.
 */
function savePlanAttachment(store: BacklogStore, cardId: string, plan: string): void {
  let content = plan;
  if (Buffer.byteLength(content, 'utf8') > ATTACHMENT_MAX_FILE_BYTES) {
    // Char-slice with headroom below the byte cap, then note the truncation.
    content = content.slice(0, Math.floor(ATTACHMENT_MAX_FILE_BYTES / 2)) +
      '\n\n<!-- plan truncated to fit the attachment size limit — see the planning session for the full text -->';
  }
  const existing = store.listAttachments(cardId);
  const keepIds = existing.filter((a) => a.filename !== PLAN_ATTACHMENT_FILENAME).map((a) => a.id);
  store.setCardAttachments(cardId, {
    keepIds,
    add: [{ filename: PLAN_ATTACHMENT_FILENAME, content, bytes: Buffer.byteLength(content, 'utf8') }],
  });
}

export interface BacklogIpcDeps {
  store: BacklogStore | null;
  engine: BacklogEngine | null;
  population: PopulationScheduler | null;
  getTemplates: () => BacklogTemplate[];
  unavailableReason?: string;
}

// Board hydrate needs a population slice even when population/store is unavailable.
const EMPTY_POPULATION_STATE: IssuePopulationState = {
  candidates: [], connector: 'unknown', scanning: false, lastScanAt: null, lastReason: null,
};

function broadcastChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('backlog:changed', {});
  }
}

const VALID_STATS_RANGES: BacklogStatsRange[] = ['7d', '30d', '90d', '1y'];

/** Map the worktree apply result's flags to the persisted ApplyMethod. */
function methodFromResult(res: ApplyResult & { ok: true }): ApplyMethod {
  if (res.alreadyApplied) return 'already-present';
  if (res.stashed) return 'stashed';
  if (res.threeWay) return 'three-way';
  return 'clean';
}

/**
 * Freeze the apply onto the card after a successful, non-empty apply — the
 * board's "Shipped" ribbon and the Overnight Backlog analytics read from here.
 * `autorun` is derived from the card's most recent attempt (attempts come back
 * newest-first): a diff produced by an unattended autorun is the "shipped
 * overnight by the planner" signal; a "Run now" attempt is manual. An empty
 * apply delivered nothing, so it records nothing.
 */
function recordApplyOnSuccess(store: BacklogStore, cardId: string, res: ApplyResult): void {
  if (!res.ok || res.empty) return;
  const latest = store.listAttempts(cardId)[0];
  store.recordApply(cardId, {
    method: methodFromResult(res),
    autorun: latest ? !latest.manual : false,
    additions: res.additions ?? null,
    deletions: res.deletions ?? null,
    files: res.changedFiles?.length ?? null,
  });
  broadcastChanged();
}

export function registerBacklogIpc(deps: BacklogIpcDeps): void {
  const { store, engine, population, getTemplates } = deps;

  ipcMain.handle('backlog:get-state', (): BacklogState => {
    if (!store) {
      return {
        available: false,
        reason: deps.unavailableReason ?? 'backlog storage unavailable — run `npm run rebuild:native`',
        projects: [],
        cards: [],
        templates: getTemplates(),
        status: null,
        population: EMPTY_POPULATION_STATE,
      };
    }
    return {
      available: true,
      projects: store.listProjects(),
      cards: store.listCards(),
      templates: getTemplates(),
      status: engine?.getStatus() ?? null,
      population: population?.getState() ?? EMPTY_POPULATION_STATE,
    };
  });

  ipcMain.handle('backlog:pick-project-folder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      title: 'Add project to backlog board',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('backlog:add-project', (_e, args: { path: string; name?: string }) => {
    if (!store) return null;
    if (typeof args?.path !== 'string' || !fs.existsSync(args.path)) {
      throw new Error('project folder does not exist');
    }
    const project = store.addProject(args.path, args.name);
    broadcastChanged();
    return project;
  });

  ipcMain.handle('backlog:remove-project', (_e, args: { id: string }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const res = store.removeProject(args.id);
    if (res.ok) broadcastChanged();
    return res;
  });

  // ── Issue population (Phase 3): GitLab + Linear ────────────────────────────
  // link/unlink/set-filter/scan/import/dismiss all delegate to the population
  // scheduler, which broadcasts `backlog:changed` (the hydrate carries the
  // population slice). projectId always references a registered project row.

  ipcMain.handle('backlog:link-gitlab', async (_e, args: { projectId: string }) => {
    if (!store || !population) return { ok: false, reason: 'backlog storage unavailable' };
    return population.linkGitlab(args?.projectId);
  });

  // List the workspace's Linear teams for the link-time picker (read-only scout).
  ipcMain.handle('backlog:list-linear-teams', async () => {
    if (!store || !population) return { ok: false, teams: [], reason: 'backlog storage unavailable' };
    return population.listLinearTeams();
  });

  // List a chosen team's Linear projects for the optional narrowing step (read-only scout).
  ipcMain.handle('backlog:list-linear-projects', async (_e, args: { teamId: string }) => {
    if (!store || !population) return { ok: false, projects: [], reason: 'backlog storage unavailable' };
    return population.listLinearProjects(args?.teamId);
  });

  ipcMain.handle(
    'backlog:link-linear',
    (_e, args: { projectId: string; teamId: string; teamKey: string; teamName: string; scopeProjectId?: string; scopeProjectName?: string }) => {
      if (!store || !population) return { ok: false, reason: 'backlog storage unavailable' };
      const scope = typeof args?.scopeProjectId === 'string' && args.scopeProjectId.trim().length > 0
        ? { projectId: args.scopeProjectId, projectName: args.scopeProjectName ?? '' }
        : null;
      return population.linkLinear(
        args?.projectId,
        { teamId: args?.teamId, teamKey: args?.teamKey, teamName: args?.teamName },
        scope,
      );
    },
  );

  ipcMain.handle('backlog:unlink-source', (_e, args: { projectId: string }) => {
    if (!store || !population) return { ok: false, reason: 'backlog storage unavailable' };
    return population.unlinkProject(args?.projectId);
  });

  ipcMain.handle('backlog:set-issue-filter', (_e, args: { projectId: string; filter: IssueFilter }) => {
    if (!store || !population) return { ok: false, reason: 'backlog storage unavailable' };
    return population.setIssueFilter(args?.projectId, args?.filter);
  });

  ipcMain.handle('backlog:scan', async (_e, args: { projectId?: string }) => {
    if (!store || !population) return { ok: false, reason: 'backlog storage unavailable' };
    return args?.projectId ? population.refreshProject(args.projectId) : population.refreshAll();
  });

  ipcMain.handle('backlog:list-candidates', (_e, args: { projectId?: string }) => {
    if (!store) return { candidates: [] };
    return { candidates: store.listCandidates(args?.projectId) };
  });

  ipcMain.handle('backlog:import-candidates', (_e, args: { fingerprints: string[] }) => {
    if (!store || !population) return { ok: false, reason: 'backlog storage unavailable' };
    const fps = Array.isArray(args?.fingerprints) ? args.fingerprints.filter((x): x is string => typeof x === 'string') : [];
    return population.importCandidates(fps);
  });

  ipcMain.handle('backlog:dismiss-candidates', (_e, args: { fingerprints: string[] }) => {
    if (!store || !population) return { ok: false, reason: 'backlog storage unavailable' };
    const fps = Array.isArray(args?.fingerprints) ? args.fingerprints.filter((x): x is string => typeof x === 'string') : [];
    return population.dismissCandidates(fps);
  });

  // What "Project default" resolves to for the card editor's model picker.
  // Looked up by project id (not a renderer-supplied path) so only registered
  // folders are ever read.
  ipcMain.handle('backlog:project-default-model', (_e, args: { projectId: string }): ProjectDefaultModel => {
    const project = store?.listProjects().find((p) => p.id === args?.projectId);
    if (!project) return { model: null, source: null };
    return resolveProjectDefaultModel(project.path);
  });

  ipcMain.handle('backlog:create-card', (_e, input: CreateCardInput) => {
    if (!store) return null;
    if (typeof input?.title !== 'string' || input.title.trim().length === 0) {
      throw new Error('card title is required');
    }
    if (typeof input?.projectId !== 'string' || !store.listProjects().some((p) => p.id === input.projectId)) {
      throw new Error('a registered project is required');
    }
    const card = store.createCard(input);
    broadcastChanged();
    engine?.onQueueChanged();
    return card;
  });

  ipcMain.handle('backlog:update-card', (_e, args: { id: string; patch: UpdateCardPatch }) => {
    if (!store) return null;
    const card = store.updateCard(args.id, args.patch ?? {});
    if (card) broadcastChanged();
    return card;
  });

  ipcMain.handle('backlog:delete-card', (_e, args: { id: string }) => {
    if (!store) return;
    stopPlanWatch(args.id);
    store.deleteCard(args.id);
    broadcastChanged();
  });

  ipcMain.handle('backlog:move-card', (_e, args: { id: string; state: BacklogCardState }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const res = store.moveCard(args.id, args.state);
    if (res.ok) {
      // Left the refinement column → the planning session is done with; stop
      // auto-attaching. Re-refining later restarts a fresh watch.
      if (args.state !== 'refinement') stopPlanWatch(args.id);
      broadcastChanged();
      engine?.onQueueChanged();
    }
    return res;
  });

  ipcMain.handle('backlog:reorder-todo', (_e, args: { orderedIds: string[] }) => {
    if (!store) return;
    if (!Array.isArray(args?.orderedIds)) return;
    store.reorderTodo(args.orderedIds.filter((id): id is string => typeof id === 'string'));
    broadcastChanged();
    engine?.onQueueChanged();
  });

  ipcMain.handle('backlog:run-now', (_e, args: { cardId: string }) => {
    if (!store || !engine) return { ok: false, reason: 'backlog storage unavailable' };
    return engine.runNow(args.cardId);
  });

  ipcMain.handle('backlog:stop-run', () => {
    if (!engine) return { ok: false, reason: 'backlog storage unavailable' };
    return engine.stopCurrent();
  });

  // Explicit user action from the card ("Remove worktree") — the worktree is
  // dirty by design, so this discards the uncommitted work. The path comes
  // from the DB (engine-written), never from the renderer.
  ipcMain.handle('backlog:remove-worktree', async (_e, args: { cardId: string }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const card = store.getCard(args?.cardId);
    if (!card) return { ok: false, reason: 'card not found' };
    if (!card.worktreePath) return { ok: false, reason: 'card has no worktree' };
    if (engine?.getStatus().runningCardId === card.id) {
      return { ok: false, reason: 'card is running — stop it first' };
    }
    const project = store.listProjects().find((p) => p.id === card.projectId);
    const res = await removeWorktree(project?.path ?? card.worktreePath, card.worktreePath);
    if (res.ok) {
      store.clearWorktree(card.id);
      broadcastChanged();
    }
    return res;
  });

  // Explicit user action from the card ("Apply to project") — lands the
  // worktree's uncommitted changes onto the project's active working tree.
  // Both paths come from the DB (engine-written), never from the renderer.
  ipcMain.handle('backlog:apply-worktree', async (_e, args: { cardId: string }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const card = store.getCard(args?.cardId);
    if (!card) return { ok: false, reason: 'card not found' };
    if (!card.worktreePath) return { ok: false, reason: 'card has no worktree' };
    if (engine?.getStatus().runningCardId === card.id) {
      return { ok: false, reason: 'card is running — stop it first' };
    }
    const project = store.listProjects().find((p) => p.id === card.projectId);
    if (!project) return { ok: false, reason: 'project not found for this card' };
    const res = await applyWorktree(project.path, card.worktreePath);
    recordApplyOnSuccess(store, card.id, res);
    return res;
  });

  // Follow-up action when apply reported an overlapping dirty target: stash the
  // project's local changes, apply, then pop the stash back on top.
  ipcMain.handle('backlog:apply-worktree-stashed', async (_e, args: { cardId: string }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const card = store.getCard(args?.cardId);
    if (!card) return { ok: false, reason: 'card not found' };
    if (!card.worktreePath) return { ok: false, reason: 'card has no worktree' };
    if (engine?.getStatus().runningCardId === card.id) {
      return { ok: false, reason: 'card is running — stop it first' };
    }
    const project = store.listProjects().find((p) => p.id === card.projectId);
    if (!project) return { ok: false, reason: 'project not found for this card' };
    const res = await applyWorktreeStashed(project.path, card.worktreePath);
    recordApplyOnSuccess(store, card.id, res);
    return res;
  });

  // "Mark as applied" — a manual override for execution cards whose diff was
  // landed OUTSIDE Agent Pulse (your own git merge/commit), so the auto-capture
  // in the apply handlers never fired. Without it the "shipped overnight" count
  // silently undercounts. Records method 'manual' with no LOC snapshot (the
  // worktree is typically already gone, so the real diff is unrecoverable) and
  // derives the overnight/manual origin from the card's latest attempt — same
  // rule as an in-app apply. Refused once the card is already applied so a real
  // git-apply snapshot is never overwritten by a hand-mark.
  ipcMain.handle('backlog:mark-applied', (_e, args: { cardId: string }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const card = store.getCard(args?.cardId);
    if (!card) return { ok: false, reason: 'card not found' };
    if (card.taskType !== 'execution') return { ok: false, reason: 'only execution cards ship a diff' };
    if (card.appliedAt != null) return { ok: false, reason: 'card is already marked applied' };
    if (engine?.getStatus().runningCardId === card.id) {
      return { ok: false, reason: 'card is running — stop it first' };
    }
    const latest = store.listAttempts(card.id)[0];
    store.recordApply(card.id, {
      method: 'manual',
      autorun: latest ? !latest.manual : false,
      additions: null,
      deletions: null,
      files: null,
    });
    broadcastChanged();
    return { ok: true };
  });

  // Undo a manual "Mark as applied" mis-click. Restricted to hand-marked cards
  // ('manual') so an auto-captured git-apply record (and its LOC snapshot, the
  // only durable trace of the diff) can't be erased from the UI.
  ipcMain.handle('backlog:clear-applied', (_e, args: { cardId: string }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const card = store.getCard(args?.cardId);
    if (!card) return { ok: false, reason: 'card not found' };
    if (card.appliedAt == null) return { ok: false, reason: 'card is not marked applied' };
    if (card.applyMethod !== 'manual') {
      return { ok: false, reason: 'only a manual mark can be cleared — this diff was applied through Agent Pulse' };
    }
    store.clearApply(card.id);
    broadcastChanged();
    return { ok: true };
  });

  // "Resume in Claude Code": open an interactive terminal on the worktree that
  // picks up the latest attempt's session by hand. The session id lives on the
  // attempt (never the renderer) and the cwd is the DB-stored worktree path, so
  // resume resolves against the same directory the headless run created it in.
  ipcMain.handle('backlog:resume-session', (_e, args: { cardId: string }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const card = store.getCard(args?.cardId);
    if (!card) return { ok: false, reason: 'card not found' };
    if (!card.worktreePath) return { ok: false, reason: 'card has no worktree to resume in' };
    // Attempts come back newest-first; the worktree reflects the most recent run.
    const sessionId = store.listAttempts(card.id).find((a) => a.sessionId)?.sessionId ?? null;
    if (!sessionId) return { ok: false, reason: 'no resumable session recorded for this card' };
    if (!isSafeSessionId(sessionId)) return { ok: false, reason: 'recorded session id is malformed' };
    const bin = resolveClaudeBin();
    if (!bin) {
      resetClaudeBinCache();
      return { ok: false, reason: 'claude CLI not found on PATH' };
    }
    return launchResumeTerminal(bin, card.worktreePath, sessionId);
  });

  // "Refine Now": open an interactive plan-mode session for a refinement card
  // and start watching its transcript so the plan auto-attaches when presented.
  // The session id (a generated UUID) is stored on the card so a later import /
  // the watcher can find the transcript. Read-only plan mode runs in the
  // project repo — no worktree.
  ipcMain.handle('backlog:refine-start', (_e, args: { cardId: string }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const card = store.getCard(args?.cardId);
    if (!card) return { ok: false, reason: 'card not found' };
    if (card.state !== 'refinement') return { ok: false, reason: 'only refinement cards can be planned — move it back to Refinement first' };
    const project = store.listProjects().find((p) => p.id === card.projectId);
    if (!project) return { ok: false, reason: 'project not found for this card' };
    const bin = resolveClaudeBin();
    if (!bin) {
      resetClaudeBinCache();
      return { ok: false, reason: 'claude CLI not found on PATH' };
    }
    const sessionId = randomUUID();
    store.setRefinementSession(card.id, sessionId);
    const launch = launchPlanTerminal(bin, project.path, sessionId);
    if (!launch.ok) return launch;
    startPlanWatch(card.id, {
      readPlan: () => readPlanFromTranscript(project.path, sessionId),
      onPlan: (plan) => {
        savePlanAttachment(store, card.id, plan);
        broadcastChanged();
      },
    });
    broadcastChanged();
    return { ok: true };
  });

  // Manual fallback for the auto-attach watcher (covers an app restart
  // mid-session or a missed poll): pull the plan from the session transcript
  // now and attach it.
  ipcMain.handle('backlog:refine-import', (_e, args: { cardId: string }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const card = store.getCard(args?.cardId);
    if (!card) return { ok: false, reason: 'card not found' };
    if (!card.refinementSessionId) return { ok: false, reason: 'no planning session yet — click Refine first' };
    const project = store.listProjects().find((p) => p.id === card.projectId);
    if (!project) return { ok: false, reason: 'project not found for this card' };
    const plan = readPlanFromTranscript(project.path, card.refinementSessionId);
    if (!plan) return { ok: false, reason: 'no plan found yet — present a plan in the terminal, then import' };
    savePlanAttachment(store, card.id, plan);
    broadcastChanged();
    return { ok: true, imported: true, chars: plan.length };
  });

  ipcMain.handle('backlog:get-attempts', (_e, args: { cardId: string }) => {
    if (!store) return { attempts: [], artifacts: [] };
    return {
      attempts: store.listAttempts(args.cardId),
      artifacts: store.listArtifacts(args.cardId),
    };
  });

  // Overnight Backlog analytics — aggregates of applied execution cards, served
  // from the backlog DB (never the timeline DB). Returns null when the store is
  // unavailable so the analytics card renders its own empty/unavailable state.
  ipcMain.handle('backlog:get-stats', (_e, args: { range?: string }) => {
    if (!store) return null;
    const range = VALID_STATS_RANGES.includes(args?.range as BacklogStatsRange)
      ? (args!.range as BacklogStatsRange)
      : '30d';
    return store.getShippedStats(range, Date.now());
  });

  ipcMain.handle('backlog:read-artifact', (_e, args: { artifactId: string }) => {
    if (!store) return { content: null };
    const artifact = store.getArtifact(args.artifactId);
    if (!artifact) return { content: null };
    try {
      // Screenshots are binary — the sandboxed renderer can't read file paths,
      // so ship a data URL instead of utf8 content.
      if (artifact.kind === 'screenshot') {
        const ext = path.extname(artifact.path).toLowerCase();
        const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
        const dataUrl = `data:${mime};base64,${fs.readFileSync(artifact.path).toString('base64')}`;
        return { content: null, dataUrl, path: artifact.path };
      }
      return { content: fs.readFileSync(artifact.path, 'utf8'), path: artifact.path };
    } catch (e: any) {
      logger.warn('[Backlog] failed to read artifact file:', e?.message ?? e);
      return { content: artifact.preview, path: artifact.path, truncated: true };
    }
  });

  ipcMain.handle('backlog:list-attachments', (_e, args: { cardId: string }) => {
    if (!store || typeof args?.cardId !== 'string') return { attachments: [] };
    return { attachments: store.listAttachments(args.cardId) };
  });

  // Open the OS file picker, read + validate the chosen files, and return their
  // text content for the editor to hold until save. Reads happen in main (the
  // renderer has no filesystem access) but NOTHING is persisted here — that is
  // set-card-attachments' job, so a cancelled edit leaves no trace.
  ipcMain.handle(
    'backlog:pick-attachments',
    async (): Promise<{ items: PendingAttachment[]; skipped: { filename: string; reason: string }[] }> => {
      const result = await dialog.showOpenDialog({
        title: 'Attach files to card',
        properties: ['openFile', 'multiSelections'],
      });
      if (result.canceled) return { items: [], skipped: [] };

      const items: PendingAttachment[] = [];
      const skipped: { filename: string; reason: string }[] = [];
      for (const filePath of result.filePaths) {
        const filename = filePath.split(/[\\/]/).pop() || filePath;
        try {
          const buf = fs.readFileSync(filePath);
          if (buf.byteLength > ATTACHMENT_MAX_FILE_BYTES) {
            skipped.push({ filename, reason: `too large (max ${Math.round(ATTACHMENT_MAX_FILE_BYTES / 1024)} KB)` });
            continue;
          }
          // A NUL byte means it isn't UTF-8 text — inlining binary into the
          // prompt is meaningless, so reject it with a clear reason.
          if (buf.includes(0)) {
            skipped.push({ filename, reason: 'not a text file' });
            continue;
          }
          items.push({ filename, content: buf.toString('utf8'), bytes: buf.byteLength });
        } catch (e: any) {
          skipped.push({ filename, reason: `could not read (${e?.message ?? e})` });
        }
      }
      return { items, skipped };
    },
  );

  ipcMain.handle('backlog:set-card-attachments', (_e, args: { cardId: string; intent: AttachmentIntent }) => {
    if (!store || typeof args?.cardId !== 'string') return { attachments: [] };
    const attachments = store.setCardAttachments(args.cardId, args.intent ?? { keepIds: [], add: [] });
    broadcastChanged();
    return { attachments };
  });
}

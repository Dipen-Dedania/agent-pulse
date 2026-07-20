// IPC surface for the backlog board. Always registered — when the SQLite
// store failed to load, every handler returns a clean unavailable result so
// the board tab renders its degraded state instead of hanging invokes
// (same posture as the timeline's IPC).

import fs from 'fs';
import path from 'path';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { logger } from '../../common/logger';
import {
  ATTACHMENT_MAX_FILE_BYTES,
  AttachmentIntent,
  BacklogCardState,
  BacklogState,
  BacklogTemplate,
  PendingAttachment,
} from '../../common/backlog-types';
import { BacklogStore, CreateCardInput, UpdateCardPatch } from './store';
import { BacklogEngine } from './engine';
import { resolveProjectDefaultModel, ProjectDefaultModel } from './claude-settings';
import { applyWorktree, applyWorktreeStashed, removeWorktree } from './worktree';

export interface BacklogIpcDeps {
  store: BacklogStore | null;
  engine: BacklogEngine | null;
  getTemplates: () => BacklogTemplate[];
  unavailableReason?: string;
}

function broadcastChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('backlog:changed', {});
  }
}

export function registerBacklogIpc(deps: BacklogIpcDeps): void {
  const { store, engine, getTemplates } = deps;

  ipcMain.handle('backlog:get-state', (): BacklogState => {
    if (!store) {
      return {
        available: false,
        reason: deps.unavailableReason ?? 'backlog storage unavailable — run `npm run rebuild:native`',
        projects: [],
        cards: [],
        templates: getTemplates(),
        status: null,
      };
    }
    return {
      available: true,
      projects: store.listProjects(),
      cards: store.listCards(),
      templates: getTemplates(),
      status: engine?.getStatus() ?? null,
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
    store.deleteCard(args.id);
    broadcastChanged();
  });

  ipcMain.handle('backlog:move-card', (_e, args: { id: string; state: BacklogCardState }) => {
    if (!store) return { ok: false, reason: 'backlog storage unavailable' };
    const res = store.moveCard(args.id, args.state);
    if (res.ok) {
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
    return applyWorktree(project.path, card.worktreePath);
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
    return applyWorktreeStashed(project.path, card.worktreePath);
  });

  ipcMain.handle('backlog:get-attempts', (_e, args: { cardId: string }) => {
    if (!store) return { attempts: [], artifacts: [] };
    return {
      attempts: store.listAttempts(args.cardId),
      artifacts: store.listArtifacts(args.cardId),
    };
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

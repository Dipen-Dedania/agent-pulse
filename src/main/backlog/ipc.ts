// IPC surface for the backlog board. Always registered — when the SQLite
// store failed to load, every handler returns a clean unavailable result so
// the board tab renders its degraded state instead of hanging invokes
// (same posture as the timeline's IPC).

import fs from 'fs';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { logger } from '../../common/logger';
import { BacklogCardState, BacklogState, BacklogTemplate } from '../../common/backlog-types';
import { BacklogStore, CreateCardInput, UpdateCardPatch } from './store';
import { BacklogEngine } from './engine';
import { resolveProjectDefaultModel, ProjectDefaultModel } from './claude-settings';

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
      return { content: fs.readFileSync(artifact.path, 'utf8'), path: artifact.path };
    } catch (e: any) {
      logger.warn('[Backlog] failed to read artifact file:', e?.message ?? e);
      return { content: artifact.preview, path: artifact.path, truncated: true };
    }
  });
}

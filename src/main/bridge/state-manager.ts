import { ToolId, ToolStatus, AgentState, NormalizedEvent } from '../../common/types';
import { app, BrowserWindow } from 'electron';
import { logger } from '../../common/logger';

export type EventStreamListener = (event: NormalizedEvent) => void;

export class StatusStateManager {
  private statuses: Map<ToolId, ToolStatus> = new Map();
  private eventListeners: Set<EventStreamListener> = new Set();

  public updateStatus(toolId: ToolId, state: AgentState, details: any) {
    const current = this.statuses.get(toolId);
    const timestamp = Date.now();
    logger.debug(`[StateManager] updateStatus called: toolId=${toolId} state=${state}`);

    const updatedStatus: ToolStatus = {
      toolId,
      state,
      lastUpdated: timestamp,
      activeAgents: details.activeAgents || (current?.activeAgents || 0),
      currentTask: details.taskSummary,
    };

    this.statuses.set(toolId, updatedStatus);
    this.broadcastStatus(updatedStatus);

    // Event-stream subscribers (timeline persistence, transcript reader, etc.)
    // run in setImmediate so their work never blocks the HTTP response in the
    // bridge handler — the bridge already responded before this returns.
    const eventPayload: NormalizedEvent = {
      toolId,
      state,
      timestamp,
      payload: {
        sessionId:      details.sessionId,
        taskSummary:    details.taskSummary,
        activeAgents:   details.activeAgents,
        errorMessage:   details.errorMessage,
        cwd:            details.cwd,
        agentPid:       details.agentPid,
        transcriptPath: details.transcriptPath,
        model:          details.model,
      },
    };
    setImmediate(() => {
      for (const listener of this.eventListeners) {
        try { listener(eventPayload); }
        catch (e) { logger.warn('[StateManager] event listener threw:', e); }
      }
    });
  }

  public onEvent(listener: EventStreamListener): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  public getStatus(toolId: ToolId) {
    return this.statuses.get(toolId);
  }

  public getAllStatuses() {
    return Array.from(this.statuses.values());
  }

  private broadcastStatus(status: ToolStatus) {
    try {
      const { BrowserWindow } = require('electron');
      if (BrowserWindow && BrowserWindow.getAllWindows) {
        const windows = BrowserWindow.getAllWindows();
        logger.debug(`[StateManager] Broadcasting status-update to ${windows.length} window(s):`, JSON.stringify(status));
        windows.forEach((win: any, idx: number) => {
          const webContentsDestroyed = win.webContents?.isDestroyed?.() ?? true;
          const url = webContentsDestroyed ? '<webContents destroyed>' : win.webContents.getURL();
          const bounds = win.isDestroyed() ? null : win.getBounds();
          logger.debug(
            `[StateManager]   -> window[${idx}] id=${win.id} title="${win.getTitle()}" visible=${win.isVisible()} minimized=${win.isMinimized()} destroyed=${win.isDestroyed()} webContentsDestroyed=${webContentsDestroyed} bounds=${JSON.stringify(bounds)} url="${url}"`,
          );
          if (!win.isDestroyed()) {
            win.webContents.send('status-update', status);
          }
        });
      } else {
        logger.warn('[StateManager] BrowserWindow.getAllWindows not available');
      }
    } catch (e) {
      logger.error('[StateManager] broadcastStatus error:', e);
    }
  }
}

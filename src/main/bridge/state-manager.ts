import { ToolId, ToolStatus, AgentState } from '../../common/types';
import { app, BrowserWindow } from 'electron';
import { logger } from '../../common/logger';

export class StatusStateManager {
  private statuses: Map<ToolId, ToolStatus> = new Map();

  public updateStatus(toolId: ToolId, state: AgentState, details: any) {
    const current = this.statuses.get(toolId);
    logger.debug(`[StateManager] updateStatus called: toolId=${toolId} state=${state}`);

    const updatedStatus: ToolStatus = {
      toolId,
      state,
      lastUpdated: Date.now(),
      activeAgents: details.activeAgents || (current?.activeAgents || 0),
      currentTask: details.taskSummary,
    };

    this.statuses.set(toolId, updatedStatus);
    this.broadcastStatus(updatedStatus);
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

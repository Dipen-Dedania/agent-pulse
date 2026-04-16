import { ToolId, ToolStatus, AgentState } from '../../common/types';
import { app, BrowserWindow } from 'electron';

export class StatusStateManager {
  private statuses: Map<ToolId, ToolStatus> = new Map();

  public updateStatus(toolId: ToolId, state: AgentState, details: any) {
    const current = this.statuses.get(toolId);
    console.log(`[StateManager] updateStatus called: toolId=${toolId} state=${state}`);

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
        console.log(`[StateManager] Broadcasting status-update to ${windows.length} window(s):`, JSON.stringify(status));
        windows.forEach((win: any, idx: number) => {
          console.log(`[StateManager]   -> window[${idx}] title="${win.getTitle()}" destroyed=${win.isDestroyed()}`);
          if (!win.isDestroyed()) {
            win.webContents.send('status-update', status);
          }
        });
      } else {
        console.warn('[StateManager] BrowserWindow.getAllWindows not available');
      }
    } catch (e) {
      console.error('[StateManager] broadcastStatus error:', e);
    }
  }
}

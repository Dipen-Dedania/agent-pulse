import { ToolId, ToolStatus, AgentState } from '../../common/types';
import { app, BrowserWindow } from 'electron';

export class StatusStateManager {
  private statuses: Map<ToolId, ToolStatus> = new Map();

  public updateStatus(toolId: ToolId, state: AgentState, details: any) {
    const current = this.statuses.get(toolId);

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
        BrowserWindow.getAllWindows().forEach((win: any) => {
          win.webContents.send('status-update', status);
        });
      }
    } catch (e) {
      // Silently fail if Electron is not initialized (e.g. during standalone bridge tests)
    }
  }
}

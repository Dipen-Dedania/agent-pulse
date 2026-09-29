import { ToolId, ToolStatus, AgentState, NormalizedEvent } from '../../common/types';
import { app, BrowserWindow } from 'electron';
import { logger } from '../../common/logger';

export type EventStreamListener = (event: NormalizedEvent) => void;

export class StatusStateManager {
  private statuses: Map<ToolId, ToolStatus> = new Map();
  private eventListeners: Set<EventStreamListener> = new Set();
  // Subagent depth per tool, driven by agentDelta/agentReset hints in the
  // normalized payload (Claude Code SubagentStart/Stop). Keyed alongside the
  // sessionId that produced it so a new session never inherits a stale count.
  private agentDepth: Map<ToolId, { sessionId?: string; depth: number }> = new Map();

  public updateStatus(toolId: ToolId, state: AgentState, details: any) {
    const current = this.statuses.get(toolId);
    const timestamp = Date.now();
    logger.debug(`[StateManager] updateStatus called: toolId=${toolId} state=${state}`);

    let resolvedState = state;
    let depthAgents: number | undefined;
    if (details.agentDelta !== undefined || details.agentReset) {
      const tracked = this.agentDepth.get(toolId);
      let depth = tracked && tracked.sessionId === details.sessionId ? tracked.depth : 0;
      if (details.agentReset) depth = 0;
      if (typeof details.agentDelta === 'number') depth = Math.max(0, depth + details.agentDelta);
      this.agentDepth.set(toolId, { sessionId: details.sessionId, depth });
      depthAgents = depth;
      // A finishing subagent only moves the counter — background subagents can
      // outlive the main turn's Stop, and letting SubagentStop's nominal
      // "working" through would revive an idle bubble.
      if (details.agentDelta === -1 && current) resolvedState = current.state;
    }

    const updatedStatus: ToolStatus = {
      toolId,
      state: resolvedState,
      lastUpdated: timestamp,
      activeAgents: details.activeAgents || (depthAgents !== undefined ? depthAgents : (current?.activeAgents || 0)),
      currentTask: details.taskSummary,
      // Latch the most recent agentPid + chain; preserve the previous ones
      // if this event didn't carry them (e.g. Notification events lack
      // process info, but we still want to focus on click).
      agentPid: typeof details.agentPid === 'number' ? details.agentPid : current?.agentPid,
      agentPidChain: Array.isArray(details.agentPidChain) && details.agentPidChain.length > 0
        ? details.agentPidChain
        : current?.agentPidChain,
    };

    this.statuses.set(toolId, updatedStatus);
    this.broadcastStatus(updatedStatus);

    // Event-stream subscribers (timeline persistence, transcript reader, etc.)
    // run in setImmediate so their work never blocks the HTTP response in the
    // bridge handler — the bridge already responded before this returns.
    const eventPayload: NormalizedEvent = {
      toolId,
      state: resolvedState,
      timestamp,
      payload: {
        sessionId:      details.sessionId,
        taskSummary:    details.taskSummary,
        activeAgents:   details.activeAgents ?? depthAgents,
        errorMessage:   details.errorMessage,
        cwd:            details.cwd,
        agentPid:       details.agentPid,
        transcriptPath: details.transcriptPath,
        model:          details.model,
        // Inline token deltas (OpenCode's plugin) must survive this rebuild —
        // the timeline stages them off event.payload.tokens.
        tokens:         details.tokens,
      },
    };
    setImmediate(() => {
      for (const listener of this.eventListeners) {
        try { listener(eventPayload); }
        catch (e) { logger.warn('[StateManager] event listener threw:', e); }
      }
    });
  }

  // Seed a last-known agent PID recovered from the timeline DB at startup so
  // a bubble click can PID-target the hosting window before the first hook
  // event of this app run (the statuses map starts empty after a restart).
  // Never overwrites live data and doesn't broadcast — it's a focus hint,
  // not a state change; updateStatus latches over it once real events arrive.
  public seedAgentPid(toolId: ToolId, agentPid: number, lastUpdated: number) {
    if (this.statuses.has(toolId)) return;
    this.statuses.set(toolId, {
      toolId,
      state: 'idle',
      lastUpdated,
      activeAgents: 0,
      agentPid,
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

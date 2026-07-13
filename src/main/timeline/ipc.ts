import { ipcMain } from 'electron';
import { TimelineQueries } from './queries';
import {
  HeatmapRange,
  HourRhythmRange,
  TimelineRange,
  ToolMixRange,
  ModelUsageRange,
  ModelUsageMode,
  ProjectBreakdownRange,
  TokensTimelineRange,
  GuardrailsAnalyticsRange,
} from '../../common/timeline-types';
import { logger } from '../../common/logger';

export interface TimelineStatus {
  available: boolean;
  reason?: string;
}

let currentStatus: TimelineStatus = { available: false, reason: 'Timeline not initialized' };

/**
 * Register all analytics handlers up-front. They always exist — when the
 * timeline isn't available (better-sqlite3 missing / ABI mismatch / migration
 * failed), they return null so the renderer can render its empty state
 * cleanly instead of throwing "No handler registered" errors.
 *
 * Pass a non-null `queries` once the timeline is up; pass null to mark it
 * unavailable.
 */
export function registerTimelineIpc(queries: TimelineQueries | null) {
  if (queries) {
    currentStatus = { available: true };
  }

  ipcMain.handle('analytics:get-status', (): TimelineStatus => currentStatus);

  ipcMain.handle('analytics:get-digest', () => {
    if (!queries) return null;
    try { return queries.getDigest(); }
    catch (e) { logger.warn('[Timeline/ipc] get-digest:', e); return null; }
  });

  ipcMain.handle('analytics:get-summary', (_e, args: { range: TimelineRange }) => {
    if (!queries) return null;
    try { return queries.getSummary(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-summary:', e); return null; }
  });

  ipcMain.handle('analytics:get-heatmap', (_e, args: { range: HeatmapRange; groupBy: 'tool' | 'project' | 'all' }) => {
    if (!queries) return null;
    try { return queries.getHeatmap(args.range, args.groupBy); }
    catch (e) { logger.warn('[Timeline/ipc] get-heatmap:', e); return null; }
  });

  ipcMain.handle('analytics:get-hour-rhythm', (_e, args: { range: HourRhythmRange }) => {
    if (!queries) return null;
    try { return queries.getHourRhythm(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-hour-rhythm:', e); return null; }
  });

  ipcMain.handle('analytics:get-tool-mix', (_e, args: { range: ToolMixRange }) => {
    if (!queries) return null;
    try { return queries.getToolMix(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-tool-mix:', e); return null; }
  });

  ipcMain.handle('analytics:get-model-usage', (_e, args: { range: ModelUsageRange; mode: ModelUsageMode }) => {
    if (!queries) return null;
    try { return queries.getModelUsage(args.range, args.mode); }
    catch (e) { logger.warn('[Timeline/ipc] get-model-usage:', e); return null; }
  });

  ipcMain.handle('analytics:get-window-value', () => {
    if (!queries) return null;
    try { return queries.getWindowValue(); }
    catch (e) { logger.warn('[Timeline/ipc] get-window-value:', e); return null; }
  });

  ipcMain.handle('analytics:get-project-breakdown', (_e, args: { range: ProjectBreakdownRange }) => {
    if (!queries) return null;
    try { return queries.getProjectBreakdown(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-project-breakdown:', e); return null; }
  });

  ipcMain.handle('analytics:get-tokens-timeline', (_e, args: { range: TokensTimelineRange }) => {
    if (!queries) return null;
    try { return queries.getTokensTimeline(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-tokens-timeline:', e); return null; }
  });

  ipcMain.handle('analytics:get-guardrails', (_e, args: { range: GuardrailsAnalyticsRange }) => {
    if (!queries) return null;
    try { return queries.getGuardrails(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-guardrails:', e); return null; }
  });

  ipcMain.handle('analytics:get-secret-access', (_e, args: { range: GuardrailsAnalyticsRange }) => {
    if (!queries) return null;
    try { return queries.getSecretAccess(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-secret-access:', e); return null; }
  });
}

/** Called by bootTimeline when the timeline cannot start. */
export function registerTimelineIpcUnavailable(reason: string) {
  currentStatus = { available: false, reason };
  registerTimelineIpc(null);
}

export function unregisterTimelineIpc() {
  for (const channel of [
    'analytics:get-status',
    'analytics:get-digest',
    'analytics:get-heatmap',
    'analytics:get-hour-rhythm',
    'analytics:get-tool-mix',
    'analytics:get-model-usage',
    'analytics:get-window-value',
    'analytics:get-project-breakdown',
    'analytics:get-tokens-timeline',
    'analytics:get-guardrails',
    'analytics:get-secret-access',
  ]) {
    ipcMain.removeHandler(channel);
  }
}

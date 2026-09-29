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
  CadenceRange,
  WaitingRange,
  CacheEfficiencyRange,
  LifecycleRange,
  LimitHitsRange,
  CacheHealthRange,
  ContextPressureRange,
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

  ipcMain.handle('analytics:get-cadence', (_e, args: { range: CadenceRange }) => {
    if (!queries) return null;
    try { return queries.getCadence(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-cadence:', e); return null; }
  });

  ipcMain.handle('analytics:get-waiting', (_e, args: { range: WaitingRange }) => {
    if (!queries) return null;
    try { return queries.getWaiting(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-waiting:', e); return null; }
  });

  ipcMain.handle('analytics:get-cache-efficiency', (_e, args: { range: CacheEfficiencyRange }) => {
    if (!queries) return null;
    try { return queries.getCacheEfficiency(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-cache-efficiency:', e); return null; }
  });

  ipcMain.handle('analytics:get-lifecycle', (_e, args: { range: LifecycleRange }) => {
    if (!queries) return null;
    try { return queries.getLifecycle(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-lifecycle:', e); return null; }
  });

  ipcMain.handle('analytics:get-limit-hits', (_e, args: { range: LimitHitsRange }) => {
    if (!queries) return null;
    try { return queries.getLimitHits(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-limit-hits:', e); return null; }
  });

  ipcMain.handle('analytics:get-cache-health', (_e, args: { range: CacheHealthRange }) => {
    if (!queries) return null;
    try { return queries.getCacheHealth(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-cache-health:', e); return null; }
  });

  ipcMain.handle('analytics:get-context-pressure', (_e, args: { range: ContextPressureRange }) => {
    if (!queries) return null;
    try { return queries.getContextPressure(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-context-pressure:', e); return null; }
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
    'analytics:get-cadence',
    'analytics:get-waiting',
    'analytics:get-cache-efficiency',
    'analytics:get-lifecycle',
    'analytics:get-limit-hits',
    'analytics:get-cache-health',
    'analytics:get-context-pressure',
  ]) {
    ipcMain.removeHandler(channel);
  }
}

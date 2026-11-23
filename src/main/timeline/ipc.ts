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
  ActionMixRange,
  ActivityRange,
  CraftCoachingResult,
} from '../../common/timeline-types';
import { logger } from '../../common/logger';
import { loadConfig } from '../user-config';
import { runCoaching } from './coaching';
import type { CommandHistorySync } from './command-sync';

export interface TimelineStatus {
  available: boolean;
  reason?: string;
}

let currentStatus: TimelineStatus = { available: false, reason: 'Timeline not initialized' };

// The last successful coaching answer per range, so re-opening the tab shows
// it (with its age) instead of paying for another run. The numbers move with
// every event while the user works, so the key is the range alone; a re-run is
// an explicit `force`. A failure is not kept and can be retried immediately.
const coachingCache = new Map<string, CraftCoachingResult>();
const coachingInFlight = new Map<string, Promise<CraftCoachingResult>>();

/**
 * Register all analytics handlers up-front. They always exist — when the
 * timeline isn't available (better-sqlite3 missing / ABI mismatch / migration
 * failed), they return null so the renderer can render its empty state
 * cleanly instead of throwing "No handler registered" errors.
 *
 * Pass a non-null `queries` once the timeline is up; pass null to mark it
 * unavailable.
 */
export function registerTimelineIpc(queries: TimelineQueries | null, commandSync: CommandHistorySync | null = null) {
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

  ipcMain.handle('analytics:get-lifetime-tokens', () => {
    if (!queries) return null;
    try { return queries.getLifetimeTokens(); }
    catch (e) { logger.warn('[Timeline/ipc] get-lifetime-tokens:', e); return null; }
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

  ipcMain.handle('analytics:get-action-mix', (_e, args: { range: ActionMixRange }) => {
    if (!queries) return null;
    try { return queries.getActionMix(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-action-mix:', e); return null; }
  });

  ipcMain.handle('analytics:get-prompt-size', (_e, args: { range: ActivityRange }) => {
    if (!queries) return null;
    try { return queries.getPromptSize(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-prompt-size:', e); return null; }
  });

  ipcMain.handle('analytics:get-lines-changed', (_e, args: { range: ActivityRange }) => {
    if (!queries) return null;
    try { return queries.getLinesChanged(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-lines-changed:', e); return null; }
  });

  ipcMain.handle('analytics:get-subagent-use', (_e, args: { range: ActivityRange }) => {
    if (!queries) return null;
    try { return queries.getSubagentUse(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-subagent-use:', e); return null; }
  });

  ipcMain.handle('analytics:get-compactions', (_e, args: { range: ActivityRange }) => {
    if (!queries) return null;
    try { return queries.getCompactions(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-compactions:', e); return null; }
  });

  // Claude Code only. Reads the prompt history first, so a card that has just
  // mounted shows the commands typed a moment ago.
  ipcMain.handle('analytics:get-claude-commands', (_e, args: { range: ActivityRange }) => {
    if (!queries) return null;
    try {
      const sync = commandSync?.sync();
      return queries.getClaudeCommands(args.range, {
        discovered: commandSync?.discoveredCommands(),
        available: sync?.available ?? false,
      });
    } catch (e) { logger.warn('[Timeline/ipc] get-claude-commands:', e); return null; }
  });

  ipcMain.handle('analytics:get-craft', (_e, args: { range: TimelineRange }) => {
    if (!queries) return null;
    try { return queries.getCraft(args.range); }
    catch (e) { logger.warn('[Timeline/ipc] get-craft:', e); return null; }
  });

  // Explicit, user-triggered only. Recomputes the metrics here rather than
  // trusting renderer input, so the prompt can only ever carry these numbers.
  // `peek` returns the cached answer (or null) without starting a run.
  ipcMain.handle('analytics:get-coaching', async (
    _e,
    args: { range: TimelineRange; force?: boolean; peek?: boolean },
  ): Promise<CraftCoachingResult | null> => {
    if (!queries) return null;
    try {
      const key = args.range;
      const cached = coachingCache.get(key);
      if (args.peek) return cached ?? null;
      if (cached && !args.force) return cached;
      const pending = coachingInFlight.get(key);
      if (pending) return await pending;

      const payload = queries.getCraft(args.range);
      const model = loadConfig().backlogPopulation.scoutModel;
      const run = runCoaching(payload, model).finally(() => coachingInFlight.delete(key));
      coachingInFlight.set(key, run);
      const result = await run;
      if (result.ok) coachingCache.set(key, result);
      return result;
    } catch (e) {
      logger.warn('[Timeline/ipc] get-coaching:', e);
      return { ok: false, tips: [], reason: 'Coaching failed unexpectedly. See the app log.', costUsd: null, generatedAt: Date.now() };
    }
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
    'analytics:get-summary',
    'analytics:get-lifetime-tokens',
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
    'analytics:get-action-mix',
    'analytics:get-prompt-size',
    'analytics:get-lines-changed',
    'analytics:get-subagent-use',
    'analytics:get-compactions',
    'analytics:get-claude-commands',
    'analytics:get-craft',
    'analytics:get-coaching',
  ]) {
    ipcMain.removeHandler(channel);
  }
}

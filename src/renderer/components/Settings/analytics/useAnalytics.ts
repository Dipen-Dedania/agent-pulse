import { useEffect, useRef, useState, useCallback, useSyncExternalStore } from 'react';
import {
  DigestPayload,
  HeatmapPayload,
  HeatmapRange,
  HourRhythmPayload,
  HourRhythmRange,
  ToolMixPayload,
  ToolMixRange,
  ModelUsagePayload,
  ModelUsageRange,
  ModelUsageMode,
  ProjectBreakdownPayload,
  ProjectBreakdownRange,
  TokensTimelinePayload,
  TokensTimelineRange,
  GuardrailsAnalyticsPayload,
  GuardrailsAnalyticsRange,
  SecretAccessAnalyticsPayload,
  WindowValuePayload,
  AnalyticsSummaryPayload,
  TimelineRange,
} from '../../../../common/timeline-types';

const TTL_MS = 30_000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

// Freshness + manual refresh. `lastFetchedAt` tracks the newest real IPC
// round-trip (not cache hits); bumping `reloadVersion` makes every mounted
// query re-run, so a refresh reaches all cards at once.
let lastFetchedAt: number | null = null;
let reloadVersion = 0;
const reloadListeners = new Set<() => void>();

function notifyReload() {
  for (const l of reloadListeners) l();
}

function useReloadVersion(): number {
  return useSyncExternalStore(
    (cb) => { reloadListeners.add(cb); return () => reloadListeners.delete(cb); },
    () => reloadVersion,
  );
}

async function fetchAnalytics<T>(channel: string, args?: object): Promise<T | null> {
  const key = channel + JSON.stringify(args ?? {});
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) {
    return cached.data as T;
  }
  try {
    const result = await window.electron.invoke(channel, args);
    if (result == null) return null;
    cache.set(key, { data: result, fetchedAt: Date.now() });
    lastFetchedAt = Date.now();
    return result as T;
  } catch {
    return null;
  }
}

export function bustCache() {
  cache.clear();
}

// Drop the cache and make every mounted card refetch immediately.
export function refreshAnalytics() {
  cache.clear();
  reloadVersion++;
  notifyReload();
}

// Timestamp of the newest fetch, re-evaluated on refresh and every 10s so a
// "updated Ns ago" label stays roughly current without per-second churn.
export function useAnalyticsFreshness(): number | null {
  useReloadVersion();
  const [, bump] = useState(0);
  useEffect(() => {
    const t = setInterval(() => bump((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);
  return lastFetchedAt;
}

function useAnalyticsQuery<T>(
  channel: string,
  args: object | undefined,
  argsKey: string,
): { data: T | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const versionRef = useRef(0);

  const reload = useReloadVersion();

  const load = useCallback(() => {
    setLoading(true);
    const v = ++versionRef.current;
    fetchAnalytics<T>(channel, args).then((result) => {
      if (versionRef.current !== v) return;
      setData(result);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, argsKey, reload]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refresh: load };
}

export function useDigest() {
  return useAnalyticsQuery<DigestPayload>('analytics:get-digest', undefined, '');
}

export function useSummary(range: TimelineRange) {
  return useAnalyticsQuery<AnalyticsSummaryPayload>('analytics:get-summary', { range }, range);
}

export function useHeatmap(range: HeatmapRange, groupBy: 'tool' | 'project' | 'all') {
  return useAnalyticsQuery<HeatmapPayload>('analytics:get-heatmap', { range, groupBy }, `${range}/${groupBy}`);
}

export function useHourRhythm(range: HourRhythmRange) {
  return useAnalyticsQuery<HourRhythmPayload>('analytics:get-hour-rhythm', { range }, range);
}

export function useToolMix(range: ToolMixRange) {
  return useAnalyticsQuery<ToolMixPayload>('analytics:get-tool-mix', { range }, range);
}

export function useModelUsage(range: ModelUsageRange, mode: ModelUsageMode) {
  return useAnalyticsQuery<ModelUsagePayload>('analytics:get-model-usage', { range, mode }, `${range}/${mode}`);
}

export function useWindowValue() {
  return useAnalyticsQuery<WindowValuePayload>('analytics:get-window-value', undefined, '');
}

export function useProjectBreakdown(range: ProjectBreakdownRange) {
  return useAnalyticsQuery<ProjectBreakdownPayload>('analytics:get-project-breakdown', { range }, range);
}

export function useTokensTimeline(range: TokensTimelineRange) {
  return useAnalyticsQuery<TokensTimelinePayload>('analytics:get-tokens-timeline', { range }, range);
}

export function useGuardrailsAnalytics(range: GuardrailsAnalyticsRange) {
  return useAnalyticsQuery<GuardrailsAnalyticsPayload>('analytics:get-guardrails', { range }, range);
}

export function useSecretAccessAnalytics(range: GuardrailsAnalyticsRange) {
  return useAnalyticsQuery<SecretAccessAnalyticsPayload>('analytics:get-secret-access', { range }, range);
}

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  DigestPayload,
  HeatmapPayload,
  HeatmapRange,
  HourRhythmPayload,
  ToolMixPayload,
  ToolMixRange,
  ModelUsagePayload,
  ModelUsageRange,
  ProjectBreakdownPayload,
  ProjectBreakdownRange,
  TokensTimelinePayload,
  TokensTimelineRange,
} from '../../../../common/timeline-types';

const TTL_MS = 30_000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

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
    return result as T;
  } catch {
    return null;
  }
}

export function bustCache() {
  cache.clear();
}

function useAnalyticsQuery<T>(
  channel: string,
  args: object | undefined,
  argsKey: string,
): { data: T | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const versionRef = useRef(0);

  const load = useCallback(() => {
    setLoading(true);
    const v = ++versionRef.current;
    fetchAnalytics<T>(channel, args).then((result) => {
      if (versionRef.current !== v) return;
      setData(result);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, argsKey]);

  useEffect(() => { load(); }, [load]);

  return { data, loading, refresh: load };
}

export function useDigest() {
  return useAnalyticsQuery<DigestPayload>('analytics:get-digest', undefined, '');
}

export function useHeatmap(range: HeatmapRange, groupBy: 'tool' | 'project' | 'all') {
  return useAnalyticsQuery<HeatmapPayload>('analytics:get-heatmap', { range, groupBy }, `${range}/${groupBy}`);
}

export function useHourRhythm(range: '7d' | '30d') {
  return useAnalyticsQuery<HourRhythmPayload>('analytics:get-hour-rhythm', { range }, range);
}

export function useToolMix(range: ToolMixRange) {
  return useAnalyticsQuery<ToolMixPayload>('analytics:get-tool-mix', { range }, range);
}

export function useModelUsage(range: ModelUsageRange, mode: 'tokens' | 'sessions') {
  return useAnalyticsQuery<ModelUsagePayload>('analytics:get-model-usage', { range, mode }, `${range}/${mode}`);
}

export function useProjectBreakdown(range: ProjectBreakdownRange) {
  return useAnalyticsQuery<ProjectBreakdownPayload>('analytics:get-project-breakdown', { range }, range);
}

export function useTokensTimeline(range: TokensTimelineRange) {
  return useAnalyticsQuery<TokensTimelinePayload>('analytics:get-tokens-timeline', { range }, range);
}

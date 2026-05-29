import { ToolId } from './types';

export type TimelineRange = '7d' | '30d' | '90d';
export type HeatmapRange = '30d' | '90d';
export type ToolMixRange = '7d' | '30d';
export type ModelUsageRange = '7d' | '30d';
export type ProjectBreakdownRange = '7d' | '30d' | '90d';
export type TokensTimelineRange = '7d' | '30d' | '90d';

export interface ToolBreakdown {
  toolId: ToolId;
  activeMs: number;
  sessions: number;
  longestSessionMs: number;
  topTask: string | null;
}

export interface TokenTotals {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface QuotaDelta {
  toolId: ToolId;
  windowKey: string;
  startPct: number | null;
  endPct: number | null;
  deltaPct: number | null;
}

export interface DailyDigest {
  date: string;            // YYYY-MM-DD (local)
  totalActiveMs: number;
  perTool: ToolBreakdown[];
  tokens: TokenTotals | null;
  quota: QuotaDelta[];
}

export interface DigestPayload {
  today: DailyDigest;
  yesterday: DailyDigest;
  queriedAt: number;
}

export interface HeatmapCell {
  date: string;            // YYYY-MM-DD
  activeMs: number;
  sessions: number;
}

export interface HeatmapSeries {
  key: string;             // toolId / projectId / 'all'
  displayName: string;
  cells: HeatmapCell[];
}

export interface HeatmapPayload {
  range: HeatmapRange;
  groupBy: 'tool' | 'project' | 'all';
  series: HeatmapSeries[];
  queriedAt: number;
}

export interface HourRhythmPayload {
  range: '7d' | '30d';
  buckets: number[];       // length 24
  queriedAt: number;
}

export interface ToolMixSlice {
  toolId: ToolId;
  activeMs: number;
  pct: number;
}

export interface ToolMixPayload {
  range: ToolMixRange;
  slices: ToolMixSlice[];
  totalActiveMs: number;
  queriedAt: number;
}

export interface ModelUsageRow {
  model: string;
  toolId: ToolId | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  sessions: number;
}

export interface ModelUsagePayload {
  range: ModelUsageRange;
  mode: 'tokens' | 'sessions';
  rows: ModelUsageRow[];
  totalTokens: number;
  totalSessions: number;
  queriedAt: number;
}

export interface ProjectBreakdownRow {
  projectId: string;
  projectPath: string;
  displayName: string;
  activeMs: number;
  sessions: number;
  tools: ToolId[];
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
}

export interface TokensTimelineBucket {
  date: string;            // YYYY-MM-DD (local)
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
}

export interface TokensTimelinePayload {
  range: TokensTimelineRange;
  buckets: TokensTimelineBucket[];
  maxFresh: number;        // max(tokensIn + tokensOut) across buckets
  maxCacheRead: number;
  totalFresh: number;
  totalCacheRead: number;
  queriedAt: number;
}

export interface ProjectBreakdownPayload {
  range: ProjectBreakdownRow extends never ? never : ProjectBreakdownRange;
  rows: ProjectBreakdownRow[];
  queriedAt: number;
}

export interface AnalyticsConfig {
  redactTaskText: boolean;
  idleGapMinutes: number;
}

export type GuardrailsAnalyticsRange = '7d' | '30d';

export interface GuardrailToolCount {
  toolId: ToolId;
  total: number;
  warn: number;
  block: number;
}

export interface GuardrailRuleCount {
  ruleId: string;
  message: string;
  count: number;
}

export interface GuardrailsAnalyticsPayload {
  range: GuardrailsAnalyticsRange;
  total: number;
  warn: number;
  block: number;
  byTool: GuardrailToolCount[];
  byRule: GuardrailRuleCount[];
  queriedAt: number;
}

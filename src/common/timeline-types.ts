import { ToolId } from './types';
import { CostBreakdown } from './pricing';

export type TimelineRange = '7d' | '30d' | '90d';
export type HeatmapRange = '30d' | '90d';
export type ToolMixRange = '7d' | '30d';
export type ModelUsageRange = '7d' | '30d';
export type ModelUsageMode = 'tokens' | 'sessions' | 'cost';
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
  // Estimated USD at API list prices (see common/pricing.ts). 0 when none of
  // the contributing models could be priced.
  costUsd: number;
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
  pct: number;              // share of total active time
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;          // estimated API-equivalent spend
  costPct: number;          // share of total estimated spend
  // True when this tool reported any token data in the window. Lets the UI
  // distinguish "genuinely $0" from "this tool doesn't expose tokens" (Cursor,
  // Copilot, Kiro), which should read as "no token data", not "free".
  hasTokenData: boolean;
}

export interface ToolMixPayload {
  range: ToolMixRange;
  slices: ToolMixSlice[];
  totalActiveMs: number;
  totalCostUsd: number;
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
  costUsd: number;          // estimated API-equivalent spend
  priced: boolean;          // false when the model isn't in the price table
}

export interface ModelUsagePayload {
  range: ModelUsageRange;
  mode: ModelUsageMode;
  rows: ModelUsageRow[];
  totalTokens: number;
  totalSessions: number;
  totalCostUsd: number;
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
  costUsd: number;          // estimated API-equivalent spend
  priced: boolean;
}

export interface TokensTimelineBucket {
  date: string;            // YYYY-MM-DD (local)
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  costUsd: number;         // estimated spend for the day
}

export interface TokensTimelinePayload {
  range: TokensTimelineRange;
  buckets: TokensTimelineBucket[];
  maxFresh: number;        // max(tokensIn + tokensOut) across buckets
  maxCacheRead: number;
  maxCost: number;         // max(costUsd) across buckets
  totalFresh: number;
  totalCacheRead: number;
  totalCostUsd: number;
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

// ─── Claude usage-window value ────────────────────────────────────────────────
// Estimated API-equivalent spend for Claude Code over the trailing usage
// windows, so users can see how much of their flat-rate plan they're actually
// extracting. Labelled "last 5h / last 7d" (trailing) rather than claiming to
// mirror Anthropic's exact rolling reset, which we can't reconstruct from the
// quota poller alone.

export interface WindowValueSlice {
  windowKey: '5h' | '7d';
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  sessions: number;
  // Dollar cost split per token class (sums to costUsd). Lets the UI show the
  // breakdown behind the total, including the discounted cache contributions.
  costBreakdown: CostBreakdown;
}

export interface WindowValuePayload {
  toolId: ToolId;                 // always 'claude-code' today
  last5h: WindowValueSlice;
  last7d: WindowValueSlice;
  burnRateUsdPerHour: number;     // spend over the last 60 minutes
  projected5hUsd: number;         // burnRate × 5, "if the current pace holds"
  queriedAt: number;
}

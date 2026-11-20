import { ToolId } from './types';
import { CostBreakdown } from './pricing';
import { ActionCategory } from './action-mix';

export type TimelineRange = '7d' | '30d' | '90d' | '1y';
export type HeatmapRange = TimelineRange;
export type HourRhythmRange = TimelineRange;
export type ToolMixRange = TimelineRange;
export type ModelUsageRange = TimelineRange;
export type ModelUsageMode = 'tokens' | 'sessions' | 'cost';
export type ProjectBreakdownRange = TimelineRange;
export type TokensTimelineRange = TimelineRange;

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
  range: HourRhythmRange;
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

// ─── Tab-level summary (KPI hero row) ────────────────────────────────────────
// Aggregates for the selected range plus the immediately preceding period of
// equal length, so the UI can show period-over-period deltas.

export interface SummarySlice {
  activeMs: number;
  sessions: number;
  costUsd: number;                // estimated API-equivalent spend (0 if unpriced)
  topProject: { displayName: string; activeMs: number } | null;
}

export interface AnalyticsSummaryPayload {
  range: TimelineRange;
  current: SummarySlice;
  previous: SummarySlice;
  queriedAt: number;
}

// ─── Lifetime tokens (top-of-tab hero) ───────────────────────────────────────
// Every token Agent Pulse has ever recorded, independent of the range filter.
// Backed by the `sessions` rollup, which is never pruned.

export interface LifetimeTokensPayload {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;            // sum of the four classes above
  costUsd: number;                // estimated API-equivalent spend (0 if unpriced)
  sessions: number;
  firstSessionAt: number | null;  // epoch ms of the oldest recorded session
  queriedAt: number;
}

export interface AnalyticsConfig {
  redactTaskText: boolean;
  idleGapMinutes: number;
}

export type GuardrailsAnalyticsRange = TimelineRange;

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

// Secret Protection analytics — same shape family as guardrails (both are
// warn/block event streams), plus the files most often read since "which file
// keeps getting touched" is the question this card answers.
export interface SecretAccessFileCount {
  filePath: string;
  count: number;
}

export interface SecretAccessAnalyticsPayload {
  range: GuardrailsAnalyticsRange;
  total: number;
  warn: number;
  block: number;
  byTool: GuardrailToolCount[];
  byRule: GuardrailRuleCount[];
  byFile: SecretAccessFileCount[];
  queriedAt: number;
}

// ─── Session-limit hits ──────────────────────────────────────────────────────
// How often Claude Code (or another agent) told the user they'd hit a usage
// limit. Detected from the transcript's locally-generated "<synthetic>" notices
// ("You've hit your session limit · resets …"), so it reflects real interruptions
// rather than estimated quota.
export type LimitHitsRange = TimelineRange;

// Which limit was hit. "session" is the 5-hour window; "weekly" the 7-day one;
// "usage" a generic usage-limit phrasing; "other" anything matching the limit
// pattern we couldn't classify.
export type LimitHitKind = 'session' | 'weekly' | 'usage' | 'other';

export interface LimitHitKindCount {
  kind: LimitHitKind;
  count: number;
}

export interface LimitHitDayBucket {
  date: string; // YYYY-MM-DD (local)
  count: number;
}

export interface LimitHitsPayload {
  range: LimitHitsRange;
  total: number;
  byKind: LimitHitKindCount[];
  byDay: LimitHitDayBucket[];
  // Most recent hit across ALL history (not just the window), so the card can
  // say "last hit 3 days ago" even when the window is empty. null if never.
  lastHitAt: number | null;
  queriedAt: number;
}

// ─── Statusline feed analytics (Claude Code) ─────────────────────────────────
// Backed by statusline_samples — throttled snapshots of what Claude Code feeds
// its statusline command (prompt-cache health, context-window pressure). Only
// Claude Code reports this today, so rows are per native session, not per tool.

export type CacheHealthRange = TimelineRange;
export type ContextPressureRange = TimelineRange;

export interface CacheHealthSessionRow {
  sessionId: string;
  title: string | null;      // Claude Code's session title (AI-generated or /rename)
  project: string | null;    // project folder name, when hooks reported one
  model: string | null;
  hitRatio: number | null;   // 0..1, from the session's latest sample
  warm: boolean | null;
  misses: number | null;     // cumulative per session (latest sample)
  lastSampledAt: number;
}

export interface CacheHealthDayBucket {
  date: string;              // YYYY-MM-DD (local)
  avgHitRatio: number | null;
  samples: number;
}

export interface CacheHealthPayload {
  range: CacheHealthRange;
  rows: CacheHealthSessionRow[];  // latest sample per session, most recent first
  avgHitRatio: number | null;     // across the latest-per-session rows
  warmPct: number | null;         // % of those rows currently warm
  totalMisses: number;            // sum of latest-per-session miss counters
  sessions: number;
  byDay: CacheHealthDayBucket[];
  queriedAt: number;
}

export interface ContextPressureSessionRow {
  sessionId: string;
  title: string | null;      // see CacheHealthSessionRow
  project: string | null;
  model: string | null;
  usedPct: number;           // 0..100, from the session's latest sample
  sampledAt: number;
}

export interface ContextPressureDayBucket {
  date: string;              // YYYY-MM-DD (local)
  avgUsedPct: number | null;
  maxUsedPct: number | null;
}

export interface ContextPressurePayload {
  range: ContextPressureRange;
  rows: ContextPressureSessionRow[]; // latest sample per session, most recent first
  avgUsedPct: number | null;
  maxUsedPct: number | null;
  highPressureSessions: number;      // latest sample ≥ 80% used
  byDay: ContextPressureDayBucket[];
  queriedAt: number;
}

// ─── Agent actions (tool-call mix) ───────────────────────────────────────────
// What agents spend their tool calls on, from the tool name each before-tool
// hook reports. One row in `events` per call (see common/action-mix.ts for the
// agents that report twice). Empty for periods recorded with task-text
// redaction on, since the tool name is stored in the redacted column.

export type ActionMixRange = TimelineRange;

export interface ActionMixCategoryCount {
  category: ActionCategory;
  calls: number;
  pct: number;               // share of the enclosing total, 0..100
}

export interface ActionMixToolCount {
  name: string;              // tool name as the agent reported it
  category: ActionCategory;
  calls: number;
}

export interface ActionMixAgentRow {
  toolId: ToolId;
  calls: number;
  categories: ActionMixCategoryCount[]; // non-zero only, in ACTION_CATEGORIES order
  topTools: ActionMixToolCount[];       // this agent's most-called tools
}

export interface ActionMixPayload {
  range: ActionMixRange;
  totalCalls: number;
  categories: ActionMixCategoryCount[]; // across all agents, non-zero only
  agents: ActionMixAgentRow[];          // most calls first
  queriedAt: number;
}

// ─── Activity facts (prompt size, lines changed, subagent use) ───────────────
// Backed by activity_facts — numeric facts read from Claude Code and Codex
// session files (main/timeline/activity-facts.ts). Only those two agents
// report today; other agents simply have no rows.

export type ActivityRange = TimelineRange;

export interface PromptSizeBucket {
  label: string;             // '1–10', '11–25', … '250+'
  count: number;
}

export interface PromptSizeAgentRow {
  toolId: ToolId;
  prompts: number;           // prompts with at least one word
  medianWords: number;
  avgWords: number;
}

export interface PromptSizePayload {
  range: ActivityRange;
  // Word stats cover prompts with at least one word; an image-only message has
  // none and is counted separately so it doesn't drag the averages down.
  prompts: number;
  imageOnlyPrompts: number;
  medianWords: number;
  avgWords: number;
  longestWords: number;
  buckets: PromptSizeBucket[];   // fixed order, zero counts included
  agents: PromptSizeAgentRow[];  // most prompts first
  queriedAt: number;
}

export interface LinesChangedAgentRow {
  toolId: ToolId;
  edits: number;
  added: number;
  removed: number;
}

export interface LinesChangedDayBucket {
  date: string;              // YYYY-MM-DD (local)
  added: number;
  removed: number;
}

export interface LinesChangedPayload {
  range: ActivityRange;
  edits: number;
  added: number;
  removed: number;
  agents: LinesChangedAgentRow[]; // most lines touched first
  byDay: LinesChangedDayBucket[];
  queriedAt: number;
}

export interface SubagentAgentRow {
  toolId: ToolId;
  launches: number;
  sessionsWithSubagents: number;
  sessions: number;          // sessions with any recorded activity, the denominator
  autoReviews: number;       // Codex guardian reviews — not user-launched, shown apart
}

export interface SubagentDayBucket {
  date: string;              // YYYY-MM-DD (local)
  launches: number;
}

export interface SubagentUsePayload {
  range: ActivityRange;
  launches: number;
  sessionsWithSubagents: number;
  sessions: number;
  autoReviews: number;
  agents: SubagentAgentRow[]; // every agent with activity, most launches first
  byDay: SubagentDayBucket[];
  queriedAt: number;
}

// Context compactions. Claude Code states each compaction's trigger and the
// context size around it; Codex states neither, so its trigger is inferred
// from the shape of the turn (see activity-facts.ts) and it has no size.
export interface CompactionsAgentRow {
  toolId: ToolId;
  auto: number;
  manual: number;
  unknown: number;
  sessionsCompacted: number;
  sessions: number;                  // sessions with any recorded activity
  medianTokensBefore: number | null; // null when the agent does not report it
}

export interface CompactionsDayBucket {
  date: string;              // YYYY-MM-DD (local)
  auto: number;
  manual: number;
  unknown: number;
}

export interface CompactionsPayload {
  range: ActivityRange;
  total: number;
  auto: number;
  manual: number;
  unknown: number;
  sessionsCompacted: number;
  sessions: number;
  medianTokensBefore: number | null;
  agents: CompactionsAgentRow[];  // every agent with activity, most compactions first
  byDay: CompactionsDayBucket[];
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

// ─── Native-session analytics ────────────────────────────────────────────────
// These read the raw `events` table grouped by the agent-native `session_id`,
// unlocking intra- and cross-session stats the idle-gap-derived `sessions`
// rollup can't express. All four reuse TimelineRange.

export type CadenceRange = TimelineRange;
export type WaitingRange = TimelineRange;
export type CacheEfficiencyRange = TimelineRange;
export type LifecycleRange = TimelineRange;

// Cadence — intra-session rhythm: how long between prompts, how deep sessions go.
export interface CadenceRow {
  toolId: ToolId;
  medianThinkMs: number;         // median gap between prompts, capped at THINK_CAP_MS
  avgPromptsPerSession: number;
  sessions: number;
}

export type CadenceDepthLabel = '1' | '2-3' | '4-9' | '10+';

export interface CadenceDepthBucket {
  bucket: CadenceDepthLabel;
  count: number;                 // number of native sessions in this depth band
}

export interface CadencePayload {
  range: CadenceRange;
  rows: CadenceRow[];
  depth: CadenceDepthBucket[];
  overallMedianThinkMs: number;
  overallAvgPromptsPerSession: number;
  thinkSampleCount: number;      // gaps that fed the think-time stat (post-cap)
  queriedAt: number;
}

// Waiting — time an agent sat blocked on the user (permission/elicitation).
export interface WaitingRow {
  toolId: ToolId;
  waitMs: number;
  episodes: number;              // ≈ number of permission prompts
  avgWaitMs: number;
  pctOfActive: number;           // waitMs as % of the tool's engaged (work+wait+error) time
  hasData: boolean;              // false → this agent never emits a blocked state
}

export interface WaitingPayload {
  range: WaitingRange;
  rows: WaitingRow[];
  totalWaitMs: number;
  totalEpisodes: number;
  queriedAt: number;
}

// Cache efficiency — how much input was served from cache, and $ saved.
export interface CacheEfficiencyRow {
  toolId: ToolId;
  hitRatio: number;              // cachedTokens / (cachedTokens + freshTokens), 0..1
  freshTokens: number;           // input tokens billed fresh
  cachedTokens: number;          // input tokens served from cache (cache_read)
  savedUsd: number;              // estimated $ saved vs paying full input rate
  priced: boolean;               // false → none of the tool's models were priced
  hasData: boolean;              // false → tool exposes no cache/token data
}

export interface CacheEfficiencyPayload {
  range: CacheEfficiencyRange;
  rows: CacheEfficiencyRow[];
  overallHitRatio: number;
  totalSavedUsd: number;
  queriedAt: number;
}

// Lifecycle — conversation-level: resumes and calendar-span vs active time.
export interface LifecyclePayload {
  range: LifecycleRange;
  totalSessions: number;
  resumedSessions: number;
  resumeRatePct: number;
  avgResumesPerSession: number;
  medianResumeIntervalMs: number;
  avgSpanMs: number;             // avg conversation calendar-span (first→last event)
  avgActiveMs: number;           // avg active time per native session (from rollup)
  densityPct: number;            // avgActiveMs / avgSpanMs, "engagement density"
  queriedAt: number;
}

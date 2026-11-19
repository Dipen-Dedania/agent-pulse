import path from 'path';
import { TimelineDb } from './db';
import { ToolId } from '../../common/types';
import {
  DigestPayload,
  DailyDigest,
  ToolBreakdown,
  TokenTotals,
  QuotaDelta,
  HeatmapPayload,
  HeatmapSeries,
  HeatmapRange,
  HourRhythmPayload,
  HourRhythmRange,
  TimelineRange,
  ToolMixPayload,
  ToolMixRange,
  ModelUsagePayload,
  ModelUsageRow,
  ModelUsageRange,
  ProjectBreakdownPayload,
  ProjectBreakdownRange,
  ProjectBreakdownRow,
  TokensTimelinePayload,
  TokensTimelineRange,
  TokensTimelineBucket,
  GuardrailsAnalyticsPayload,
  GuardrailsAnalyticsRange,
  GuardrailToolCount,
  GuardrailRuleCount,
  SecretAccessAnalyticsPayload,
  SecretAccessFileCount,
  ModelUsageMode,
  WindowValuePayload,
  WindowValueSlice,
  AnalyticsSummaryPayload,
  SummarySlice,
  LifetimeTokensPayload,
  CadencePayload,
  CadenceRange,
  CadenceRow,
  CadenceDepthLabel,
  CadenceDepthBucket,
  WaitingPayload,
  WaitingRange,
  WaitingRow,
  CacheEfficiencyPayload,
  CacheEfficiencyRange,
  CacheEfficiencyRow,
  LifecyclePayload,
  LifecycleRange,
  LimitHitsPayload,
  LimitHitsRange,
  LimitHitKind,
  CacheHealthPayload,
  CacheHealthRange,
  CacheHealthSessionRow,
  ContextPressurePayload,
  ContextPressureRange,
  ContextPressureSessionRow,
  ActionMixPayload,
  ActionMixRange,
  ActionMixAgentRow,
  ActionMixCategoryCount,
  ActionMixToolCount,
  ActivityRange,
  PromptSizePayload,
  PromptSizeAgentRow,
  LinesChangedPayload,
  LinesChangedAgentRow,
  SubagentUsePayload,
  SubagentAgentRow,
} from '../../common/timeline-types';
import {
  ACTION_CATEGORIES,
  ActionCategory,
  DOUBLE_REPORTING_AGENTS,
  classifyToolName,
  countPairedToolCalls,
} from '../../common/action-mix';
import { estimateCost, estimateCostBreakdown, rateForModel, CostBreakdown, TokenCounts } from '../../common/pricing';
import { realModels } from './models';

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatLocalDate(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function rangeDays(range: TimelineRange): number {
  if (range === '7d')  return 7;
  if (range === '30d') return 30;
  if (range === '90d') return 90;
  return 365;
}

function rangeMs(range: TimelineRange): number {
  return rangeDays(range) * DAY_MS;
}

// Native-session analytics thresholds (fixed constants — see plan). THINK_CAP_MS
// matches the default idle gap: gaps at/above it are breaks/resumes, not think
// time. RESUME_GAP_MS is the intra-session gap that counts as a resume.
const THINK_CAP_MS = 5 * 60 * 1000;
const WAIT_SPAN_CAP_MS = 30 * 60 * 1000;
const RESUME_GAP_MS = 60 * 60 * 1000;

// Median of an already-ascending-sorted array. Returns 0 for an empty array.
function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

interface SessionAggregateRow {
  tool_id: string;
  project_id: string | null;
  project_path: string | null;
  started_at: number;
  ended_at: number;
  total_tokens_in: number | null;
  total_tokens_out: number | null;
  total_cache_read: number | null;
  total_cache_write: number | null;
  task_summary: string | null;
  models_used: string | null;
}

export class TimelineQueries {
  // `resolveSessionTitle` maps a native session id to a human title (Claude
  // Code's transcript title). Injected so the queries stay free of fs access
  // and the caller can switch titles off (task-text redaction).
  constructor(
    private db: TimelineDb,
    private resolveSessionTitle: (sessionId: string) => string | null = () => null,
  ) {}

  // Display label for a statusline-feed session row: the session's title plus
  // the project it ran in (basename of the newest hook event's project path).
  private statuslineSessionLabel(sessionId: string): { title: string | null; project: string | null } {
    const row = this.db.query<{ project_path: string }>(
      `SELECT project_path FROM events
       WHERE session_id = ? AND project_path IS NOT NULL
       ORDER BY timestamp DESC LIMIT 1`,
      [sessionId],
    )[0];
    let title: string | null = null;
    try { title = this.resolveSessionTitle(sessionId); }
    catch { /* a title is cosmetic — never fail the card over it */ }
    return { title, project: row?.project_path ? path.basename(row.project_path) : null };
  }

  // Estimate a session's cost. Token totals are session-level, so when a
  // session used more than one model we split the tokens evenly across them
  // (same best-effort attribution getModelUsage uses). `priced` is true when
  // at least one of the session's models was in the price table.
  private costForSession(modelsUsed: string | null | undefined, tokens: TokenCounts): { costUsd: number; priced: boolean } {
    const models = realModels(modelsUsed);
    if (models.length === 0) return { costUsd: 0, priced: false };
    const share = 1 / models.length;
    let costUsd = 0;
    let priced = false;
    for (const model of models) {
      const est = estimateCost(model, {
        tokensIn:   (tokens.tokensIn   ?? 0) * share,
        tokensOut:  (tokens.tokensOut  ?? 0) * share,
        cacheRead:  (tokens.cacheRead  ?? 0) * share,
        cacheWrite: (tokens.cacheWrite ?? 0) * share,
      });
      costUsd += est.costUsd;
      if (est.priced) priced = true;
    }
    return { costUsd, priced };
  }

  // Same even-split-across-models attribution as costForSession, but returns
  // the cost broken out per token class so the UI can explain the total.
  private breakdownForSession(modelsUsed: string | null | undefined, tokens: TokenCounts): CostBreakdown {
    const acc: CostBreakdown = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    const models = realModels(modelsUsed);
    if (models.length === 0) return acc;
    const share = 1 / models.length;
    for (const model of models) {
      const { breakdown } = estimateCostBreakdown(model, {
        tokensIn:   (tokens.tokensIn   ?? 0) * share,
        tokensOut:  (tokens.tokensOut  ?? 0) * share,
        cacheRead:  (tokens.cacheRead  ?? 0) * share,
        cacheWrite: (tokens.cacheWrite ?? 0) * share,
      });
      acc.input      += breakdown.input;
      acc.output     += breakdown.output;
      acc.cacheWrite += breakdown.cacheWrite;
      acc.cacheRead  += breakdown.cacheRead;
    }
    return acc;
  }

  getDigest(): DigestPayload {
    const now = Date.now();
    const startToday = startOfLocalDay(now);
    const startYesterday = startToday - DAY_MS;

    return {
      today:     this.digestForDay(startToday, startToday + DAY_MS),
      yesterday: this.digestForDay(startYesterday, startToday),
      queriedAt: now,
    };
  }

  // Tab-level KPI aggregates for the selected range plus the immediately
  // preceding period of equal length, so the hero row can show deltas.
  getSummary(range: TimelineRange): AnalyticsSummaryPayload {
    const now = Date.now();
    const span = rangeMs(range);
    return {
      range,
      current:  this.summaryForWindow(now - span, now),
      previous: this.summaryForWindow(now - 2 * span, now - span),
      queriedAt: now,
    };
  }

  private summaryForWindow(startMs: number, endMs: number): SummarySlice {
    const rows = this.db.query<SessionAggregateRow>(
      `SELECT project_path, started_at, ended_at, models_used,
              total_tokens_in, total_tokens_out, total_cache_read, total_cache_write
       FROM sessions WHERE started_at >= ? AND started_at < ?`,
      [startMs, endMs],
    );
    let activeMs = 0;
    let costUsd = 0;
    const byProject = new Map<string, { displayName: string; activeMs: number }>();
    for (const r of rows) {
      const duration = Math.max(0, r.ended_at - r.started_at);
      activeMs += duration;
      costUsd += this.costForSession(r.models_used, {
        tokensIn: r.total_tokens_in, tokensOut: r.total_tokens_out,
        cacheRead: r.total_cache_read, cacheWrite: r.total_cache_write,
      }).costUsd;
      if (r.project_path) {
        const displayName = path.basename(r.project_path);
        const entry = byProject.get(displayName) ?? { displayName, activeMs: 0 };
        entry.activeMs += duration;
        byProject.set(displayName, entry);
      }
    }
    let topProject: SummarySlice['topProject'] = null;
    for (const p of byProject.values()) {
      if (!topProject || p.activeMs > topProject.activeMs) topProject = p;
    }
    return { activeMs, sessions: rows.length, costUsd, topProject };
  }

  // All-time token totals for the top-of-tab hero. Reads the `sessions` rollup
  // because it is the only token source that is never pruned (events go at 365
  // days). Grouped by model set so cost is priced per group instead of per row
  // — costForSession is linear in tokens, so the result is identical.
  getLifetimeTokens(): LifetimeTokensPayload {
    const rows = this.db.query<{
      models_used: string | null;
      sessions: number;
      first_started_at: number | null;
      tokens_in: number;
      tokens_out: number;
      cache_read: number;
      cache_write: number;
    }>(
      `SELECT models_used,
              COUNT(*)                               AS sessions,
              MIN(started_at)                        AS first_started_at,
              COALESCE(SUM(total_tokens_in),    0)   AS tokens_in,
              COALESCE(SUM(total_tokens_out),   0)   AS tokens_out,
              COALESCE(SUM(total_cache_read),   0)   AS cache_read,
              COALESCE(SUM(total_cache_write),  0)   AS cache_write
       FROM sessions GROUP BY models_used`,
    );

    const out: LifetimeTokensPayload = {
      tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      costUsd: 0, sessions: 0, firstSessionAt: null, queriedAt: Date.now(),
    };
    for (const r of rows) {
      out.tokensIn   += r.tokens_in;
      out.tokensOut  += r.tokens_out;
      out.cacheRead  += r.cache_read;
      out.cacheWrite += r.cache_write;
      out.sessions   += r.sessions;
      out.costUsd    += this.costForSession(r.models_used, {
        tokensIn: r.tokens_in, tokensOut: r.tokens_out,
        cacheRead: r.cache_read, cacheWrite: r.cache_write,
      }).costUsd;
      if (r.first_started_at != null && (out.firstSessionAt == null || r.first_started_at < out.firstSessionAt)) {
        out.firstSessionAt = r.first_started_at;
      }
    }
    out.totalTokens = out.tokensIn + out.tokensOut + out.cacheRead + out.cacheWrite;
    return out;
  }

  getHeatmap(range: HeatmapRange, groupBy: 'tool' | 'project' | 'all'): HeatmapPayload {
    const now = Date.now();
    const startMs = startOfLocalDay(now) - rangeMs(range) + DAY_MS;

    // Pull all sessions in window; we'll bucket in JS.
    const rows = this.db.query<SessionAggregateRow>(
      `SELECT tool_id, project_id, project_path, started_at, ended_at, task_summary
       FROM sessions WHERE ended_at >= ?`,
      [startMs],
    );

    // Build day list (oldest → newest)
    const dayCount = rangeDays(range);
    const dayBuckets: string[] = [];
    const today = startOfLocalDay(now);
    for (let i = dayCount - 1; i >= 0; i--) {
      dayBuckets.push(formatLocalDate(today - i * DAY_MS));
    }

    // Aggregate to (seriesKey, date) → {activeMs, sessions}
    const projectsSeen = new Map<string, { displayName: string; total: number }>();
    type Cell = { activeMs: number; sessions: number };
    const matrix = new Map<string, Map<string, Cell>>();

    for (const row of rows) {
      const dateKey = formatLocalDate(row.started_at);
      const duration = Math.max(0, row.ended_at - row.started_at);
      let seriesKey: string;
      let displayName: string;
      if (groupBy === 'all') {
        seriesKey = 'all';
        displayName = 'All tools';
      } else if (groupBy === 'tool') {
        seriesKey = row.tool_id;
        displayName = row.tool_id;
      } else {
        seriesKey = row.project_id ?? 'untracked';
        displayName = row.project_path ? path.basename(row.project_path) : 'Untracked';
        const existing = projectsSeen.get(seriesKey);
        projectsSeen.set(seriesKey, {
          displayName,
          total: (existing?.total ?? 0) + duration,
        });
      }
      let dayMap = matrix.get(seriesKey);
      if (!dayMap) { dayMap = new Map<string, Cell>(); matrix.set(seriesKey, dayMap); }
      const cell = dayMap.get(dateKey) ?? { activeMs: 0, sessions: 0 };
      cell.activeMs += duration;
      cell.sessions += 1;
      dayMap.set(dateKey, cell);
    }

    // Build series. For project grouping, cap to top 6 + "other".
    let seriesEntries: Array<{ key: string; displayName: string }> = [];
    if (groupBy === 'project') {
      const sorted = Array.from(projectsSeen.entries())
        .sort((a, b) => b[1].total - a[1].total);
      const top = sorted.slice(0, 6);
      seriesEntries = top.map(([key, v]) => ({ key, displayName: v.displayName }));
      if (sorted.length > 6) {
        // Collapse the remainder into "other"
        const otherMatrix = new Map<string, Cell>();
        for (const [key] of sorted.slice(6)) {
          const dm = matrix.get(key);
          if (!dm) continue;
          for (const [date, cell] of dm.entries()) {
            const existing = otherMatrix.get(date) ?? { activeMs: 0, sessions: 0 };
            existing.activeMs += cell.activeMs;
            existing.sessions += cell.sessions;
            otherMatrix.set(date, existing);
          }
        }
        matrix.set('__other', otherMatrix);
        seriesEntries.push({ key: '__other', displayName: 'Other' });
      }
    } else {
      seriesEntries = Array.from(matrix.keys()).map((key) => ({
        key,
        displayName: groupBy === 'all' ? 'All tools' : key,
      }));
    }

    const series: HeatmapSeries[] = seriesEntries.map(({ key, displayName }) => {
      const dm = matrix.get(key) ?? new Map<string, Cell>();
      return {
        key,
        displayName,
        cells: dayBuckets.map((date) => {
          const cell = dm.get(date) ?? { activeMs: 0, sessions: 0 };
          return { date, activeMs: cell.activeMs, sessions: cell.sessions };
        }),
      };
    });

    return { range, groupBy, series, queriedAt: now };
  }

  getHourRhythm(range: HourRhythmRange): HourRhythmPayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);
    const rows = this.db.query<{ started_at: number; ended_at: number }>(
      `SELECT started_at, ended_at FROM sessions WHERE ended_at >= ?`,
      [startMs],
    );
    const buckets = new Array<number>(24).fill(0);
    for (const r of rows) {
      // Bucket the session into each hour it overlaps. Simple/exact attribution.
      const s = Math.max(r.started_at, startMs);
      const e = r.ended_at;
      if (e <= s) continue;
      let cursor = s;
      while (cursor < e) {
        const d = new Date(cursor);
        const hour = d.getHours();
        const nextHour = new Date(d);
        nextHour.setMinutes(0, 0, 0);
        nextHour.setHours(nextHour.getHours() + 1);
        const sliceEnd = Math.min(e, nextHour.getTime());
        buckets[hour] += sliceEnd - cursor;
        cursor = sliceEnd;
      }
    }
    return { range, buckets, queriedAt: now };
  }

  getToolMix(range: ToolMixRange): ToolMixPayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);
    const rows = this.db.query<SessionAggregateRow>(
      `SELECT tool_id, started_at, ended_at, models_used,
              total_tokens_in, total_tokens_out, total_cache_read, total_cache_write
       FROM sessions WHERE ended_at >= ?`,
      [startMs],
    );

    interface Acc {
      toolId: ToolId;
      activeMs: number;
      tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number;
      costUsd: number;
      hasTokenData: boolean;
    }
    const byTool = new Map<string, Acc>();
    for (const r of rows) {
      const acc = byTool.get(r.tool_id) ?? {
        toolId: r.tool_id as ToolId,
        activeMs: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0,
        costUsd: 0, hasTokenData: false,
      };
      acc.activeMs += Math.max(0, r.ended_at - r.started_at);
      const tokens: TokenCounts = {
        tokensIn: r.total_tokens_in, tokensOut: r.total_tokens_out,
        cacheRead: r.total_cache_read, cacheWrite: r.total_cache_write,
      };
      acc.tokensIn   += r.total_tokens_in   ?? 0;
      acc.tokensOut  += r.total_tokens_out  ?? 0;
      acc.cacheRead  += r.total_cache_read  ?? 0;
      acc.cacheWrite += r.total_cache_write ?? 0;
      const tokenSum = (r.total_tokens_in ?? 0) + (r.total_tokens_out ?? 0)
                     + (r.total_cache_read ?? 0) + (r.total_cache_write ?? 0);
      if (tokenSum > 0) acc.hasTokenData = true;
      acc.costUsd += this.costForSession(r.models_used, tokens).costUsd;
      byTool.set(r.tool_id, acc);
    }

    const totalActiveMs = Array.from(byTool.values()).reduce((s, a) => s + a.activeMs, 0);
    const totalCostUsd  = Array.from(byTool.values()).reduce((s, a) => s + a.costUsd, 0);
    const slices = Array.from(byTool.values()).map((a) => ({
      toolId: a.toolId,
      activeMs: a.activeMs,
      pct: totalActiveMs > 0 ? (a.activeMs / totalActiveMs) * 100 : 0,
      tokensIn: a.tokensIn, tokensOut: a.tokensOut, cacheRead: a.cacheRead, cacheWrite: a.cacheWrite,
      costUsd: a.costUsd,
      costPct: totalCostUsd > 0 ? (a.costUsd / totalCostUsd) * 100 : 0,
      hasTokenData: a.hasTokenData,
    })).sort((a, b) => b.activeMs - a.activeMs);

    return { range, slices, totalActiveMs, totalCostUsd, queriedAt: now };
  }

  getModelUsage(range: ModelUsageRange, mode: ModelUsageMode): ModelUsagePayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);

    // Pull every session with non-null models_used in window.
    const sessionRows = this.db.query<SessionAggregateRow>(
      `SELECT tool_id, models_used, total_tokens_in, total_tokens_out,
              total_cache_read, total_cache_write
       FROM sessions WHERE ended_at >= ? AND models_used IS NOT NULL`,
      [startMs],
    );

    // Token totals are session-level not per-model — we attribute proportionally
    // when more than one model appears in a session (best-effort, since Claude
    // doesn't split usage per model in its transcript). For single-model
    // sessions this is exact.
    const perModel = new Map<string, ModelUsageRow>();
    for (const row of sessionRows) {
      if (!row.models_used) continue;
      // Drop pseudo-models like "<synthetic>" before splitting — otherwise the
      // even-split attribution hands them a phantom share of real tokens (see
      // ./models). A session with only pseudo-models contributes nothing.
      const models = realModels(row.models_used);
      if (models.length === 0) continue;
      const share = 1 / models.length;
      for (const model of models) {
        const existing: ModelUsageRow = perModel.get(model) ?? {
          model,
          toolId: row.tool_id as ToolId,
          tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, sessions: 0,
          costUsd: 0, priced: false,
        };
        existing.tokensIn   += (row.total_tokens_in   ?? 0) * share;
        existing.tokensOut  += (row.total_tokens_out  ?? 0) * share;
        existing.cacheRead  += (row.total_cache_read  ?? 0) * share;
        existing.cacheWrite += (row.total_cache_write ?? 0) * share;
        existing.sessions   += 1;
        perModel.set(model, existing);
      }
    }

    const rows = Array.from(perModel.values()).map((r) => {
      const est = estimateCost(r.model, {
        tokensIn: r.tokensIn, tokensOut: r.tokensOut, cacheRead: r.cacheRead, cacheWrite: r.cacheWrite,
      });
      return {
        ...r,
        tokensIn:   Math.round(r.tokensIn),
        tokensOut:  Math.round(r.tokensOut),
        cacheRead:  Math.round(r.cacheRead),
        cacheWrite: Math.round(r.cacheWrite),
        costUsd:    est.costUsd,
        priced:     rateForModel(r.model) != null,
      };
    });

    const totalTokens = rows.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0);
    const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);
    const totalCostUsd = rows.reduce((s, r) => s + r.costUsd, 0);

    rows.sort((a, b) =>
      mode === 'tokens'
        ? (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut)
        : mode === 'cost'
          ? b.costUsd - a.costUsd
          : b.sessions - a.sessions,
    );

    return { range, mode, rows, totalTokens, totalSessions, totalCostUsd, queriedAt: now };
  }

  // ─── Native-session analytics (grouped by agent-native session_id) ──────────
  // Unlike the cards above (which read the `sessions` rollup), these read the
  // raw `events` table grouped by session_id, using SQLite window functions to
  // detect per-session transitions. JS does the median/bucketing/pricing.

  // Session Cadence — think-time between prompts + prompts-per-session depth.
  getCadence(range: CadenceRange): CadencePayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);

    // A prompt/turn start = an event entering 'working' from a non-working prev
    // state, within one native session. LAG detects the transition.
    const rows = this.db.query<{ tool_id: string; session_id: string; timestamp: number }>(
      `WITH ev AS (
         SELECT tool_id, session_id, state, timestamp,
                LAG(state) OVER (PARTITION BY session_id ORDER BY timestamp) AS prev_state
         FROM events
         WHERE timestamp >= ? AND session_id IS NOT NULL
       )
       SELECT tool_id, session_id, timestamp
       FROM ev
       WHERE state = 'working' AND (prev_state IS NULL OR prev_state <> 'working')
       ORDER BY session_id, timestamp`,
      [startMs],
    );

    // Group turn-starts per native session, preserving timestamp order.
    const bySession = new Map<string, { toolId: string; ts: number[] }>();
    for (const r of rows) {
      const s = bySession.get(r.session_id) ?? { toolId: r.tool_id, ts: [] };
      s.ts.push(r.timestamp);
      bySession.set(r.session_id, s);
    }

    const byTool = new Map<string, { gaps: number[]; prompts: number; sessions: number }>();
    const allGaps: number[] = [];
    const depthCount: Record<CadenceDepthLabel, number> = { '1': 0, '2-3': 0, '4-9': 0, '10+': 0 };
    let totalPrompts = 0;
    let totalSessions = 0;

    for (const s of bySession.values()) {
      const prompts = s.ts.length;
      totalPrompts += prompts;
      totalSessions += 1;
      const bucket: CadenceDepthLabel =
        prompts <= 1 ? '1' : prompts <= 3 ? '2-3' : prompts <= 9 ? '4-9' : '10+';
      depthCount[bucket] += 1;

      const acc = byTool.get(s.toolId) ?? { gaps: [], prompts: 0, sessions: 0 };
      acc.prompts += prompts;
      acc.sessions += 1;
      for (let i = 1; i < s.ts.length; i++) {
        const gap = s.ts[i] - s.ts[i - 1];
        // Cap: gaps ≥ THINK_CAP_MS are breaks/resumes, not deliberation.
        if (gap > 0 && gap < THINK_CAP_MS) { acc.gaps.push(gap); allGaps.push(gap); }
      }
      byTool.set(s.toolId, acc);
    }

    const rowsOut: CadenceRow[] = Array.from(byTool.entries()).map(([toolId, a]) => ({
      toolId: toolId as ToolId,
      medianThinkMs: median(a.gaps.slice().sort((x, y) => x - y)),
      avgPromptsPerSession: a.sessions > 0 ? a.prompts / a.sessions : 0,
      sessions: a.sessions,
    })).sort((a, b) => b.sessions - a.sessions);

    const depth: CadenceDepthBucket[] = (['1', '2-3', '4-9', '10+'] as CadenceDepthLabel[])
      .map((bucket) => ({ bucket, count: depthCount[bucket] }));

    return {
      range,
      rows: rowsOut,
      depth,
      overallMedianThinkMs: median(allGaps.sort((x, y) => x - y)),
      overallAvgPromptsPerSession: totalSessions > 0 ? totalPrompts / totalSessions : 0,
      thinkSampleCount: allGaps.length,
      queriedAt: now,
    };
  }

  // Waiting on You — time an agent sat blocked on the user (permission prompts).
  getWaiting(range: WaitingRange): WaitingPayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);

    // A waiting span = the gap from a 'waiting' event to the next event in the
    // same session, capped so a walk-away doesn't inflate it. `active_ms` is the
    // engaged (work+wait+error) time, the denominator for pctOfActive.
    const rows = this.db.query<{ tool_id: string; wait_ms: number; episodes: number; active_ms: number }>(
      `WITH ev AS (
         SELECT tool_id, session_id, state, timestamp,
                LEAD(timestamp) OVER (PARTITION BY session_id ORDER BY timestamp) AS next_ts
         FROM events
         WHERE timestamp >= ? AND session_id IS NOT NULL
       )
       SELECT tool_id,
              SUM(CASE WHEN state = 'waiting' AND next_ts IS NOT NULL
                       THEN MIN(next_ts - timestamp, ?) ELSE 0 END) AS wait_ms,
              SUM(CASE WHEN state = 'waiting' THEN 1 ELSE 0 END) AS episodes,
              SUM(CASE WHEN state IN ('working', 'waiting', 'error') AND next_ts IS NOT NULL
                       THEN MIN(next_ts - timestamp, ?) ELSE 0 END) AS active_ms
       FROM ev
       GROUP BY tool_id`,
      [startMs, WAIT_SPAN_CAP_MS, WAIT_SPAN_CAP_MS],
    );

    const out: WaitingRow[] = rows.map((r) => {
      const waitMs = r.wait_ms ?? 0;
      const episodes = r.episodes ?? 0;
      return {
        toolId: r.tool_id as ToolId,
        waitMs,
        episodes,
        avgWaitMs: episodes > 0 ? waitMs / episodes : 0,
        pctOfActive: (r.active_ms ?? 0) > 0 ? (waitMs / r.active_ms) * 100 : 0,
        hasData: episodes > 0,
      };
    }).sort((a, b) => b.waitMs - a.waitMs);

    return {
      range,
      rows: out,
      totalWaitMs: out.reduce((s, r) => s + r.waitMs, 0),
      totalEpisodes: out.reduce((s, r) => s + r.episodes, 0),
      queriedAt: now,
    };
  }

  // Cache Efficiency — share of input served from cache, and estimated $ saved.
  getCacheEfficiency(range: CacheEfficiencyRange): CacheEfficiencyPayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);

    // Read events (more complete than the sessions rollup — the deriver drops
    // token deltas that arrive after a session closes). Group by tool+model so
    // savings can be priced per model.
    const rows = this.db.query<{ tool_id: string; model: string | null; tin: number; cr: number; cw: number }>(
      `SELECT tool_id, model,
              SUM(COALESCE(tokens_in, 0))   AS tin,
              SUM(COALESCE(cache_read, 0))  AS cr,
              SUM(COALESCE(cache_write, 0)) AS cw
       FROM events
       WHERE timestamp >= ?
       GROUP BY tool_id, model`,
      [startMs],
    );

    const byTool = new Map<string, { fresh: number; cached: number; savedUsd: number; priced: boolean; hasData: boolean }>();
    for (const r of rows) {
      const acc = byTool.get(r.tool_id) ?? { fresh: 0, cached: 0, savedUsd: 0, priced: false, hasData: false };
      const fresh = r.tin ?? 0;
      const cached = r.cr ?? 0;
      acc.fresh += fresh;
      acc.cached += cached;
      if (fresh > 0 || cached > 0 || (r.cw ?? 0) > 0) acc.hasData = true;
      if (r.model) {
        const rate = rateForModel(r.model);
        if (rate) {
          acc.priced = true;
          // Saved = what those cache-read tokens WOULD have cost at the full
          // input rate, minus what they actually cost at the cache-read rate.
          acc.savedUsd += (cached * (rate.input - rate.cacheRead)) / 1_000_000;
        }
      }
      byTool.set(r.tool_id, acc);
    }

    const out: CacheEfficiencyRow[] = Array.from(byTool.entries()).map(([toolId, a]) => {
      const denom = a.fresh + a.cached;
      return {
        toolId: toolId as ToolId,
        hitRatio: denom > 0 ? a.cached / denom : 0,
        freshTokens: Math.round(a.fresh),
        cachedTokens: Math.round(a.cached),
        savedUsd: a.savedUsd,
        priced: a.priced,
        hasData: a.hasData,
      };
    }).sort((a, b) => (b.freshTokens + b.cachedTokens) - (a.freshTokens + a.cachedTokens));

    const totalFresh = out.reduce((s, r) => s + r.freshTokens, 0);
    const totalCached = out.reduce((s, r) => s + r.cachedTokens, 0);

    return {
      range,
      rows: out,
      overallHitRatio: (totalFresh + totalCached) > 0 ? totalCached / (totalFresh + totalCached) : 0,
      totalSavedUsd: out.reduce((s, r) => s + r.savedUsd, 0),
      queriedAt: now,
    };
  }

  // Resume & Lifecycle — resumes per session + calendar-span vs active time.
  getLifecycle(range: LifecycleRange): LifecyclePayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);

    // Per native session: span (first→last event) and resume count (intra-session
    // gaps ≥ RESUME_GAP_MS).
    const sessRows = this.db.query<{ session_id: string; first_ts: number; last_ts: number; resumes: number }>(
      `WITH ev AS (
         SELECT session_id, timestamp,
                LAG(timestamp) OVER (PARTITION BY session_id ORDER BY timestamp) AS prev_ts
         FROM events
         WHERE timestamp >= ? AND session_id IS NOT NULL
       )
       SELECT session_id,
              MIN(timestamp) AS first_ts,
              MAX(timestamp) AS last_ts,
              SUM(CASE WHEN prev_ts IS NOT NULL AND timestamp - prev_ts >= ? THEN 1 ELSE 0 END) AS resumes
       FROM ev
       GROUP BY session_id`,
      [startMs, RESUME_GAP_MS],
    );

    // The resume-gap lengths themselves, for the median interval.
    const gapRows = this.db.query<{ gap: number }>(
      `WITH ev AS (
         SELECT session_id, timestamp,
                LAG(timestamp) OVER (PARTITION BY session_id ORDER BY timestamp) AS prev_ts
         FROM events
         WHERE timestamp >= ? AND session_id IS NOT NULL
       )
       SELECT timestamp - prev_ts AS gap
       FROM ev
       WHERE prev_ts IS NOT NULL AND timestamp - prev_ts >= ?`,
      [startMs, RESUME_GAP_MS],
    );

    // Active time per native session, from the derived rollup (ties native id
    // back to the idle-gap active segments).
    const activeRows = this.db.query<{ session_id: string; active_ms: number }>(
      `SELECT session_id, SUM(MAX(ended_at - started_at, 0)) AS active_ms
       FROM sessions
       WHERE session_id IS NOT NULL AND started_at >= ?
       GROUP BY session_id`,
      [startMs],
    );
    const activeBySession = new Map<string, number>();
    for (const r of activeRows) activeBySession.set(r.session_id, r.active_ms ?? 0);

    const totalSessions = sessRows.length;
    let resumedSessions = 0;
    let totalResumes = 0;
    let spanSum = 0;
    let activeSum = 0;
    for (const r of sessRows) {
      if (r.resumes > 0) resumedSessions += 1;
      totalResumes += r.resumes;
      spanSum += Math.max(0, r.last_ts - r.first_ts);
      activeSum += activeBySession.get(r.session_id) ?? 0;
    }

    const avgSpanMs = totalSessions > 0 ? spanSum / totalSessions : 0;
    const avgActiveMs = totalSessions > 0 ? activeSum / totalSessions : 0;

    return {
      range,
      totalSessions,
      resumedSessions,
      resumeRatePct: totalSessions > 0 ? (resumedSessions / totalSessions) * 100 : 0,
      avgResumesPerSession: totalSessions > 0 ? totalResumes / totalSessions : 0,
      medianResumeIntervalMs: median(gapRows.map((g) => g.gap).sort((a, b) => a - b)),
      avgSpanMs,
      avgActiveMs,
      densityPct: avgSpanMs > 0 ? (avgActiveMs / avgSpanMs) * 100 : 0,
      queriedAt: now,
    };
  }

  getProjectBreakdown(range: ProjectBreakdownRange): ProjectBreakdownPayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);
    const rows = this.db.query<SessionAggregateRow>(
      `SELECT tool_id, project_id, project_path, started_at, ended_at, models_used,
              total_tokens_in, total_tokens_out, total_cache_read, total_cache_write
       FROM sessions WHERE ended_at >= ? AND project_id IS NOT NULL`,
      [startMs],
    );
    const byProject = new Map<string, ProjectBreakdownRow>();
    for (const r of rows) {
      if (!r.project_id) continue;
      const duration = Math.max(0, r.ended_at - r.started_at);
      const existing = byProject.get(r.project_id) ?? {
        projectId: r.project_id,
        projectPath: r.project_path ?? '',
        displayName: r.project_path ? path.basename(r.project_path) : r.project_id,
        activeMs: 0,
        sessions: 0,
        tools: [] as ToolId[],
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        costUsd: 0,
        priced: false,
      };
      existing.activeMs += duration;
      existing.sessions += 1;
      existing.tokensIn  += r.total_tokens_in  ?? 0;
      existing.tokensOut += r.total_tokens_out ?? 0;
      existing.cacheRead += r.total_cache_read ?? 0;
      const cost = this.costForSession(r.models_used, {
        tokensIn: r.total_tokens_in, tokensOut: r.total_tokens_out,
        cacheRead: r.total_cache_read, cacheWrite: r.total_cache_write,
      });
      existing.costUsd += cost.costUsd;
      if (cost.priced) existing.priced = true;
      if (!existing.tools.includes(r.tool_id as ToolId)) {
        existing.tools.push(r.tool_id as ToolId);
      }
      byProject.set(r.project_id, existing);
    }
    const ranked = Array.from(byProject.values()).sort((a, b) => b.activeMs - a.activeMs);
    return { range, rows: ranked, queriedAt: now };
  }

  getTokensTimeline(range: TokensTimelineRange): TokensTimelinePayload {
    const now = Date.now();
    const dayCount = rangeDays(range);
    const startMs = startOfLocalDay(now) - (dayCount - 1) * DAY_MS;

    const rows = this.db.query<{
      started_at: number;
      total_tokens_in: number | null;
      total_tokens_out: number | null;
      total_cache_read: number | null;
      total_cache_write: number | null;
      models_used: string | null;
    }>(
      `SELECT started_at, models_used,
              COALESCE(total_tokens_in,   0) AS total_tokens_in,
              COALESCE(total_tokens_out,  0) AS total_tokens_out,
              COALESCE(total_cache_read,  0) AS total_cache_read,
              COALESCE(total_cache_write, 0) AS total_cache_write
       FROM sessions WHERE ended_at >= ?`,
      [startMs],
    );

    // Pre-build dense day buckets (oldest → newest) so the chart x-axis is
    // continuous even on inactive days. Attribute each session to its
    // started_at day (matches getHeatmap convention).
    const today = startOfLocalDay(now);
    const bucketsByDate = new Map<string, TokensTimelineBucket>();
    const orderedDates: string[] = [];
    for (let i = dayCount - 1; i >= 0; i--) {
      const date = formatLocalDate(today - i * DAY_MS);
      orderedDates.push(date);
      bucketsByDate.set(date, { date, tokensIn: 0, tokensOut: 0, cacheRead: 0, costUsd: 0 });
    }

    for (const r of rows) {
      const date = formatLocalDate(r.started_at);
      const bucket = bucketsByDate.get(date);
      if (!bucket) continue; // older than window after day-rounding
      bucket.tokensIn  += r.total_tokens_in  ?? 0;
      bucket.tokensOut += r.total_tokens_out ?? 0;
      bucket.cacheRead += r.total_cache_read ?? 0;
      bucket.costUsd   += this.costForSession(r.models_used, {
        tokensIn: r.total_tokens_in, tokensOut: r.total_tokens_out,
        cacheRead: r.total_cache_read, cacheWrite: r.total_cache_write,
      }).costUsd;
    }

    const buckets = orderedDates.map((d) => bucketsByDate.get(d)!);
    let maxFresh = 0;
    let maxCacheRead = 0;
    let maxCost = 0;
    let totalFresh = 0;
    let totalCacheRead = 0;
    let totalCostUsd = 0;
    for (const b of buckets) {
      const fresh = b.tokensIn + b.tokensOut;
      if (fresh > maxFresh) maxFresh = fresh;
      if (b.cacheRead > maxCacheRead) maxCacheRead = b.cacheRead;
      if (b.costUsd > maxCost) maxCost = b.costUsd;
      totalFresh += fresh;
      totalCacheRead += b.cacheRead;
      totalCostUsd += b.costUsd;
    }

    return { range, buckets, maxFresh, maxCacheRead, maxCost, totalFresh, totalCacheRead, totalCostUsd, queriedAt: now };
  }

  getGuardrails(range: GuardrailsAnalyticsRange): GuardrailsAnalyticsPayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);

    const rows = this.db.query<{
      tool_id: string;
      decision: string;
      rule_ids: string;
      rule_messages: string;
    }>(
      `SELECT tool_id, decision, rule_ids, rule_messages
         FROM guardrail_events
        WHERE ts >= ?`,
      [startMs],
    );

    let total = 0;
    let warn  = 0;
    let block = 0;
    const byToolMap = new Map<string, GuardrailToolCount>();
    const byRuleMap = new Map<string, GuardrailRuleCount>();

    for (const r of rows) {
      total += 1;
      if (r.decision === 'warn')  warn  += 1;
      if (r.decision === 'block') block += 1;

      const toolEntry = byToolMap.get(r.tool_id) ?? {
        toolId: r.tool_id as ToolId,
        total: 0,
        warn: 0,
        block: 0,
      };
      toolEntry.total += 1;
      if (r.decision === 'warn')  toolEntry.warn  += 1;
      if (r.decision === 'block') toolEntry.block += 1;
      byToolMap.set(r.tool_id, toolEntry);

      // rule_messages: JSON.stringify([{ ruleId, message }, ...]). Fall back to
      // rule_ids if the JSON is malformed (older rows or a write error) so the
      // count is still correct even when the human-readable text is missing.
      let matched: Array<{ ruleId: string; message: string }> = [];
      try {
        const parsed = JSON.parse(r.rule_messages);
        if (Array.isArray(parsed)) matched = parsed;
      } catch {
        matched = r.rule_ids.split(',').filter(Boolean).map((id) => ({ ruleId: id, message: id }));
      }
      for (const m of matched) {
        const ruleEntry = byRuleMap.get(m.ruleId) ?? {
          ruleId: m.ruleId,
          message: m.message ?? m.ruleId,
          count: 0,
        };
        ruleEntry.count += 1;
        byRuleMap.set(m.ruleId, ruleEntry);
      }
    }

    const byTool = Array.from(byToolMap.values()).sort((a, b) => b.total - a.total);
    const byRule = Array.from(byRuleMap.values()).sort((a, b) => b.count - a.count);

    return { range, total, warn, block, byTool, byRule, queriedAt: now };
  }

  // Secret Protection analytics — same aggregation as getGuardrails over the
  // secret_access_events table, plus a per-file count so the card can show
  // which protected files agents keep trying to read.
  getSecretAccess(range: GuardrailsAnalyticsRange): SecretAccessAnalyticsPayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);

    const rows = this.db.query<{
      tool_id: string;
      decision: string;
      file_path: string;
      rule_ids: string;
      rule_messages: string;
    }>(
      `SELECT tool_id, decision, file_path, rule_ids, rule_messages
         FROM secret_access_events
        WHERE ts >= ?`,
      [startMs],
    );

    let total = 0;
    let warn  = 0;
    let block = 0;
    const byToolMap = new Map<string, GuardrailToolCount>();
    const byRuleMap = new Map<string, GuardrailRuleCount>();
    const byFileMap = new Map<string, SecretAccessFileCount>();

    for (const r of rows) {
      total += 1;
      if (r.decision === 'warn')  warn  += 1;
      if (r.decision === 'block') block += 1;

      const toolEntry = byToolMap.get(r.tool_id) ?? {
        toolId: r.tool_id as ToolId,
        total: 0,
        warn: 0,
        block: 0,
      };
      toolEntry.total += 1;
      if (r.decision === 'warn')  toolEntry.warn  += 1;
      if (r.decision === 'block') toolEntry.block += 1;
      byToolMap.set(r.tool_id, toolEntry);

      const fileEntry = byFileMap.get(r.file_path) ?? { filePath: r.file_path, count: 0 };
      fileEntry.count += 1;
      byFileMap.set(r.file_path, fileEntry);

      // rule_messages: JSON.stringify([{ ruleId, message }, ...]) — same
      // fallback-to-rule_ids handling as getGuardrails.
      let matched: Array<{ ruleId: string; message: string }> = [];
      try {
        const parsed = JSON.parse(r.rule_messages);
        if (Array.isArray(parsed)) matched = parsed;
      } catch {
        matched = r.rule_ids.split(',').filter(Boolean).map((id) => ({ ruleId: id, message: id }));
      }
      for (const m of matched) {
        const ruleEntry = byRuleMap.get(m.ruleId) ?? {
          ruleId: m.ruleId,
          message: m.message ?? m.ruleId,
          count: 0,
        };
        ruleEntry.count += 1;
        byRuleMap.set(m.ruleId, ruleEntry);
      }
    }

    const byTool = Array.from(byToolMap.values()).sort((a, b) => b.total - a.total);
    const byRule = Array.from(byRuleMap.values()).sort((a, b) => b.count - a.count);
    const byFile = Array.from(byFileMap.values()).sort((a, b) => b.count - a.count);

    return { range, total, warn, block, byTool, byRule, byFile, queriedAt: now };
  }

  // Session-limit hits — how often an agent told the user they'd hit a usage
  // limit, from the limit_events table (populated by the transcript reader and
  // the one-time backfill scan). Totals + per-kind split for the window, a
  // per-day series for the trend bars, and the most-recent hit across all time.
  getLimitHits(range: LimitHitsRange): LimitHitsPayload {
    const now = Date.now();
    const dayStart = startOfLocalDay(now);
    // Inclusive day window: e.g. 7d = today + the 6 prior days.
    const days = rangeDays(range);
    const windowStart = dayStart - (days - 1) * DAY_MS;

    const rows = this.db.query<{ ts: number; kind: string }>(
      `SELECT ts, kind FROM limit_events WHERE ts >= ? ORDER BY ts`,
      [windowStart],
    );

    const kindOrder: LimitHitKind[] = ['session', 'weekly', 'usage', 'other'];
    const byKindMap = new Map<LimitHitKind, number>();
    // Pre-seed every local day in the window so the trend bars are gap-free.
    const byDayMap = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      byDayMap.set(formatLocalDate(windowStart + i * DAY_MS), 0);
    }

    for (const r of rows) {
      const kind = (kindOrder.includes(r.kind as LimitHitKind) ? r.kind : 'other') as LimitHitKind;
      byKindMap.set(kind, (byKindMap.get(kind) ?? 0) + 1);
      const key = formatLocalDate(r.ts);
      if (byDayMap.has(key)) byDayMap.set(key, (byDayMap.get(key) ?? 0) + 1);
    }

    const byKind = kindOrder
      .filter((k) => (byKindMap.get(k) ?? 0) > 0)
      .map((k) => ({ kind: k, count: byKindMap.get(k) ?? 0 }));
    const byDay = Array.from(byDayMap.entries()).map(([date, count]) => ({ date, count }));

    const lastRow = this.db.query<{ ts: number }>(
      `SELECT ts FROM limit_events ORDER BY ts DESC LIMIT 1`,
    )[0];

    return {
      range,
      total: rows.length,
      byKind,
      byDay,
      lastHitAt: lastRow?.ts ?? null,
      queriedAt: now,
    };
  }

  // Latest statusline sample per session within the range. Shared by the two
  // statusline-feed cards: statusline_samples rows are throttled snapshots, and
  // per-session stats (hit ratio, misses, context %) are running values where
  // only the newest sample matters.
  private latestStatuslineSamples(startMs: number): Array<{
    session_id: string; model: string | null; sampled_at: number;
    cost_usd: number | null; context_used_pct: number | null;
    cache_warm: number | null; cache_hit_ratio: number | null; cache_misses: number | null;
  }> {
    return this.db.query(
      `SELECT s.session_id, s.model, s.sampled_at, s.cost_usd, s.context_used_pct,
              s.cache_warm, s.cache_hit_ratio, s.cache_misses
       FROM statusline_samples s
       JOIN (
         SELECT session_id, MAX(sampled_at) AS latest
         FROM statusline_samples
         WHERE sampled_at >= ?
         GROUP BY session_id
       ) t ON s.session_id = t.session_id AND s.sampled_at = t.latest
       ORDER BY s.sampled_at DESC`,
      [startMs],
    );
  }

  getCacheHealth(range: CacheHealthRange): CacheHealthPayload {
    const now = Date.now();
    const dayStart = startOfLocalDay(now);
    const days = rangeDays(range);
    const windowStart = dayStart - (days - 1) * DAY_MS;

    const latest = this.latestStatuslineSamples(windowStart)
      .filter((r) => r.cache_hit_ratio !== null || r.cache_warm !== null || r.cache_misses !== null);

    const rows: CacheHealthSessionRow[] = latest.slice(0, 8).map((r) => ({
      sessionId: r.session_id,
      ...this.statuslineSessionLabel(r.session_id),
      model: r.model,
      hitRatio: r.cache_hit_ratio,
      warm: r.cache_warm === null ? null : r.cache_warm === 1,
      misses: r.cache_misses,
      lastSampledAt: r.sampled_at,
    }));

    const ratios = latest.map((r) => r.cache_hit_ratio).filter((v): v is number => v !== null);
    const warms = latest.map((r) => r.cache_warm).filter((v): v is number => v !== null);
    const totalMisses = latest.reduce((s, r) => s + (r.cache_misses ?? 0), 0);

    // Day-bucketed average hit ratio over ALL samples (not just latest), so
    // the trend reflects intra-day movement. Pre-seeded for gap-free bars.
    const byDayMap = new Map<string, { sum: number; n: number }>();
    for (let i = 0; i < days; i++) byDayMap.set(formatLocalDate(windowStart + i * DAY_MS), { sum: 0, n: 0 });
    const samples = this.db.query<{ sampled_at: number; cache_hit_ratio: number }>(
      `SELECT sampled_at, cache_hit_ratio FROM statusline_samples
       WHERE sampled_at >= ? AND cache_hit_ratio IS NOT NULL`,
      [windowStart],
    );
    for (const s of samples) {
      const key = formatLocalDate(s.sampled_at);
      const acc = byDayMap.get(key);
      if (acc) { acc.sum += s.cache_hit_ratio; acc.n += 1; }
    }
    const byDay = Array.from(byDayMap.entries()).map(([date, a]) => ({
      date,
      avgHitRatio: a.n > 0 ? a.sum / a.n : null,
      samples: a.n,
    }));

    return {
      range,
      rows,
      avgHitRatio: ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null,
      warmPct: warms.length ? (warms.filter((w) => w === 1).length / warms.length) * 100 : null,
      totalMisses,
      sessions: latest.length,
      byDay,
      queriedAt: now,
    };
  }

  getContextPressure(range: ContextPressureRange): ContextPressurePayload {
    const now = Date.now();
    const dayStart = startOfLocalDay(now);
    const days = rangeDays(range);
    const windowStart = dayStart - (days - 1) * DAY_MS;

    const latest = this.latestStatuslineSamples(windowStart)
      .filter((r) => r.context_used_pct !== null);

    const rows: ContextPressureSessionRow[] = latest.slice(0, 8).map((r) => ({
      sessionId: r.session_id,
      ...this.statuslineSessionLabel(r.session_id),
      model: r.model,
      usedPct: r.context_used_pct as number,
      sampledAt: r.sampled_at,
    }));

    const pcts = latest.map((r) => r.context_used_pct as number);

    const byDayMap = new Map<string, { sum: number; max: number; n: number }>();
    for (let i = 0; i < days; i++) byDayMap.set(formatLocalDate(windowStart + i * DAY_MS), { sum: 0, max: 0, n: 0 });
    const samples = this.db.query<{ sampled_at: number; context_used_pct: number }>(
      `SELECT sampled_at, context_used_pct FROM statusline_samples
       WHERE sampled_at >= ? AND context_used_pct IS NOT NULL`,
      [windowStart],
    );
    for (const s of samples) {
      const key = formatLocalDate(s.sampled_at);
      const acc = byDayMap.get(key);
      if (acc) { acc.sum += s.context_used_pct; acc.max = Math.max(acc.max, s.context_used_pct); acc.n += 1; }
    }
    const byDay = Array.from(byDayMap.entries()).map(([date, a]) => ({
      date,
      avgUsedPct: a.n > 0 ? a.sum / a.n : null,
      maxUsedPct: a.n > 0 ? a.max : null,
    }));

    return {
      range,
      rows,
      avgUsedPct: pcts.length ? pcts.reduce((s, v) => s + v, 0) / pcts.length : null,
      maxUsedPct: pcts.length ? Math.max(...pcts) : null,
      highPressureSessions: pcts.filter((p) => p >= 80).length,
      byDay,
      queriedAt: now,
    };
  }

  // Agent actions — what agents spend their tool calls on. Reads the tool name
  // every before-tool hook leaves in `task_summary` ("Tool: <name>"). Only
  // `working` rows count: after-tool events are stored as idle and permission
  // prompts as waiting, and both repeat the same tool name.
  getActionMix(range: ActionMixRange): ActionMixPayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);
    const TOOL_ROW = `timestamp >= ? AND state = 'working' AND task_summary LIKE 'Tool: %'`;

    // agent → tool name → calls
    const byAgent = new Map<string, Map<string, number>>();
    const grouped = this.db.query<{ tool_id: string; name: string; n: number }>(
      `SELECT tool_id, substr(task_summary, 7) AS name, COUNT(*) AS n
         FROM events
        WHERE ${TOOL_ROW}
        GROUP BY tool_id, name`,
      [startMs],
    );
    for (const r of grouped) {
      if (!r.name) continue;
      const names = byAgent.get(r.tool_id) ?? new Map<string, number>();
      names.set(r.name, r.n);
      byAgent.set(r.tool_id, names);
    }

    // Agents that log each call twice: recount from the ordered rows, pairing
    // each before-event with its after-event. (Calls an agent issues in
    // parallel interleave and stay unpaired, so those still count twice.)
    for (const toolId of byAgent.keys()) {
      if (!DOUBLE_REPORTING_AGENTS.has(toolId as ToolId)) continue;
      const ordered = this.db.query<{ session_id: string | null; name: string }>(
        `SELECT session_id, substr(task_summary, 7) AS name
           FROM events
          WHERE ${TOOL_ROW} AND tool_id = ?
          ORDER BY session_id, timestamp, id`,
        [startMs, toolId],
      );
      byAgent.set(toolId, countPairedToolCalls(
        ordered.filter((r) => r.name).map((r) => ({ sessionId: r.session_id, name: r.name })),
      ));
    }

    const toCategoryCounts = (perCategory: Map<ActionCategory, number>, total: number): ActionMixCategoryCount[] =>
      ACTION_CATEGORIES
        .filter((c) => (perCategory.get(c) ?? 0) > 0)
        .map((c) => {
          const calls = perCategory.get(c) ?? 0;
          return { category: c, calls, pct: total > 0 ? (calls / total) * 100 : 0 };
        });

    const overall = new Map<ActionCategory, number>();
    let totalCalls = 0;
    const agents: ActionMixAgentRow[] = [];
    for (const [toolId, names] of byAgent) {
      const perCategory = new Map<ActionCategory, number>();
      const tools: ActionMixToolCount[] = [];
      let calls = 0;
      for (const [name, n] of names) {
        const category = classifyToolName(name);
        perCategory.set(category, (perCategory.get(category) ?? 0) + n);
        overall.set(category, (overall.get(category) ?? 0) + n);
        tools.push({ name, category, calls: n });
        calls += n;
      }
      if (calls === 0) continue;
      totalCalls += calls;
      tools.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
      agents.push({
        toolId: toolId as ToolId,
        calls,
        categories: toCategoryCounts(perCategory, calls),
        topTools: tools.slice(0, 5),
      });
    }
    agents.sort((a, b) => b.calls - a.calls);

    return {
      range,
      totalCalls,
      categories: toCategoryCounts(overall, totalCalls),
      agents,
      queriedAt: now,
    };
  }

  // ─── Activity facts ────────────────────────────────────────────────────
  // The three cards below read activity_facts. They share an inclusive
  // local-day window so the day-bucketed charts line up with the totals.
  private activityWindow(range: ActivityRange): { now: number; windowStart: number; days: number } {
    const now = Date.now();
    const days = rangeDays(range);
    return { now, days, windowStart: startOfLocalDay(now) - (days - 1) * DAY_MS };
  }

  // Prompt size — how much the user writes per prompt, in words.
  getPromptSize(range: ActivityRange): PromptSizePayload {
    const { now, windowStart } = this.activityWindow(range);
    const rows = this.db.query<{ tool_id: string; words: number | null }>(
      `SELECT tool_id, words FROM activity_facts WHERE kind = 'prompt' AND ts >= ?`,
      [windowStart],
    );

    const bounds: Array<{ label: string; max: number }> = [
      { label: '1–10', max: 10 }, { label: '11–25', max: 25 }, { label: '26–50', max: 50 },
      { label: '51–100', max: 100 }, { label: '101–250', max: 250 }, { label: '250+', max: Infinity },
    ];
    const bucketCounts = bounds.map(() => 0);
    const all: number[] = [];
    const perAgent = new Map<string, number[]>();
    let imageOnly = 0;
    for (const r of rows) {
      const words = r.words ?? 0;
      if (words <= 0) { imageOnly++; continue; }
      all.push(words);
      const list = perAgent.get(r.tool_id) ?? [];
      list.push(words);
      perAgent.set(r.tool_id, list);
      bucketCounts[bounds.findIndex((b) => words <= b.max)]++;
    }

    const stats = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((s, v) => s + v, 0);
      return {
        median: median(sorted),
        avg: sorted.length > 0 ? sum / sorted.length : 0,
        max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      };
    };
    const overall = stats(all);
    const agents: PromptSizeAgentRow[] = Array.from(perAgent.entries())
      .map(([toolId, values]) => {
        const s = stats(values);
        return { toolId: toolId as ToolId, prompts: values.length, medianWords: s.median, avgWords: s.avg };
      })
      .sort((a, b) => b.prompts - a.prompts);

    return {
      range,
      prompts: all.length,
      imageOnlyPrompts: imageOnly,
      medianWords: overall.median,
      avgWords: overall.avg,
      longestWords: overall.max,
      buckets: bounds.map((b, i) => ({ label: b.label, count: bucketCounts[i] })),
      agents,
      queriedAt: now,
    };
  }

  // Lines changed — what agents' edit calls added and removed.
  getLinesChanged(range: ActivityRange): LinesChangedPayload {
    const { now, windowStart, days } = this.activityWindow(range);
    const rows = this.db.query<{ tool_id: string; ts: number; added: number | null; removed: number | null }>(
      `SELECT tool_id, ts, lines_added AS added, lines_removed AS removed
         FROM activity_facts WHERE kind = 'edit' AND ts >= ?`,
      [windowStart],
    );

    const byDayMap = new Map<string, { added: number; removed: number }>();
    for (let i = 0; i < days; i++) byDayMap.set(formatLocalDate(windowStart + i * DAY_MS), { added: 0, removed: 0 });
    const perAgent = new Map<string, LinesChangedAgentRow>();
    let added = 0;
    let removed = 0;
    for (const r of rows) {
      const a = r.added ?? 0;
      const d = r.removed ?? 0;
      added += a;
      removed += d;
      const agent = perAgent.get(r.tool_id) ?? { toolId: r.tool_id as ToolId, edits: 0, added: 0, removed: 0 };
      agent.edits += 1;
      agent.added += a;
      agent.removed += d;
      perAgent.set(r.tool_id, agent);
      const day = byDayMap.get(formatLocalDate(r.ts));
      if (day) { day.added += a; day.removed += d; }
    }

    return {
      range,
      edits: rows.length,
      added,
      removed,
      agents: Array.from(perAgent.values()).sort((x, y) => (y.added + y.removed) - (x.added + x.removed)),
      byDay: Array.from(byDayMap.entries()).map(([date, v]) => ({ date, ...v })),
      queriedAt: now,
    };
  }

  // Subagent use — how often work was delegated, and in how many sessions.
  // Codex auto-reviews are reported alongside but never counted as launches.
  getSubagentUse(range: ActivityRange): SubagentUsePayload {
    const { now, windowStart, days } = this.activityWindow(range);

    const perAgentRows = this.db.query<{
      tool_id: string; launches: number; auto_reviews: number; sessions: number; sessions_with: number;
    }>(
      `SELECT tool_id,
              SUM(kind = 'subagent')    AS launches,
              SUM(kind = 'auto_review') AS auto_reviews,
              COUNT(DISTINCT session_id) AS sessions,
              COUNT(DISTINCT CASE WHEN kind = 'subagent' THEN session_id END) AS sessions_with
         FROM activity_facts
        WHERE ts >= ?
        GROUP BY tool_id`,
      [windowStart],
    );
    const agents: SubagentAgentRow[] = perAgentRows
      .map((r) => ({
        toolId: r.tool_id as ToolId,
        launches: r.launches ?? 0,
        sessionsWithSubagents: r.sessions_with ?? 0,
        sessions: r.sessions ?? 0,
        autoReviews: r.auto_reviews ?? 0,
      }))
      .sort((a, b) => b.launches - a.launches || b.sessions - a.sessions);

    const byDayMap = new Map<string, number>();
    for (let i = 0; i < days; i++) byDayMap.set(formatLocalDate(windowStart + i * DAY_MS), 0);
    const launchRows = this.db.query<{ ts: number }>(
      `SELECT ts FROM activity_facts WHERE kind = 'subagent' AND ts >= ?`,
      [windowStart],
    );
    for (const r of launchRows) {
      const key = formatLocalDate(r.ts);
      if (byDayMap.has(key)) byDayMap.set(key, (byDayMap.get(key) ?? 0) + 1);
    }

    const sum = (pick: (a: SubagentAgentRow) => number) => agents.reduce((s, a) => s + pick(a), 0);
    return {
      range,
      launches: sum((a) => a.launches),
      sessionsWithSubagents: sum((a) => a.sessionsWithSubagents),
      sessions: sum((a) => a.sessions),
      autoReviews: sum((a) => a.autoReviews),
      agents,
      byDay: Array.from(byDayMap.entries()).map(([date, launches]) => ({ date, launches })),
      queriedAt: now,
    };
  }

  getWindowValue(toolId: ToolId = 'claude-code'): WindowValuePayload {
    const now = Date.now();
    const start7d = now - 7 * DAY_MS;
    const start5h = now - 5 * HOUR_MS;
    const start1h = now - HOUR_MS;

    const rows = this.db.query<SessionAggregateRow>(
      `SELECT started_at, models_used,
              total_tokens_in, total_tokens_out, total_cache_read, total_cache_write
       FROM sessions WHERE tool_id = ? AND started_at >= ?`,
      [toolId, start7d],
    );

    const blank = (windowKey: '5h' | '7d'): WindowValueSlice => ({
      windowKey, costUsd: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, sessions: 0,
      costBreakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    });
    const last5h = blank('5h');
    const last7d = blank('7d');
    let cost1h = 0;

    for (const r of rows) {
      const tokens: TokenCounts = {
        tokensIn: r.total_tokens_in, tokensOut: r.total_tokens_out,
        cacheRead: r.total_cache_read, cacheWrite: r.total_cache_write,
      };
      const breakdown = this.breakdownForSession(r.models_used, tokens);
      const cost = breakdown.input + breakdown.output + breakdown.cacheWrite + breakdown.cacheRead;

      const addTo = (slice: WindowValueSlice) => {
        slice.costUsd    += cost;
        slice.tokensIn   += r.total_tokens_in   ?? 0;
        slice.tokensOut  += r.total_tokens_out  ?? 0;
        slice.cacheRead  += r.total_cache_read  ?? 0;
        slice.cacheWrite += r.total_cache_write ?? 0;
        slice.sessions   += 1;
        slice.costBreakdown.input      += breakdown.input;
        slice.costBreakdown.output     += breakdown.output;
        slice.costBreakdown.cacheWrite += breakdown.cacheWrite;
        slice.costBreakdown.cacheRead  += breakdown.cacheRead;
      };
      addTo(last7d);
      if (r.started_at >= start5h) addTo(last5h);
      if (r.started_at >= start1h) cost1h += cost;
    }

    const burnRateUsdPerHour = cost1h; // cost1h spans exactly one hour
    return {
      toolId,
      last5h,
      last7d,
      burnRateUsdPerHour,
      projected5hUsd: burnRateUsdPerHour * 5,
      queriedAt: now,
    };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private digestForDay(startMs: number, endMs: number): DailyDigest {
    const sessions = this.db.query<SessionAggregateRow>(
      `SELECT tool_id, started_at, ended_at, total_tokens_in, total_tokens_out,
              total_cache_read, total_cache_write, task_summary, models_used
       FROM sessions WHERE ended_at >= ? AND started_at < ?`,
      [startMs, endMs],
    );

    let totalActiveMs = 0;
    const perToolMap = new Map<ToolId, ToolBreakdown>();
    const tokens: TokenTotals = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
    let anyTokens = false;

    for (const s of sessions) {
      const duration = Math.max(0, s.ended_at - s.started_at);
      totalActiveMs += duration;
      const existing = perToolMap.get(s.tool_id as ToolId) ?? {
        toolId: s.tool_id as ToolId,
        activeMs: 0,
        sessions: 0,
        longestSessionMs: 0,
        topTask: null,
      };
      existing.activeMs += duration;
      existing.sessions += 1;
      if (duration > existing.longestSessionMs) {
        existing.longestSessionMs = duration;
        existing.topTask = s.task_summary;
      }
      perToolMap.set(s.tool_id as ToolId, existing);

      if (s.total_tokens_in   != null) { tokens.tokensIn   += s.total_tokens_in;   anyTokens = true; }
      if (s.total_tokens_out  != null) { tokens.tokensOut  += s.total_tokens_out;  anyTokens = true; }
      if (s.total_cache_read  != null) { tokens.cacheRead  += s.total_cache_read;  anyTokens = true; }
      if (s.total_cache_write != null) { tokens.cacheWrite += s.total_cache_write; anyTokens = true; }
      tokens.costUsd += this.costForSession(s.models_used, {
        tokensIn: s.total_tokens_in, tokensOut: s.total_tokens_out,
        cacheRead: s.total_cache_read, cacheWrite: s.total_cache_write,
      }).costUsd;
    }

    // Quota deltas: take first + last sample per (tool, window) in the day.
    const quotaRows = this.db.query<{
      tool_id: string;
      window_key: string;
      first_pct: number;
      last_pct: number;
    }>(
      `SELECT tool_id, window_key,
              (SELECT pct_remaining FROM quota_samples q2
                WHERE q2.tool_id = q.tool_id AND q2.window_key = q.window_key
                  AND q2.sampled_at >= ? AND q2.sampled_at < ?
                ORDER BY q2.sampled_at ASC LIMIT 1) AS first_pct,
              (SELECT pct_remaining FROM quota_samples q3
                WHERE q3.tool_id = q.tool_id AND q3.window_key = q.window_key
                  AND q3.sampled_at >= ? AND q3.sampled_at < ?
                ORDER BY q3.sampled_at DESC LIMIT 1) AS last_pct
       FROM quota_samples q
       WHERE q.sampled_at >= ? AND q.sampled_at < ?
       GROUP BY q.tool_id, q.window_key`,
      [startMs, endMs, startMs, endMs, startMs, endMs],
    );

    const quota: QuotaDelta[] = quotaRows.map((q) => ({
      toolId: q.tool_id as ToolId,
      windowKey: q.window_key,
      startPct: q.first_pct ?? null,
      endPct: q.last_pct ?? null,
      deltaPct: (q.first_pct != null && q.last_pct != null) ? (q.first_pct - q.last_pct) : null,
    }));

    return {
      date: formatLocalDate(startMs),
      totalActiveMs,
      perTool: Array.from(perToolMap.values()).sort((a, b) => b.activeMs - a.activeMs),
      tokens: anyTokens ? tokens : null,
      quota,
    };
  }
}

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
  ToolMixPayload,
  ToolMixRange,
  ModelUsagePayload,
  ModelUsageRow,
  ModelUsageRange,
  ProjectBreakdownPayload,
  ProjectBreakdownRange,
  ProjectBreakdownRow,
} from '../../common/timeline-types';

const DAY_MS = 24 * 60 * 60 * 1000;

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

function rangeMs(range: '7d' | '30d' | '90d'): number {
  if (range === '7d')  return 7  * DAY_MS;
  if (range === '30d') return 30 * DAY_MS;
  return 90 * DAY_MS;
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
  constructor(private db: TimelineDb) {}

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
    const dayCount = range === '90d' ? 90 : 30;
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

  getHourRhythm(range: '7d' | '30d'): HourRhythmPayload {
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
    const rows = this.db.query<{ tool_id: string; total: number }>(
      `SELECT tool_id, SUM(ended_at - started_at) as total
       FROM sessions WHERE ended_at >= ? GROUP BY tool_id`,
      [startMs],
    );
    const totalActiveMs = rows.reduce((sum, r) => sum + (r.total ?? 0), 0);
    const slices = rows.map((r) => ({
      toolId: r.tool_id as ToolId,
      activeMs: r.total ?? 0,
      pct: totalActiveMs > 0 ? ((r.total ?? 0) / totalActiveMs) * 100 : 0,
    })).sort((a, b) => b.activeMs - a.activeMs);
    return { range, slices, totalActiveMs, queriedAt: now };
  }

  getModelUsage(range: ModelUsageRange, mode: 'tokens' | 'sessions'): ModelUsagePayload {
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
      const models = row.models_used.split(',').filter(Boolean);
      if (models.length === 0) continue;
      const share = 1 / models.length;
      for (const model of models) {
        const existing: ModelUsageRow = perModel.get(model) ?? {
          model,
          toolId: row.tool_id as ToolId,
          tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, sessions: 0,
        };
        existing.tokensIn   += (row.total_tokens_in   ?? 0) * share;
        existing.tokensOut  += (row.total_tokens_out  ?? 0) * share;
        existing.cacheRead  += (row.total_cache_read  ?? 0) * share;
        existing.cacheWrite += (row.total_cache_write ?? 0) * share;
        existing.sessions   += 1;
        perModel.set(model, existing);
      }
    }

    const rows = Array.from(perModel.values()).map((r) => ({
      ...r,
      tokensIn:   Math.round(r.tokensIn),
      tokensOut:  Math.round(r.tokensOut),
      cacheRead:  Math.round(r.cacheRead),
      cacheWrite: Math.round(r.cacheWrite),
    }));

    const totalTokens = rows.reduce((s, r) => s + r.tokensIn + r.tokensOut, 0);
    const totalSessions = rows.reduce((s, r) => s + r.sessions, 0);

    rows.sort((a, b) =>
      mode === 'tokens'
        ? (b.tokensIn + b.tokensOut) - (a.tokensIn + a.tokensOut)
        : b.sessions - a.sessions,
    );

    return { range, mode, rows, totalTokens, totalSessions, queriedAt: now };
  }

  getProjectBreakdown(range: ProjectBreakdownRange): ProjectBreakdownPayload {
    const now = Date.now();
    const startMs = now - rangeMs(range);
    const rows = this.db.query<SessionAggregateRow>(
      `SELECT tool_id, project_id, project_path, started_at, ended_at
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
      };
      existing.activeMs += duration;
      existing.sessions += 1;
      if (!existing.tools.includes(r.tool_id as ToolId)) {
        existing.tools.push(r.tool_id as ToolId);
      }
      byProject.set(r.project_id, existing);
    }
    const ranked = Array.from(byProject.values()).sort((a, b) => b.activeMs - a.activeMs);
    return { range, rows: ranked, queriedAt: now };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private digestForDay(startMs: number, endMs: number): DailyDigest {
    const sessions = this.db.query<SessionAggregateRow>(
      `SELECT tool_id, started_at, ended_at, total_tokens_in, total_tokens_out,
              total_cache_read, total_cache_write, task_summary
       FROM sessions WHERE ended_at >= ? AND started_at < ?`,
      [startMs, endMs],
    );

    let totalActiveMs = 0;
    const perToolMap = new Map<ToolId, ToolBreakdown>();
    const tokens: TokenTotals = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 };
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

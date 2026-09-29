import path from 'path';
import { app } from 'electron';
import { logger } from '../../common/logger';

// `better-sqlite3` is a native module that must be rebuilt against Electron's
// ABI. If the rebuild step hasn't run (fresh `npm install`, missing toolchain
// on Windows, ABI mismatch after Electron upgrade), `require` throws. We
// catch it so the rest of the app keeps working — the timeline simply
// no-ops until the user runs `npm run rebuild:native`.
//
// Minimal structural types instead of `import('better-sqlite3')` so this file
// type-checks even when @types/better-sqlite3 hasn't been installed yet.
interface Statement {
  run: (params?: unknown) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}
interface Database {
  prepare: (sql: string) => Statement;
  exec: (sql: string) => void;
  pragma: (sql: string) => unknown;
  close: () => void;
}
type DatabaseConstructor = new (path: string) => Database;

const SCHEMA_VERSION = 6;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id       TEXT    NOT NULL,
  state         TEXT    NOT NULL,
  timestamp     INTEGER NOT NULL,
  session_id    TEXT,
  agent_pid     INTEGER,
  task_summary  TEXT,
  active_agents INTEGER,
  project_id    TEXT,
  project_path  TEXT,
  model         TEXT,
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  cache_read    INTEGER,
  cache_write   INTEGER,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp         ON events (timestamp);
CREATE INDEX IF NOT EXISTS idx_events_tool_timestamp    ON events (tool_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_project_timestamp ON events (project_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_session_timestamp ON events (session_id, timestamp);

CREATE TABLE IF NOT EXISTS sessions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id            TEXT    NOT NULL,
  project_id         TEXT,
  project_path       TEXT,
  started_at         INTEGER NOT NULL,
  ended_at           INTEGER NOT NULL,
  turns              INTEGER NOT NULL DEFAULT 0,
  peak_state         TEXT    NOT NULL,
  task_summary       TEXT,
  had_error          INTEGER NOT NULL DEFAULT 0,
  session_id         TEXT,
  agent_pid          INTEGER,
  total_tokens_in    INTEGER,
  total_tokens_out   INTEGER,
  total_cache_read   INTEGER,
  total_cache_write  INTEGER,
  models_used        TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_started         ON sessions (started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_tool_started    ON sessions (tool_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_project_started ON sessions (project_id, started_at);

CREATE TABLE IF NOT EXISTS quota_samples (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_id       TEXT    NOT NULL,
  window_key    TEXT    NOT NULL,
  pct_remaining REAL    NOT NULL,
  resets_at     INTEGER NOT NULL,
  sampled_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quota_lookup ON quota_samples (tool_id, window_key, sampled_at);

CREATE TABLE IF NOT EXISTS guardrail_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  tool_id       TEXT    NOT NULL,
  decision      TEXT    NOT NULL,
  blockable     INTEGER NOT NULL,
  command       TEXT    NOT NULL,
  rule_ids      TEXT    NOT NULL,
  rule_messages TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guardrail_ts      ON guardrail_events (ts);
CREATE INDEX IF NOT EXISTS idx_guardrail_tool_ts ON guardrail_events (tool_id, ts);

CREATE TABLE IF NOT EXISTS secret_access_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  tool_id       TEXT    NOT NULL,
  decision      TEXT    NOT NULL,
  blockable     INTEGER NOT NULL,
  file_path     TEXT    NOT NULL,
  via_shell     INTEGER NOT NULL DEFAULT 0,
  rule_ids      TEXT    NOT NULL,
  rule_messages TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secret_access_ts      ON secret_access_events (ts);
CREATE INDEX IF NOT EXISTS idx_secret_access_tool_ts ON secret_access_events (tool_id, ts);

-- Usage-limit hits (v5). One row per "You've hit your … limit" notice Claude
-- Code writes into a transcript. Keyed on the transcript's per-message uuid so
-- the one-time backfill scan and the live tail reader can both insert the same
-- hit idempotently (INSERT OR IGNORE). Volume is tiny (a handful ever), so this
-- table is not pruned.
CREATE TABLE IF NOT EXISTS limit_events (
  uuid       TEXT PRIMARY KEY,
  ts         INTEGER NOT NULL,
  tool_id    TEXT    NOT NULL,
  session_id TEXT,
  kind       TEXT    NOT NULL,
  reset_text TEXT
);

CREATE INDEX IF NOT EXISTS idx_limit_ts ON limit_events (ts);

-- Claude Code statusline samples (v6). One row per session per throttle window
-- (see StatuslineWriter), carrying the cost/context/prompt-cache stats the
-- statusline feed reports. Quota from the same feed goes to quota_samples via
-- the UsagePoller, not here. Pruned on the quota retention cutoff.
CREATE TABLE IF NOT EXISTS statusline_samples (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       TEXT    NOT NULL,
  sampled_at       INTEGER NOT NULL,
  model            TEXT,
  cost_usd         REAL,
  context_used_pct REAL,
  cache_warm       INTEGER,
  cache_hit_ratio  REAL,
  cache_misses     INTEGER,
  cache_ttl_s      INTEGER,
  cache_expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_statusline_session ON statusline_samples (session_id, sampled_at);
CREATE INDEX IF NOT EXISTS idx_statusline_sampled ON statusline_samples (sampled_at);

-- Small key/value store for one-off migration/bootstrap markers (e.g. whether
-- the limit_events backfill scan has run). Avoids re-scanning every boot.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Persisted transcript read offsets. The TranscriptReader tracks how far it has
-- read each transcript/rollout file so reruns only consume the new tail.
-- Without persistence the in-memory map resets on every app restart, and the
-- first event after restart re-reads the whole file from byte 0 — re-summing
-- all historical usage and double-counting tokens. Persisting the offset makes
-- reads resume where they left off across restarts.
CREATE TABLE IF NOT EXISTS transcript_offsets (
  path           TEXT PRIMARY KEY,
  offset         INTEGER NOT NULL,
  session_id     TEXT,
  codex_snapshot TEXT
);
`;

export interface EventRow {
  toolId: string;
  state: string;
  timestamp: number;
  sessionId?: string | null;
  agentPid?: number | null;
  taskSummary?: string | null;
  activeAgents?: number | null;
  projectId?: string | null;
  projectPath?: string | null;
  model?: string | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  errorMessage?: string | null;
}

export interface SessionRow {
  toolId: string;
  projectId?: string | null;
  projectPath?: string | null;
  startedAt: number;
  endedAt: number;
  turns: number;
  peakState: string;
  taskSummary?: string | null;
  hadError: 0 | 1;
  sessionId?: string | null;
  agentPid?: number | null;
  totalTokensIn?: number | null;
  totalTokensOut?: number | null;
  totalCacheRead?: number | null;
  totalCacheWrite?: number | null;
  modelsUsed?: string | null;
}

export interface QuotaSampleRow {
  toolId: string;
  windowKey: string;
  pctRemaining: number;
  resetsAt: number;
  sampledAt: number;
}

export interface GuardrailEventRow {
  ts: number;
  toolId: string;
  decision: string;
  blockable: 0 | 1;
  command: string;
  ruleIds: string;       // comma-separated
  ruleMessages: string;  // JSON-encoded string[]
}

export interface SecretAccessEventRow {
  ts: number;
  toolId: string;
  decision: string;
  blockable: 0 | 1;
  filePath: string;
  viaShell: 0 | 1;
  ruleIds: string;       // comma-separated
  ruleMessages: string;  // JSON-encoded [{ ruleId, message }]
}

export interface LimitEventRow {
  uuid: string;
  ts: number;
  toolId: string;
  sessionId?: string | null;
  kind: string;
  resetText?: string | null;
}

export interface StatuslineSampleRow {
  sessionId: string;
  sampledAt: number;
  model?: string | null;
  costUsd?: number | null;
  contextUsedPct?: number | null;
  cacheWarm?: 0 | 1 | null;
  cacheHitRatio?: number | null;
  cacheMisses?: number | null;
  cacheTtlS?: number | null;
  cacheExpiresAt?: number | null;
}

export interface TranscriptOffsetRow {
  path: string;
  offset: number;
  sessionId?: string | null;
  codexSnapshot?: string | null; // JSON-encoded CodexSnapshot, or null
}

export interface TimelineDb {
  insertEvent: (row: EventRow) => void;
  insertSession: (row: SessionRow) => number;
  insertQuotaSample: (row: QuotaSampleRow) => void;
  insertStatuslineSample: (row: StatuslineSampleRow) => void;
  insertGuardrailEvent: (row: GuardrailEventRow) => void;
  insertSecretAccessEvent: (row: SecretAccessEventRow) => void;
  insertLimitEvent: (row: LimitEventRow) => void;
  getMeta: (key: string) => string | null;
  setMeta: (key: string, value: string) => void;
  loadTranscriptOffsets: () => TranscriptOffsetRow[];
  saveTranscriptOffset: (row: TranscriptOffsetRow) => void;
  prune: (
    eventsOlderThanMs: number,
    quotaOlderThanMs: number,
    guardrailOlderThanMs: number,
    secretOlderThanMs: number,
  ) => { eventsDeleted: number; quotaDeleted: number; guardrailDeleted: number; secretDeleted: number };
  query: <T = unknown>(sql: string, params?: unknown[]) => T[];
  close: () => void;
  raw: Database;
}

let cached: TimelineDb | null = null;
let initFailed = false;

/**
 * Open (and migrate) a Timeline DB at an explicit path. Returns null when
 * better-sqlite3 can't load or the DB can't be opened/migrated. Does NOT cache —
 * the caller owns the returned handle's lifecycle. `initTimelineDb` wraps this
 * for the app singleton; tests call it directly with ':memory:'.
 */
export function openTimelineDb(dbPath: string): TimelineDb | null {
  let Database: DatabaseConstructor;
  try {
    Database = require('better-sqlite3') as DatabaseConstructor;
  } catch (e: any) {
    logger.warn(
      '[Timeline] better-sqlite3 not loadable — Pulse Timeline disabled. ' +
      `Run \`npm run rebuild:native\` to rebuild it for Electron. (${e?.message ?? e})`,
    );
    return null;
  }

  let db: Database;
  try {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);

    const current = (db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version?: number } | undefined)?.version;
    if (current === undefined) {
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    } else if (current !== SCHEMA_VERSION) {
      // Every migration so far (through v5, which adds limit_events + meta) only
      // adds new tables (CREATE TABLE IF NOT EXISTS in SCHEMA_SQL already created
      // them above), so just bump the recorded version. The one-time limit-hit
      // backfill is triggered separately in bootTimeline via the `meta` marker,
      // not here. Future breaking migrations should branch on `current`.
      logger.info(`[Timeline] migrating schema_version ${current} → ${SCHEMA_VERSION}`);
      db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
    }
  } catch (e: any) {
    logger.error('[Timeline] failed to open or migrate DB:', e?.message ?? e);
    return null;
  }

  const insertEventStmt: Statement = db.prepare(`
    INSERT INTO events (
      tool_id, state, timestamp, session_id, agent_pid, task_summary,
      active_agents, project_id, project_path, model,
      tokens_in, tokens_out, cache_read, cache_write, error_message
    ) VALUES (
      @toolId, @state, @timestamp, @sessionId, @agentPid, @taskSummary,
      @activeAgents, @projectId, @projectPath, @model,
      @tokensIn, @tokensOut, @cacheRead, @cacheWrite, @errorMessage
    )
  `);

  const insertSessionStmt: Statement = db.prepare(`
    INSERT INTO sessions (
      tool_id, project_id, project_path, started_at, ended_at, turns,
      peak_state, task_summary, had_error, session_id, agent_pid,
      total_tokens_in, total_tokens_out, total_cache_read, total_cache_write,
      models_used
    ) VALUES (
      @toolId, @projectId, @projectPath, @startedAt, @endedAt, @turns,
      @peakState, @taskSummary, @hadError, @sessionId, @agentPid,
      @totalTokensIn, @totalTokensOut, @totalCacheRead, @totalCacheWrite,
      @modelsUsed
    )
  `);

  const insertQuotaStmt: Statement = db.prepare(`
    INSERT INTO quota_samples (tool_id, window_key, pct_remaining, resets_at, sampled_at)
    VALUES (@toolId, @windowKey, @pctRemaining, @resetsAt, @sampledAt)
  `);

  const insertStatuslineStmt: Statement = db.prepare(`
    INSERT INTO statusline_samples (
      session_id, sampled_at, model, cost_usd, context_used_pct,
      cache_warm, cache_hit_ratio, cache_misses, cache_ttl_s, cache_expires_at
    ) VALUES (
      @sessionId, @sampledAt, @model, @costUsd, @contextUsedPct,
      @cacheWarm, @cacheHitRatio, @cacheMisses, @cacheTtlS, @cacheExpiresAt
    )
  `);

  const insertGuardrailStmt: Statement = db.prepare(`
    INSERT INTO guardrail_events (
      ts, tool_id, decision, blockable, command, rule_ids, rule_messages
    ) VALUES (
      @ts, @toolId, @decision, @blockable, @command, @ruleIds, @ruleMessages
    )
  `);

  const insertSecretAccessStmt: Statement = db.prepare(`
    INSERT INTO secret_access_events (
      ts, tool_id, decision, blockable, file_path, via_shell, rule_ids, rule_messages
    ) VALUES (
      @ts, @toolId, @decision, @blockable, @filePath, @viaShell, @ruleIds, @ruleMessages
    )
  `);

  const insertLimitStmt: Statement = db.prepare(`
    INSERT OR IGNORE INTO limit_events (uuid, ts, tool_id, session_id, kind, reset_text)
    VALUES (@uuid, @ts, @toolId, @sessionId, @kind, @resetText)
  `);

  const getMetaStmt: Statement = db.prepare('SELECT value FROM meta WHERE key = ?');
  const setMetaStmt: Statement = db.prepare(
    'INSERT INTO meta (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );

  const selectOffsetsStmt: Statement = db.prepare(
    'SELECT path, offset, session_id AS sessionId, codex_snapshot AS codexSnapshot FROM transcript_offsets',
  );
  const upsertOffsetStmt: Statement = db.prepare(`
    INSERT INTO transcript_offsets (path, offset, session_id, codex_snapshot)
    VALUES (@path, @offset, @sessionId, @codexSnapshot)
    ON CONFLICT(path) DO UPDATE SET
      offset         = excluded.offset,
      session_id     = excluded.session_id,
      codex_snapshot = excluded.codex_snapshot
  `);

  const pruneEventsStmt: Statement    = db.prepare('DELETE FROM events WHERE timestamp < ?');
  const pruneQuotaStmt: Statement     = db.prepare('DELETE FROM quota_samples WHERE sampled_at < ?');
  const pruneStatuslineStmt: Statement = db.prepare('DELETE FROM statusline_samples WHERE sampled_at < ?');
  const pruneGuardrailStmt: Statement = db.prepare('DELETE FROM guardrail_events WHERE ts < ?');
  const pruneSecretStmt: Statement    = db.prepare('DELETE FROM secret_access_events WHERE ts < ?');

  // better-sqlite3 throws "Missing named parameter" if a bound object omits any
  // @named parameter the statement declares. Our row interfaces mark most fields
  // optional, so callers legitimately pass partial rows — fill every expected
  // key with null (and coerce explicit `undefined` to null) so those inserts
  // bind cleanly instead of throwing and getting swallowed.
  const normalize = (row: object, keys: readonly string[]): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = null;
    for (const [k, v] of Object.entries(row)) {
      out[k] = v === undefined ? null : v;
    }
    return out;
  };

  const EVENT_KEYS = [
    'toolId', 'state', 'timestamp', 'sessionId', 'agentPid', 'taskSummary',
    'activeAgents', 'projectId', 'projectPath', 'model',
    'tokensIn', 'tokensOut', 'cacheRead', 'cacheWrite', 'errorMessage',
  ] as const;
  const SESSION_KEYS = [
    'toolId', 'projectId', 'projectPath', 'startedAt', 'endedAt', 'turns',
    'peakState', 'taskSummary', 'hadError', 'sessionId', 'agentPid',
    'totalTokensIn', 'totalTokensOut', 'totalCacheRead', 'totalCacheWrite',
    'modelsUsed',
  ] as const;
  const QUOTA_KEYS = ['toolId', 'windowKey', 'pctRemaining', 'resetsAt', 'sampledAt'] as const;
  const STATUSLINE_KEYS = [
    'sessionId', 'sampledAt', 'model', 'costUsd', 'contextUsedPct',
    'cacheWarm', 'cacheHitRatio', 'cacheMisses', 'cacheTtlS', 'cacheExpiresAt',
  ] as const;
  const GUARDRAIL_KEYS = ['ts', 'toolId', 'decision', 'blockable', 'command', 'ruleIds', 'ruleMessages'] as const;
  const SECRET_KEYS = ['ts', 'toolId', 'decision', 'blockable', 'filePath', 'viaShell', 'ruleIds', 'ruleMessages'] as const;
  const LIMIT_KEYS = ['uuid', 'ts', 'toolId', 'sessionId', 'kind', 'resetText'] as const;
  const OFFSET_KEYS = ['path', 'offset', 'sessionId', 'codexSnapshot'] as const;

  return {
    insertEvent: (row) => {
      try { insertEventStmt.run(normalize(row, EVENT_KEYS)); }
      catch (e: any) { logger.warn('[Timeline] insertEvent failed:', e?.message ?? e); }
    },
    insertSession: (row) => {
      try {
        const info = insertSessionStmt.run(normalize(row, SESSION_KEYS));
        return Number(info.lastInsertRowid);
      } catch (e: any) {
        logger.warn('[Timeline] insertSession failed:', e?.message ?? e);
        return -1;
      }
    },
    insertQuotaSample: (row) => {
      try { insertQuotaStmt.run(normalize(row, QUOTA_KEYS)); }
      catch (e: any) { logger.warn('[Timeline] insertQuotaSample failed:', e?.message ?? e); }
    },
    insertStatuslineSample: (row) => {
      try { insertStatuslineStmt.run(normalize(row, STATUSLINE_KEYS)); }
      catch (e: any) { logger.warn('[Timeline] insertStatuslineSample failed:', e?.message ?? e); }
    },
    insertGuardrailEvent: (row) => {
      try { insertGuardrailStmt.run(normalize(row, GUARDRAIL_KEYS)); }
      catch (e: any) { logger.warn('[Timeline] insertGuardrailEvent failed:', e?.message ?? e); }
    },
    insertSecretAccessEvent: (row) => {
      try { insertSecretAccessStmt.run(normalize(row, SECRET_KEYS)); }
      catch (e: any) { logger.warn('[Timeline] insertSecretAccessEvent failed:', e?.message ?? e); }
    },
    insertLimitEvent: (row) => {
      try { insertLimitStmt.run(normalize(row, LIMIT_KEYS)); }
      catch (e: any) { logger.warn('[Timeline] insertLimitEvent failed:', e?.message ?? e); }
    },
    getMeta: (key) => {
      try { return ((getMetaStmt.get(key) as { value?: string } | undefined)?.value) ?? null; }
      catch (e: any) { logger.warn('[Timeline] getMeta failed:', e?.message ?? e); return null; }
    },
    setMeta: (key, value) => {
      try { setMetaStmt.run({ key, value }); }
      catch (e: any) { logger.warn('[Timeline] setMeta failed:', e?.message ?? e); }
    },
    loadTranscriptOffsets: () => {
      try { return selectOffsetsStmt.all() as TranscriptOffsetRow[]; }
      catch (e: any) { logger.warn('[Timeline] loadTranscriptOffsets failed:', e?.message ?? e); return []; }
    },
    saveTranscriptOffset: (row) => {
      try { upsertOffsetStmt.run(normalize(row, OFFSET_KEYS)); }
      catch (e: any) { logger.warn('[Timeline] saveTranscriptOffset failed:', e?.message ?? e); }
    },
    prune: (eventsOlderThanMs, quotaOlderThanMs, guardrailOlderThanMs, secretOlderThanMs) => {
      try {
        const evInfo = pruneEventsStmt.run(eventsOlderThanMs);
        const quInfo = pruneQuotaStmt.run(quotaOlderThanMs);
        // Statusline samples share the quota retention window (same cadence,
        // same purpose); their count isn't reported separately.
        pruneStatuslineStmt.run(quotaOlderThanMs);
        const grInfo = pruneGuardrailStmt.run(guardrailOlderThanMs);
        const seInfo = pruneSecretStmt.run(secretOlderThanMs);
        return {
          eventsDeleted:    Number(evInfo.changes),
          quotaDeleted:     Number(quInfo.changes),
          guardrailDeleted: Number(grInfo.changes),
          secretDeleted:    Number(seInfo.changes),
        };
      } catch (e: any) {
        logger.warn('[Timeline] prune failed:', e?.message ?? e);
        return { eventsDeleted: 0, quotaDeleted: 0, guardrailDeleted: 0, secretDeleted: 0 };
      }
    },
    query: <T = unknown>(sql: string, params: unknown[] = []) => {
      try {
        return db.prepare(sql).all(...params) as T[];
      } catch (e: any) {
        logger.warn('[Timeline] query failed:', e?.message ?? e, sql);
        return [];
      }
    },
    close: () => {
      try { db.close(); } catch { /* ignore */ }
    },
    raw: db,
  };
}

export function initTimelineDb(): TimelineDb | null {
  if (cached) return cached;
  if (initFailed) return null;

  const dbPath = path.join(app.getPath('userData'), 'pulse-timeline.db');
  logger.info(`[Timeline] opening database at ${dbPath}`);

  const db = openTimelineDb(dbPath);
  if (!db) {
    initFailed = true;
    return null;
  }
  cached = db;
  return cached;
}

export function getTimelineDb(): TimelineDb | null {
  return cached;
}

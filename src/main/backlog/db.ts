import path from 'path';
import { logger } from '../../common/logger';

// Backlog board storage — a SEPARATE SQLite file from pulse-timeline.db.
// The timeline DB is an append-only analytics log with aggressive pruning;
// the board is durable user data that must never be pruned, with its own
// migration cadence. A corrupt analytics DB must never take the board down.
//
// `better-sqlite3` is a native module rebuilt against Electron's ABI; if the
// rebuild hasn't run, `require` throws and the backlog feature no-ops (the
// board tab shows a clean unavailable state) — same posture as the timeline.
//
// Minimal structural types instead of `import('better-sqlite3')` so this file
// type-checks even when @types/better-sqlite3 hasn't been installed.
export interface Statement {
  run: (params?: unknown) => { changes: number | bigint; lastInsertRowid: number | bigint };
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}
export interface Database {
  prepare: (sql: string) => Statement;
  exec: (sql: string) => void;
  pragma: (sql: string) => unknown;
  close: () => void;
  transaction: (fn: (...args: any[]) => void) => (...args: any[]) => void;
}
type DatabaseConstructor = new (path: string) => Database;

// v2: cards.model — per-card model override for the executor's --model flag.
// v3: Phase 2 execution tasks — cards.task_type / worktree_path / base_sha /
//     qa_command (see backlog.md → Phase 2).
// v4: card_attachments — text files attached to a card, inlined into the
//     executor prompt so a card can carry uncommitted context (e.g. a plan
//     that isn't in the repo yet, invisible to the detached worktree).
const SCHEMA_VERSION = 4;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  path        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  project_id          TEXT NOT NULL REFERENCES projects(id),
  state               TEXT NOT NULL DEFAULT 'refinement',
  risk_tier           TEXT NOT NULL DEFAULT 'green',
  estimated_minutes   INTEGER,
  estimated_cost_usd  REAL,
  prereq_ids          TEXT NOT NULL DEFAULT '[]',
  qa_provider         TEXT NOT NULL DEFAULT 'none',
  acceptance_criteria TEXT NOT NULL DEFAULT '[]',
  sort_order          INTEGER NOT NULL DEFAULT 0,
  blocked_reason      TEXT,
  model               TEXT,
  task_type           TEXT NOT NULL DEFAULT 'research',
  worktree_path       TEXT,
  base_sha            TEXT,
  qa_command          TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_state_sort ON cards (state, sort_order);
CREATE INDEX IF NOT EXISTS idx_cards_project    ON cards (project_id);

CREATE TABLE IF NOT EXISTS attempts (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  outcome     TEXT,
  reason      TEXT,
  cost_usd    REAL,
  num_turns   INTEGER,
  session_id  TEXT,
  manual      INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_attempts_card ON attempts (card_id, started_at);

CREATE TABLE IF NOT EXISTS artifacts (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  attempt_id  TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'report',
  path        TEXT NOT NULL,
  preview     TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_card ON artifacts (card_id, created_at);

CREATE TABLE IF NOT EXISTS card_attachments (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  content     TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attachments_card ON card_attachments (card_id, created_at);
`;

/**
 * Open a backlog DB at `dbPath`, create/migrate the schema, and run crash
 * recovery. Always opens a fresh connection — unit tests pass ':memory:'.
 * Returns null when better-sqlite3 can't load or the file can't be opened.
 */
export function openBacklogDb(dbPath: string): Database | null {
  let Database: DatabaseConstructor;
  try {
    Database = require('better-sqlite3') as DatabaseConstructor;
  } catch (e: any) {
    logger.warn(
      '[Backlog] better-sqlite3 not loadable — Backlog board disabled. ' +
      `Run \`npm run rebuild:native\` to rebuild it for Electron. (${e?.message ?? e})`,
    );
    return null;
  }

  try {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);

    const current = (db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version?: number } | undefined)?.version;
    if (current === undefined) {
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
    } else if (current !== SCHEMA_VERSION) {
      logger.info(`[Backlog] migrating schema_version ${current} → ${SCHEMA_VERSION}`);
      // CREATE TABLE IF NOT EXISTS above doesn't touch existing tables, so
      // pre-existing boards need each version's columns added explicitly.
      if (current < 2) db.exec('ALTER TABLE cards ADD COLUMN model TEXT');
      if (current < 3) {
        db.exec("ALTER TABLE cards ADD COLUMN task_type TEXT NOT NULL DEFAULT 'research'");
        db.exec('ALTER TABLE cards ADD COLUMN worktree_path TEXT');
        db.exec('ALTER TABLE cards ADD COLUMN base_sha TEXT');
        db.exec('ALTER TABLE cards ADD COLUMN qa_command TEXT');
      }
      if (current < 4) {
        // CREATE TABLE IF NOT EXISTS in SCHEMA_SQL already ran above, so the
        // table exists — this branch only advances the version marker for
        // pre-existing boards. Kept explicit for parity with other versions.
      }
      db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
    }

    // Crash recovery: a card left mid-run by an app crash/kill would be
    // stranded in a column no engine will ever touch again. Paused is the
    // honest state — partial work lost, re-runs next window.
    const recovered = db
      .prepare("UPDATE cards SET state = 'paused', updated_at = ? WHERE state IN ('claimed', 'in-progress')")
      .run(Date.now());
    if (Number(recovered.changes) > 0) {
      logger.info(`[Backlog] recovered ${recovered.changes} interrupted card(s) → paused`);
    }
    return db;
  } catch (e: any) {
    logger.error('[Backlog] failed to open or migrate DB:', e?.message ?? e);
    return null;
  }
}

let cached: Database | null = null;
let initFailed = false;

/** Production entry point: cached singleton at userData/pulse-backlog.db. */
export function initBacklogDb(): Database | null {
  if (cached) return cached;
  if (initFailed) return null;
  // Lazy electron require keeps this module importable under plain-Node vitest.
  const { app } = require('electron') as typeof import('electron');
  const dbPath = path.join(app.getPath('userData'), 'pulse-backlog.db');
  logger.info(`[Backlog] opening database at ${dbPath}`);
  cached = openBacklogDb(dbPath);
  if (!cached) initFailed = true;
  return cached;
}

export function getBacklogDb(): Database | null {
  return cached;
}

export function closeBacklogDb(): void {
  try { cached?.close(); } catch { /* ignore */ }
  cached = null;
}

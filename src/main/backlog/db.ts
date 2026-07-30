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
// v5: cards.qa_url — QA task type (browser-verification cards, see
//     backlog-qa-tasktype-plan.md).
// v6: cards.refinement_session_id / refinement_started_at — interactive
//     plan-mode refinement session; the plan auto-attaches to the card (see
//     backlog-refinement-agent-plan.md).
// v7: cards.applied_at / apply_method / applied_autorun / applied_additions /
//     applied_deletions / applied_files — apply tracking for the "Shipped"
//     ribbon and the Overnight Backlog analytics (see analytics-improvement-plan).
const SCHEMA_VERSION = 8;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS projects (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  path                TEXT NOT NULL UNIQUE,
  created_at          INTEGER NOT NULL,
  gitlab_project_id   INTEGER,
  gitlab_host         TEXT,
  gitlab_project_path TEXT,
  issue_filter        TEXT NOT NULL DEFAULT '{"mode":"assigned","labels":[]}',
  gitlab_last_scan_at INTEGER
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
  qa_url              TEXT,
  refinement_session_id TEXT,
  refinement_started_at INTEGER,
  applied_at          INTEGER,
  apply_method        TEXT,
  applied_autorun     INTEGER NOT NULL DEFAULT 0,
  applied_additions   INTEGER,
  applied_deletions   INTEGER,
  applied_files       INTEGER,
  source_url          TEXT,
  source_fingerprint  TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cards_state_sort ON cards (state, sort_order);
CREATE INDEX IF NOT EXISTS idx_cards_project    ON cards (project_id);
-- idx_cards_source (on the v8 source_fingerprint column) is created AFTER the
-- migration block, not here: SCHEMA_SQL runs before migrations, so on a
-- migrating pre-v8 board the column would not exist yet when this runs.

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

-- GitLab population (Phase 3). Candidates = issues surfaced by a scan, awaiting
-- the Review & Import picker. Dismissed = tombstones so a rejected issue does
-- not re-surface. Both cascade on project removal (foreign_keys = ON below).
CREATE TABLE IF NOT EXISTS gitlab_candidates (
  fingerprint  TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  iid          INTEGER NOT NULL,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  web_url      TEXT NOT NULL,
  labels       TEXT NOT NULL DEFAULT '[]',
  fetched_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gitlab_candidates_project ON gitlab_candidates (project_id);

CREATE TABLE IF NOT EXISTS gitlab_dismissed (
  fingerprint  TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dismissed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gitlab_dismissed_project ON gitlab_dismissed (project_id);
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
      if (current < 5) db.exec('ALTER TABLE cards ADD COLUMN qa_url TEXT');
      if (current < 6) {
        db.exec('ALTER TABLE cards ADD COLUMN refinement_session_id TEXT');
        db.exec('ALTER TABLE cards ADD COLUMN refinement_started_at INTEGER');
      }
      if (current < 7) {
        db.exec('ALTER TABLE cards ADD COLUMN applied_at INTEGER');
        db.exec('ALTER TABLE cards ADD COLUMN apply_method TEXT');
        db.exec('ALTER TABLE cards ADD COLUMN applied_autorun INTEGER NOT NULL DEFAULT 0');
        db.exec('ALTER TABLE cards ADD COLUMN applied_additions INTEGER');
        db.exec('ALTER TABLE cards ADD COLUMN applied_deletions INTEGER');
        db.exec('ALTER TABLE cards ADD COLUMN applied_files INTEGER');
      }
      if (current < 8) {
        // GitLab population columns; the gitlab_candidates/gitlab_dismissed
        // tables are created by CREATE TABLE IF NOT EXISTS in SCHEMA_SQL above.
        db.exec('ALTER TABLE projects ADD COLUMN gitlab_project_id INTEGER');
        db.exec('ALTER TABLE projects ADD COLUMN gitlab_host TEXT');
        db.exec('ALTER TABLE projects ADD COLUMN gitlab_project_path TEXT');
        db.exec(`ALTER TABLE projects ADD COLUMN issue_filter TEXT NOT NULL DEFAULT '{"mode":"assigned","labels":[]}'`);
        db.exec('ALTER TABLE projects ADD COLUMN gitlab_last_scan_at INTEGER');
        db.exec('ALTER TABLE cards ADD COLUMN source_url TEXT');
        db.exec('ALTER TABLE cards ADD COLUMN source_fingerprint TEXT');
      }
      db.prepare('UPDATE schema_version SET version = ?').run(SCHEMA_VERSION);
    }

    // The v8 source_fingerprint column exists in all paths by now (fresh boards
    // via SCHEMA_SQL's cards DDL; migrated boards via the ALTER above), so its
    // index is safe to create unconditionally here.
    db.exec('CREATE INDEX IF NOT EXISTS idx_cards_source ON cards (source_fingerprint)');

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

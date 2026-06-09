// Reads GitHub Copilot METADATA (signed-in username + SKU) from VS Code's local
// state.vscdb. This is non-secret state and needs no keychain — same SQLite
// reader discipline as cursor-usage/credentials.ts:
//
//   github.copilot-github                          → username (e.g. "Dipen-Dedania")
//   extensionsAssignmentFilterProvider.copilotSku  → SKU (e.g. "free_limited_copilot")
//
// The OAuth token is NOT stored here (we scanned — zero gho_ strings in any
// ItemTable value); it lives in the OS keychain and is read separately by
// keychain.ts, only when the user opts into live quota.
//
// `better-sqlite3` is a native module rebuilt against Electron's ABI; if the
// rebuild hasn't run, `require` throws — we catch it and report `error` so the
// poller degrades to "unavailable" instead of crashing (mirrors timeline/db.ts
// and cursor-usage/credentials.ts).

import fs from 'fs';
import { vscodeStateDbPath } from './paths';

interface SqliteStatement {
  get: (...params: unknown[]) => unknown;
}
interface SqliteDatabase {
  prepare: (sql: string) => SqliteStatement;
  close: () => void;
}
type SqliteConstructor = new (
  path: string,
  options?: { readonly?: boolean; fileMustExist?: boolean },
) => SqliteDatabase;

export interface MetadataResult {
  ok: true;
  username?: string;
  sku?: string;
}

export interface MetadataError {
  ok: false;
  reason: 'missing' | 'malformed' | 'error';
  detail: string;
}

export type MetadataRead = MetadataResult | MetadataError;

const KEYS = {
  username: 'github.copilot-github',
  sku: 'extensionsAssignmentFilterProvider.copilotSku',
};

export async function readCopilotMetadata(): Promise<MetadataRead> {
  const dbPath = vscodeStateDbPath();

  if (!fs.existsSync(dbPath)) {
    return { ok: false, reason: 'missing', detail: `no VS Code state DB at ${dbPath}` };
  }

  let Database: SqliteConstructor;
  try {
    const mod = require('better-sqlite3');
    Database = (mod && mod.default ? mod.default : mod) as SqliteConstructor;
  } catch (e: any) {
    return {
      ok: false,
      reason: 'error',
      detail: `better-sqlite3 not loadable (run \`npm run rebuild:native\`): ${e?.message ?? e}`,
    };
  }

  let db: SqliteDatabase | null = null;
  try {
    // Read-only so a running VS Code's write-lock never blocks us, and so we
    // never mutate the user's DB. WAL reads work as-is on a read-only handle.
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const read = (key: string): string | undefined => {
      const row = db!.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as
        | { value?: unknown }
        | undefined;
      return typeof row?.value === 'string' ? row.value : undefined;
    };

    return buildMetadata({
      username: read(KEYS.username),
      sku: read(KEYS.sku),
    });
  } catch (e: any) {
    return { ok: false, reason: 'error', detail: e?.message ?? String(e) };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

// Pure transform from the raw ItemTable values into a MetadataResult. Separated
// from SQLite I/O so it can be unit-tested directly. We treat "no username" as
// malformed (signed out) so the poller can surface a "sign in" hint; SKU is
// optional and simply omitted when absent.
export function buildMetadata(rows: {
  username?: string;
  sku?: string;
}): MetadataRead {
  const username = rows.username?.trim();
  if (!username) {
    return { ok: false, reason: 'malformed', detail: 'github.copilot-github not found (signed out?)' };
  }
  const result: MetadataResult = { ok: true, username };
  if (rows.sku && rows.sku.trim()) result.sku = rows.sku.trim();
  return result;
}

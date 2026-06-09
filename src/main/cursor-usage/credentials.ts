// Reads Cursor's OAuth access token from its local SQLite state DB and builds
// the `WorkosCursorSessionToken` cookie that /api/usage-summary authenticates
// against.
//
// Cursor stores credentials in `state.vscdb` (a SQLite file) under the
// `ItemTable(key, value)` table:
//   cursorAuth/accessToken        → JWT (the bearer/session token)
//   cursorAuth/refreshToken       → JWT (unused here; Cursor refreshes itself)
//   cursorAuth/stripeMembershipType → "free" | "pro" | …
//   cursorAuth/cachedEmail        → signed-in email
//
// The session cookie value is "<userId>::<accessToken>" (URL-encoded `::` →
// `%3A%3A`); `userId` is the JWT `sub` claim (e.g. "google-oauth2|abc123").
//
// IMPORTANT: never cache the token. Cursor rewrites state.vscdb when the token
// refreshes, so we re-read on every poll (same discipline as the Codex reader).
//
// `better-sqlite3` is a native module rebuilt against Electron's ABI; if the
// rebuild hasn't run, `require` throws — we catch it and report `error` so the
// poller degrades to "unavailable" instead of crashing (mirrors timeline/db.ts).

import fs from 'fs';
import { cursorStateDbPath } from './paths';

// Minimal structural types so this file type-checks regardless of whether
// @types/better-sqlite3 is present, and so we can pass the readonly options.
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

export interface CredentialsResult {
  ok: true;
  token: string;            // raw access-token JWT (Bearer fallback)
  userId: string;           // JWT `sub`
  cookie: string;           // full "WorkosCursorSessionToken=…" header value
  membershipType?: string;
  email?: string;
}

export interface CredentialsError {
  ok: false;
  reason: 'missing' | 'malformed' | 'error';
  detail: string;
}

export type CredentialsRead = CredentialsResult | CredentialsError;

const KEYS = {
  accessToken: 'cursorAuth/accessToken',
  membership: 'cursorAuth/stripeMembershipType',
  email: 'cursorAuth/cachedEmail',
};

export async function readAccessToken(): Promise<CredentialsRead> {
  const dbPath = cursorStateDbPath();

  if (!fs.existsSync(dbPath)) {
    return { ok: false, reason: 'missing', detail: `no Cursor state DB at ${dbPath}` };
  }

  let Database: SqliteConstructor;
  try {
    // better-sqlite3 is CJS (require returns the class). Tolerate an ESM-interop
    // `.default` wrapper too, so this works under both Node and the test runner.
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
    // Read-only so a running Cursor's write-lock never blocks us, and so we
    // never mutate the user's DB. Do NOT set journal_mode pragmas on a
    // read-only connection — WAL reads work as-is and pragmas would fail.
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const read = (key: string): string | undefined => {
      const row = db!.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key) as
        | { value?: unknown }
        | undefined;
      return typeof row?.value === 'string' ? row.value : undefined;
    };

    return buildCredentials({
      accessToken: read(KEYS.accessToken),
      membershipType: read(KEYS.membership),
      email: read(KEYS.email),
    });
  } catch (e: any) {
    return { ok: false, reason: 'error', detail: e?.message ?? String(e) };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

// Pure transform from the raw `cursorAuth/*` values into a CredentialsResult —
// decodes the userId from the access-token JWT and assembles the session
// cookie. Separated from the SQLite I/O so it can be unit-tested directly.
export function buildCredentials(rows: {
  accessToken?: string;
  membershipType?: string;
  email?: string;
}): CredentialsRead {
  const token = rows.accessToken;
  if (!token) {
    return { ok: false, reason: 'malformed', detail: 'cursorAuth/accessToken not found' };
  }
  const userId = decodeJwtSub(token);
  if (!userId) {
    return { ok: false, reason: 'malformed', detail: 'could not decode userId from access token' };
  }
  const cookie = 'WorkosCursorSessionToken=' + encodeURIComponent(userId) + '%3A%3A' + token;
  return { ok: true, token, userId, cookie, membershipType: rows.membershipType, email: rows.email };
}

// Pull the `sub` claim out of a JWT without verifying it (we only need the
// user id to build the cookie). Returns undefined on any malformed input.
function decodeJwtSub(jwt: string): string | undefined {
  const parts = jwt.split('.');
  if (parts.length < 2) return undefined;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    const claims = JSON.parse(json) as { sub?: unknown };
    return typeof claims.sub === 'string' && claims.sub.length > 0 ? claims.sub : undefined;
  } catch {
    return undefined;
  }
}

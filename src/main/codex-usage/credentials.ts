// Reader for the Codex CLI's OAuth access token. Lives at ~/.codex/auth.json
// on all platforms (no Keychain analog needed; the file is the source of truth).
//
// Real shape (Codex >= 0.3x):
//   { auth_mode, OPENAI_API_KEY, tokens: { access_token, id_token, refresh_token, account_id }, last_refresh }
//
// The codex-usage spec also mentions top-level `accessToken` / `access_token`,
// so we accept any of the four common locations to stay tolerant of format drift.
//
// `access_token` is a JWT whose `exp` claim sits 10 days after `iat` (verified
// on codex-cli 0.160). We decode it (no signature check — it's only a hint for
// the scheduler's token-refresh nudge) and fall back to `last_refresh` + 10 d.
//
// IMPORTANT: never cache the token. Codex rewrites auth.json on refresh, so
// callers must re-read on every poll to avoid using a stale token.

import fs from 'fs';
import path from 'path';
import os from 'os';

const AUTH_FILE_PATH = path.join(os.homedir(), '.codex', 'auth.json');
// Observed access-token lifetime; used only when the JWT can't be decoded.
const FALLBACK_TOKEN_TTL_MS = 10 * 24 * 60 * 60 * 1000;

export interface CredentialsResult {
  ok: true;
  token: string;
  /** ms epoch when the access token expires; best-effort, may be absent. */
  expiresAt?: number;
}

export interface CredentialsError {
  ok: false;
  reason: 'missing' | 'malformed' | 'error';
  detail: string;
}

export type CredentialsRead = CredentialsResult | CredentialsError;

export async function readAccessToken(): Promise<CredentialsRead> {
  try {
    if (!fs.existsSync(AUTH_FILE_PATH)) {
      return { ok: false, reason: 'missing', detail: `no file at ${AUTH_FILE_PATH}` };
    }
    const raw = fs.readFileSync(AUTH_FILE_PATH, 'utf8');
    return extractToken(raw);
  } catch (e: any) {
    return { ok: false, reason: 'error', detail: e?.message ?? String(e) };
  }
}

/**
 * Decode a JWT's `exp` claim (seconds) to ms epoch. No signature verification —
 * we only need the timestamp. Returns null for anything that isn't a 3-segment
 * token with a JSON payload carrying a finite numeric `exp`.
 */
export function decodeJwtExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    const exp = payload?.exp;
    if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return null;
    return exp * 1000;
  } catch {
    return null;
  }
}

function extractToken(raw: string): CredentialsRead {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    return { ok: false, reason: 'malformed', detail: `JSON parse: ${e?.message ?? e}` };
  }
  const token =
    parsed?.tokens?.access_token ??
    parsed?.tokens?.accessToken ??
    parsed?.access_token ??
    parsed?.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'malformed', detail: 'access_token missing' };
  }
  const result: CredentialsResult = { ok: true, token };
  const expiresAt = decodeJwtExpiry(token) ?? expiryFromLastRefresh(parsed?.last_refresh);
  if (expiresAt !== null) result.expiresAt = expiresAt;
  return result;
}

function expiryFromLastRefresh(lastRefresh: unknown): number | null {
  if (typeof lastRefresh !== 'string' || !lastRefresh) return null;
  const ms = Date.parse(lastRefresh);
  return Number.isNaN(ms) ? null : ms + FALLBACK_TOKEN_TTL_MS;
}

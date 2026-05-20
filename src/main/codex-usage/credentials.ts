// Reader for the Codex CLI's OAuth access token. Lives at ~/.codex/auth.json
// on all platforms (no Keychain analog needed; the file is the source of truth).
//
// Real shape (Codex >= 0.3x):
//   { auth_mode, OPENAI_API_KEY, tokens: { access_token, id_token, refresh_token, ... }, last_refresh }
//
// The codex-usage spec also mentions top-level `accessToken` / `access_token`,
// so we accept any of the four common locations to stay tolerant of format drift.
//
// IMPORTANT: never cache the token. Codex rewrites auth.json on refresh, so
// callers must re-read on every poll to avoid using a stale token.

import fs from 'fs';
import path from 'path';
import os from 'os';

const AUTH_FILE_PATH = path.join(os.homedir(), '.codex', 'auth.json');

export interface CredentialsResult {
  ok: true;
  token: string;
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
  return { ok: true, token };
}

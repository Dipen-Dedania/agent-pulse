// Cross-platform reader for Claude Code's OAuth access token.
//
// macOS: token lives in the system Keychain under "Claude Code-credentials".
//        Fallback to ~/.claude/.credentials.json if the Keychain entry is missing
//        (some installs / contexts don't write to Keychain).
//
// Linux / Windows: ~/.claude/.credentials.json, field `.claudeAiOauth.accessToken`.
//
// IMPORTANT: never cache the returned token in memory. Claude Code rewrites
// the credentials when the token auto-refreshes, so callers must re-read every
// poll to avoid using a stale token.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { logger } from '../../common/logger';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const CREDS_FILE_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

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
  if (process.platform === 'darwin') {
    const kc = await readFromKeychain();
    if (kc.ok) return kc;
    logger.debug(`[usage/credentials] keychain miss (${kc.reason}: ${kc.detail}); falling back to file`);
  }
  return readFromFile();
}

function readFromKeychain(): Promise<CredentialsRead> {
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'],
      { timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve({ ok: false, reason: 'missing', detail: err.message });
          return;
        }
        const raw = stdout.trim();
        if (!raw) {
          resolve({ ok: false, reason: 'missing', detail: 'empty keychain value' });
          return;
        }
        // Keychain value is the full credentials JSON, same shape as the file.
        const parsed = extractToken(raw);
        resolve(parsed);
      },
    );
  });
}

function readFromFile(): CredentialsRead {
  try {
    if (!fs.existsSync(CREDS_FILE_PATH)) {
      return { ok: false, reason: 'missing', detail: `no file at ${CREDS_FILE_PATH}` };
    }
    const raw = fs.readFileSync(CREDS_FILE_PATH, 'utf8');
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
  const token = parsed?.claudeAiOauth?.accessToken;
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'malformed', detail: 'claudeAiOauth.accessToken missing' };
  }
  return { ok: true, token };
}

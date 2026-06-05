// Antigravity IDE CSRF token + port resolver.
//
// The IDE writes its startup args to its main.log on every launch:
//
//   2026-04-10 17:54:47.943 [info] [LS Main] Args: --csrf_token <UUID>
//     --extension_server_port 9100 --extension_server_csrf_token <UUID> ...
//
// We scan that log for the most recent `--csrf_token <UUID>` and use it
// as the bearer for the gRPC-Web endpoint. The token rotates on every IDE
// restart, so we re-read on every poll (cheap — local file, daily rotation
// bounds file size).
//
// The language-server PORT is ALSO dynamic — it changes on every launch and
// is NOT fixed at 5362 (that was just one session's port). The IDE logs it as:
//
//   [Auto-Restart] Port changed! Reloading all windows with URL: https://127.0.0.1:55950/
//     Local:       https://127.0.0.1:55950/
//
// Both formats carry the same port, so we match the most recent
// `https://127.0.0.1:<port>/` and connect there. Hardcoding the port is what
// made usage tracking silently fail (ECONNREFUSED → "IDE not running") after
// the IDE switched to dynamic ports.
//
// Critical regex detail: the Args line ALSO contains `--extension_server_csrf_token`
// (a different token for a different server). We anchor the match on a
// whitespace/start boundary before `--csrf_token` so the `server_csrf_token`
// suffix can't match. There's a test for this.
//
// Log locations (Electron userData convention):
//   Windows: %APPDATA%\Antigravity\logs\main.log
//   macOS:   ~/Library/Application Support/Antigravity/logs/main.log
//   Linux:   ~/.config/Antigravity/logs/main.log

import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CredentialsResult {
  ok: true;
  token: string;
  port: number;
}

export interface CredentialsError {
  ok: false;
  reason: 'missing' | 'malformed' | 'error';
  detail: string;
}

export type CredentialsRead = CredentialsResult | CredentialsError;

// Whitespace boundary in front of `--csrf_token` is what stops
// `--extension_server_csrf_token` from matching.
const TOKEN_RE =
  /(?:^|\s)--csrf_token\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;

// Matches the language-server URL the IDE logs on launch / port change.
// Anchored to the loopback host so unrelated https URLs can't match.
const PORT_RE = /https:\/\/127\.0\.0\.1:(\d{2,5})\//g;

function antigravityLogDir(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(
        process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'),
        'Antigravity',
        'logs',
      );
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'logs');
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'Antigravity', 'logs');
  }
}

/** Extract every `--csrf_token <UUID>` match; return the last one. */
export function extractLatestToken(content: string): string | null {
  let last: string | null = null;
  let match: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(content)) !== null) {
    last = match[1];
  }
  return last;
}

/**
 * Extract the most recent `https://127.0.0.1:<port>/` the IDE logged.
 * Returns null if no loopback URL is present, or if the captured number is
 * outside the valid TCP port range.
 */
export function extractLatestPort(content: string): number | null {
  let last: number | null = null;
  let match: RegExpExecArray | null;
  PORT_RE.lastIndex = 0;
  while ((match = PORT_RE.exec(content)) !== null) {
    const port = Number(match[1]);
    if (port >= 1 && port <= 65535) last = port;
  }
  return last;
}

/**
 * Try the current log first; if it has no token (e.g. day just rolled over
 * and the IDE hasn't restarted), fall back to other files in the same dir,
 * most-recent first.
 */
function findToken(
  logDir: string,
): { token: string; port: number | null; source: string } | null {
  const current = path.join(logDir, 'main.log');
  if (fs.existsSync(current)) {
    try {
      const content = fs.readFileSync(current, 'utf8');
      const token = extractLatestToken(content);
      if (token) return { token, port: extractLatestPort(content), source: current };
    } catch {
      // fall through to rotated files
    }
  }

  let entries: { name: string; mtime: number }[] = [];
  try {
    entries = fs
      .readdirSync(logDir)
      .filter((n) => n !== 'main.log' && /\.log(\.\d+|\.\d{4}-\d{2}-\d{2})?$|^main.*\.log$/i.test(n))
      .map((name) => {
        const stat = fs.statSync(path.join(logDir, name));
        return { name, mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return null;
  }

  for (const { name } of entries) {
    const p = path.join(logDir, name);
    try {
      const content = fs.readFileSync(p, 'utf8');
      const token = extractLatestToken(content);
      if (token) return { token, port: extractLatestPort(content), source: p };
    } catch {
      // ignore unreadable rotated file and continue
    }
  }
  return null;
}

export async function readCsrfToken(): Promise<CredentialsRead> {
  const logDir = antigravityLogDir();
  if (!fs.existsSync(logDir)) {
    return {
      ok: false,
      reason: 'missing',
      detail: `Antigravity log dir not found: ${logDir}`,
    };
  }

  try {
    const found = findToken(logDir);
    if (!found) {
      return {
        ok: false,
        reason: 'missing',
        detail: `No --csrf_token entry in ${logDir}. Restart Antigravity to write a fresh args line.`,
      };
    }
    if (found.port === null) {
      return {
        ok: false,
        reason: 'malformed',
        detail: `Found a CSRF token in ${found.source} but no language-server port (https://127.0.0.1:<port>/). Restart Antigravity so it logs its port.`,
      };
    }
    return { ok: true, token: found.token, port: found.port };
  } catch (e: any) {
    return { ok: false, reason: 'error', detail: e?.message ?? String(e) };
  }
}

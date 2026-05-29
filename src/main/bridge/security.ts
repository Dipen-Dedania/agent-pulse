// Centralized security invariants for the bridge HTTP handlers.
// One place to audit every cap, allowlist, and sanitizer that protects the
// /event and /mcp endpoints.

import http from 'http';

// Largest hook payload we've seen in the wild is ~8KB (Claude Code's full
// PreToolUse with a long Bash command). 64KB leaves ~8x headroom before we
// drop events; anything bigger is almost certainly hostile.
export const MAX_BODY_BYTES = 64 * 1024;

// Cap PID-chain length so a hostile payload can't blow up the focus PowerShell
// command builder. 16 ancestors is well past any real shell process tree.
export const MAX_PID_CHAIN = 16;

// Defeats DNS rebinding: an attacker page resolving its hostname to 127.0.0.1
// after pageload would still send the original `Host: evil.com:<port>` header,
// which fails this check. Hook scripts and Claude Code's native http hook all
// send Host: localhost:<port>, so legitimate traffic is unaffected.
export function isHostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  const allowed = new Set([
    `localhost:${port}`,
    `127.0.0.1:${port}`,
    `[::1]:${port}`,
  ]);
  return allowed.has(host.toLowerCase());
}

export type ReadBodyResult =
  | { ok: true; body: string }
  | { ok: false; reason: 'too-large' | 'error' };

// Streaming body reader with a hard cap. Continues draining the socket past
// the cap so the connection can close cleanly, but discards the data.
export function readBody(
  req: http.IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<ReadBodyResult> {
  return new Promise((resolve) => {
    let body = '';
    let exceeded = false;
    req.on('data', (chunk: Buffer) => {
      if (exceeded) return;
      body += chunk.toString('utf8');
      if (body.length > maxBytes) {
        exceeded = true;
        body = ''; // free the buffer; we won't return it
      }
    });
    req.on('end', () => {
      resolve(exceeded ? { ok: false, reason: 'too-large' } : { ok: true, body });
    });
    req.on('error', () => {
      resolve({ ok: false, reason: 'error' });
    });
  });
}

// Strip everything except the basename of a transcript_path value when logging
// raw payloads — the full path leaks the user's home directory and project
// tree if logs are ever shared. Matches both snake_case (CC/Codex hook stdin)
// and camelCase (our normalized payload).
const TRANSCRIPT_KEY_RE =
  /("(?:transcript_path|transcriptPath)"\s*:\s*")([^"\\]*(?:\\.[^"\\]*)*)(")/g;

export function redactTranscriptPath(s: string): string {
  return s.replace(TRANSCRIPT_KEY_RE, (_match, prefix, value, suffix) => {
    const idx = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    const basename = idx >= 0 ? value.slice(idx + 1) : value;
    return `${prefix}${basename}${suffix}`;
  });
}

// Truncate an attacker-controlled chain before any further processing, so the
// .map/.filter passes downstream are bounded too.
export function clampPidChain(chain: unknown): unknown[] | undefined {
  if (!Array.isArray(chain)) return undefined;
  return chain.length > MAX_PID_CHAIN ? chain.slice(0, MAX_PID_CHAIN) : chain;
}

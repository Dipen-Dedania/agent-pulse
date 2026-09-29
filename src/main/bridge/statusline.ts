// Parses the JSON that Claude Code feeds its statusline command (and that our
// deployed statusline script forwards verbatim to POST /statusline) into a
// normalized snapshot. The stdin schema is CC-version-dependent, so every
// section is optional: a payload with only a session_id still yields a (mostly
// empty) snapshot, and unknown/malformed sections are dropped rather than
// failing the whole parse.

import { UsageSnapshot } from '../../common/types';
import { parseRateLimitWindow } from '../usage/parse';

export interface StatusLineFeedSnapshot {
  sessionId: string;
  receivedAt: number;
  model?: string;
  costUsd?: number;
  contextUsedPct?: number;
  rateLimits?: UsageSnapshot;
  cache?: {
    warm?: boolean;
    hitRatio?: number;
    misses?: number;
    ttlSeconds?: number;
    expiresAt?: number;
  };
  transcriptPath?: string;
}

export function parseStatusLinePayload(data: unknown, now: number = Date.now()): StatusLineFeedSnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, any>;
  if (typeof obj.session_id !== 'string' || obj.session_id.length === 0) return null;

  const snap: StatusLineFeedSnapshot = {
    sessionId: obj.session_id,
    receivedAt: now,
  };

  const model = obj.model;
  if (model && typeof model === 'object') {
    const id = typeof model.id === 'string' ? model.id : undefined;
    const display = typeof model.display_name === 'string' ? model.display_name : undefined;
    snap.model = id ?? display;
  }

  const costUsd = coerceNumber(obj.cost?.total_cost_usd);
  if (costUsd !== null) snap.costUsd = costUsd;

  const usedPct = coerceNumber(obj.context_window?.used_percentage);
  if (usedPct !== null) snap.contextUsedPct = clamp(usedPct, 0, 100);

  const limits = obj.rate_limits;
  if (limits && typeof limits === 'object') {
    const fiveHour = parseRateLimitWindow(limits.five_hour);
    const sevenDay = parseRateLimitWindow(limits.seven_day);
    // Only a complete pair feeds the usage pipeline — UsageSnapshot requires
    // both windows, and a half-parsed one shouldn't overwrite poller data.
    if (fiveHour && sevenDay) snap.rateLimits = { fiveHour, sevenDay };
  }

  const cacheRaw = obj.prompt_cache;
  if (cacheRaw && typeof cacheRaw === 'object') {
    const cache: NonNullable<StatusLineFeedSnapshot['cache']> = {};
    if (typeof cacheRaw.warm === 'boolean') cache.warm = cacheRaw.warm;
    const hitRatio = coerceNumber(cacheRaw.hit_ratio);
    if (hitRatio !== null) cache.hitRatio = clamp(hitRatio, 0, 1);
    const misses = coerceNumber(cacheRaw.misses);
    if (misses !== null) cache.misses = misses;
    const ttl = parseTtlSeconds(cacheRaw.ttl);
    if (ttl !== null) cache.ttlSeconds = ttl;
    const expiresAt = coerceNumber(cacheRaw.expires_at);
    // Same seconds-vs-ms heuristic as the usage endpoint's resets_at.
    if (expiresAt !== null) cache.expiresAt = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
    if (Object.keys(cache).length > 0) snap.cache = cache;
  }

  if (typeof obj.transcript_path === 'string' && obj.transcript_path.length > 0) {
    snap.transcriptPath = obj.transcript_path;
  }

  return snap;
}

// prompt_cache.ttl has appeared both as seconds and as a duration string
// ("1h", "5m"); accept both, drop anything else.
function parseTtlSeconds(value: unknown): number | null {
  const n = coerceNumber(value);
  if (n !== null) return n;
  if (typeof value === 'string') {
    const m = /^(\d+)\s*(s|m|h)$/i.exec(value.trim());
    if (m) {
      const mult = m[2].toLowerCase() === 'h' ? 3600 : m[2].toLowerCase() === 'm' ? 60 : 1;
      return Number(m[1]) * mult;
    }
  }
  return null;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

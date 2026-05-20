// Parses GET /backend-api/wham/usage into a normalized CodexUsageSnapshot.
//
// The endpoint is undocumented (ChatGPT web-UI internal) so every field is
// treated as best-effort. Specifically:
//   - rate_limit can be absent entirely → null.
//   - primary_window must exist (the spec calls it "guaranteed").
//   - secondary_window is usually null; omitted from snapshot when so.
//   - used_percent may arrive as a number or a numeric string.
//   - reset_at may be unix-seconds, ms, or ISO-8601 — we normalize to ms.
//   - When reset_at is missing we fall back to now + reset_after_seconds.
//
// Returns `null` if the payload cannot be made sense of so the caller can
// surface "unavailable" rather than crash.

import { CodexUsageSnapshot, UsageWindow } from '../../common/types';

export function parseUsageResponse(raw: unknown): CodexUsageSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const rl = (raw as Record<string, unknown>).rate_limit;
  if (!rl || typeof rl !== 'object') return null;

  const rateLimit = rl as Record<string, unknown>;
  const primary = parseWindow(rateLimit.primary_window);
  if (!primary) return null;

  const secondary = parseWindow(rateLimit.secondary_window);
  return secondary ? { primary, secondary } : { primary };
}

function parseWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const utilization = coerceNumber(obj.used_percent);
  if (utilization === null) return null;

  const resetsAt = parseResetsAt(obj.reset_at, obj.reset_after_seconds);
  if (resetsAt === null) return null;

  return {
    utilization: clamp(utilization, 0, 100),
    resetsAt,
  };
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function parseResetsAt(resetAt: unknown, resetAfterSeconds: unknown): number | null {
  if (typeof resetAt === 'number' && Number.isFinite(resetAt)) {
    // Heuristic: >1e12 is ms, otherwise seconds.
    return resetAt > 1e12 ? resetAt : resetAt * 1000;
  }
  if (typeof resetAt === 'string' && resetAt.trim() !== '') {
    const asNum = Number(resetAt);
    if (Number.isFinite(asNum) && resetAt.trim() === String(asNum)) {
      return asNum > 1e12 ? asNum : asNum * 1000;
    }
    const ms = Date.parse(resetAt);
    if (!Number.isNaN(ms)) return ms;
  }
  // Fall back to reset_after_seconds + now.
  const after = coerceNumber(resetAfterSeconds);
  if (after !== null && after >= 0) return Date.now() + after * 1000;
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

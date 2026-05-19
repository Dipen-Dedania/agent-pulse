// Parses the response body of GET /api/oauth/usage into a normalized
// UsageSnapshot. The endpoint is undocumented, so we defensively handle:
//
// - Utilization field name variants: `utilization` or `used_percentage`.
// - `resets_at` may be a Unix-seconds number or an ISO-8601 string.
// - Numbers that arrive as strings ("42") are coerced.
//
// Returns `null` if the payload cannot be made sense of — caller surfaces
// "unavailable" rather than throwing.

import { UsageSnapshot, UsageWindow } from '../../common/types';

export function parseUsageResponse(raw: unknown): UsageSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const fiveHour = parseWindow(obj.five_hour);
  const sevenDay = parseWindow(obj.seven_day);
  if (!fiveHour || !sevenDay) return null;
  return { fiveHour, sevenDay };
}

function parseWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const utilization = coerceNumber(obj.utilization ?? obj.used_percentage);
  if (utilization === null) return null;

  const resetsAt = parseResetsAt(obj.resets_at);
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

function parseResetsAt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: >1e12 is already ms, otherwise seconds.
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    // Numeric string: same heuristic as above.
    const asNum = Number(value);
    if (Number.isFinite(asNum) && value.trim() === String(asNum)) {
      return asNum > 1e12 ? asNum : asNum * 1000;
    }
    // ISO string.
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

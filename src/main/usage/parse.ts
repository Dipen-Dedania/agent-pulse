// Parses the response body of GET /api/oauth/usage into a normalized
// UsageSnapshot. The endpoint is undocumented, so we defensively handle:
//
// - Utilization field name variants: `utilization` or `used_percentage`.
// - `resets_at` may be a Unix-seconds number or an ISO-8601 string.
// - Numbers that arrive as strings ("42") are coerced.
//
// Beyond the two windows (required), the payload carries optional blocks we
// surface best-effort and drop silently when absent or malformed:
//
// - `extra_usage` + `spend` → ClaudeExtraUsage (pay-as-you-go credits).
//   Observed 2026-10 on a Team seat with a $10 member spend limit:
//     extra_usage.monthly_limit = 1000, used_credits = 0.0, decimal_places = 2
//     spend.limit = { amount_minor: 1000, currency: "USD", exponent: 2 }
//     spend.cap   = { money: null, credits: { amount_minor: 1000, exponent: 2 } }
//   So extra_usage's bare numbers are MINOR units scaled by decimal_places,
//   while spend.* carries self-describing minor-unit objects. We prefer the
//   self-describing spend.* values and only fall back to extra_usage numbers
//   (scaled) when spend is absent. balance was null (org-paid seat).
// - `limits[]` entries with kind=weekly_scoped and a model scope → per-model
//   weekly caps. Legacy `seven_day_opus` / `seven_day_sonnet` windows are
//   folded in when `limits[]` doesn't already name them.
//
// Returns `null` if the payload cannot be made sense of — caller surfaces
// "unavailable" rather than throwing.

import { ClaudeExtraUsage, ClaudeScopedLimit, UsageSnapshot, UsageWindow } from '../../common/types';

export function parseUsageResponse(raw: unknown): UsageSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const fiveHour = parseWindow(obj.five_hour);
  const sevenDay = parseWindow(obj.seven_day);
  if (!fiveHour || !sevenDay) return null;

  const snapshot: UsageSnapshot = { fiveHour, sevenDay };

  const extraUsage = parseExtraUsage(obj.extra_usage, obj.spend);
  if (extraUsage) snapshot.extraUsage = extraUsage;

  const scoped = parseScopedLimits(obj);
  if (scoped.length > 0) snapshot.scopedLimits = scoped;

  return snapshot;
}

/**
 * Statusline pushes only carry the two windows. Carry the HTTP-only blocks
 * forward from the previous snapshot so the settings panel doesn't blink
 * between "credits shown" and "no credits" every time Claude Code speaks.
 */
export function mergeUsageSnapshot(
  prev: UsageSnapshot | undefined,
  incoming: UsageSnapshot,
): UsageSnapshot {
  if (!prev) return incoming;
  const merged: UsageSnapshot = { ...incoming };
  if (incoming.extraUsage === undefined && prev.extraUsage) merged.extraUsage = prev.extraUsage;
  if (incoming.scopedLimits === undefined && prev.scopedLimits) merged.scopedLimits = prev.scopedLimits;
  if (incoming.planType === undefined && prev.planType) merged.planType = prev.planType;
  return merged;
}

// ─── Extra usage (credits) ───────────────────────────────────────────────────

function parseExtraUsage(extraRaw: unknown, spendRaw: unknown): ClaudeExtraUsage | null {
  const extra = asRecord(extraRaw);
  const spend = asRecord(spendRaw);
  if (!extra && !spend) return null;

  // `is_enabled` (extra_usage) and `enabled` (spend) have agreed on every
  // payload seen; prefer extra_usage and fall back to spend.
  const enabled =
    typeof extra?.is_enabled === 'boolean' ? extra.is_enabled
    : typeof spend?.enabled === 'boolean' ? spend.enabled
    : false;

  const currency =
    asNonEmptyString(extra?.currency)
    ?? asNonEmptyString(asRecord(spend?.used)?.currency)
    ?? 'USD';

  // extra_usage's bare numbers are minor units (monthly_limit=1000 ↔ $10).
  const decimals = coerceNumber(extra?.decimal_places) ?? 2;
  const fromExtra = (v: unknown): number | null => {
    const n = coerceNumber(v);
    return n === null ? null : n / Math.pow(10, decimals);
  };

  const usedCredits = parseMoney(spend?.used) ?? fromExtra(extra?.used_credits);
  const monthlyLimit =
    parseMoney(spend?.limit) ?? parseMoney(spend?.cap) ?? fromExtra(extra?.monthly_limit);
  const balance = parseMoney(spend?.balance);

  const utilRaw = coerceNumber(extra?.utilization) ?? coerceNumber(spend?.percent);
  const utilization = utilRaw === null ? null : clamp(utilRaw, 0, 100);

  return {
    enabled,
    usedCredits,
    monthlyLimit,
    utilization,
    balance,
    currency,
    spendLimitReached: extra?.spend_limit_reached === true,
    userDisabled: extra?.user_disabled === true,
    canPurchaseCredits: spend?.can_purchase_credits === true,
  };
}

/**
 * spend.* money is a minor-unit object:
 *   { amount_minor: 1000, currency: "USD", exponent: 2 }  → 10
 * spend.cap wraps one more level:
 *   { money: {...} | null, credits: {...} | null }        → whichever is set
 * Normalize to whole units; null when absent or unparseable. Bare numbers
 * are NOT accepted here — their unit is ambiguous (see fromExtra above).
 */
function parseMoney(raw: unknown): number | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  if ('amount_minor' in obj) {
    const minor = coerceNumber(obj.amount_minor);
    if (minor === null) return null;
    const exponent = coerceNumber(obj.exponent) ?? 2;
    return minor / Math.pow(10, exponent);
  }
  // cap wrapper
  if ('money' in obj || 'credits' in obj) {
    return parseMoney(obj.money) ?? parseMoney(obj.credits);
  }
  return null;
}

// ─── Scoped (per-model) weekly limits ───────────────────────────────────────

function parseScopedLimits(obj: Record<string, unknown>): ClaudeScopedLimit[] {
  const out: ClaudeScopedLimit[] = [];
  const seen = new Set<string>();
  const push = (label: string, utilization: number, resetsAt: number) => {
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, utilization: clamp(utilization, 0, 100), resetsAt });
  };

  if (Array.isArray(obj.limits)) {
    for (const entry of obj.limits) {
      const e = asRecord(entry);
      if (!e || e.kind !== 'weekly_scoped') continue;
      const model = asRecord(asRecord(e.scope)?.model);
      const label = asNonEmptyString(model?.display_name) ?? asNonEmptyString(model?.id);
      if (!label) continue;
      const pct = coerceNumber(e.percent);
      const resetsAt = parseResetsAt(e.resets_at);
      if (pct === null || resetsAt === null) continue;
      push(label, pct, resetsAt);
    }
  }

  // Legacy per-model windows (same shape as five_hour / seven_day).
  const legacy: Array<[string, string]> = [
    ['seven_day_opus', 'Opus'],
    ['seven_day_sonnet', 'Sonnet'],
  ];
  for (const [key, label] of legacy) {
    const w = parseWindow(obj[key]);
    if (w) push(label, w.utilization, w.resetsAt);
  }

  return out;
}

// Exported for the statusline ingest path (src/main/bridge/statusline.ts):
// Claude Code's statusline JSON carries the same window shape under
// rate_limits.five_hour / seven_day, with the same field-name variants.
export function parseRateLimitWindow(raw: unknown): UsageWindow | null {
  return parseWindow(raw);
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

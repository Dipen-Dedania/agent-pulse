// Parses Codex rate-limit data into a normalized CodexUsageSnapshot from two
// sources:
//
//   1. GET /backend-api/wham/usage (parseUsageResponse) — the HTTP poll. Carries
//      the windows plus plan, credits, spend control, per-model availability and
//      an optional code-review limit.
//   2. Session rollout `rate_limits` objects on token_count rows
//      (parseRolloutRateLimits) — pushed live while Codex is running. Carries
//      windows, credits, plan and reached-type only.
//
// Both are undocumented, so every field is treated as best-effort:
//   - rate_limit / primary window missing → null (caller surfaces "unavailable").
//   - secondary window usually present on paid plans; omitted when null.
//   - used_percent may arrive as a number or a numeric string.
//   - reset timestamps may be unix-seconds, ms, or ISO-8601 — normalized to ms.
//   - HTTP: when reset_at is missing we fall back to now + reset_after_seconds.
//   - HTTP window length is `limit_window_seconds`; rollouts use `window_minutes`.
//
// Returns `null` if the payload cannot be made sense of so the caller can
// surface "unavailable" rather than crash.

import {
  CodexCredits,
  CodexModelAvailability,
  CodexUsageSnapshot,
  UsageWindow,
} from '../../common/types';

export function parseUsageResponse(raw: unknown): CodexUsageSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const rl = obj.rate_limit;
  if (!rl || typeof rl !== 'object') return null;

  const rateLimit = rl as Record<string, unknown>;
  const primary = parseHttpWindow(rateLimit.primary_window);
  if (!primary) return null;

  const snapshot: CodexUsageSnapshot = { primary, source: 'http' };

  const secondary = parseHttpWindow(rateLimit.secondary_window);
  if (secondary) snapshot.secondary = secondary;

  // code_review_rate_limit is null on every payload seen so far; assume it
  // mirrors rate_limit's shape ({ primary_window }) and drop it on mismatch.
  const review = parseHttpWindow(asRecord(obj.code_review_rate_limit)?.primary_window);
  if (review) snapshot.review = review;

  const planType = asNonEmptyString(obj.plan_type);
  if (planType) snapshot.planType = planType;

  const spendControlReached = asRecord(obj.spend_control)?.reached === true;
  const limitReachedType = asNonEmptyString(obj.rate_limit_reached_type) ?? null;
  const limitReached = rateLimit.limit_reached === true || spendControlReached || !!limitReachedType;
  snapshot.limitReached = limitReached;
  snapshot.limitReachedType = limitReachedType;
  snapshot.spendControlReached = spendControlReached;

  const credits = parseCredits(obj.credits, /*includeOverage*/ true);
  if (credits) snapshot.credits = credits;

  const models = parseModelUsage(obj.model_usage);
  if (models.length > 0) snapshot.models = models;

  return snapshot;
}

/**
 * Rollout shape (codex-cli ≥ 0.139, verified 0.160):
 *   { limit_id, limit_name, primary: { used_percent, window_minutes, resets_at },
 *     secondary: {...} | null, credits: { has_credits, unlimited, balance },
 *     individual_limit, spend_control_reached, plan_type, rate_limit_reached_type }
 */
export function parseRolloutRateLimits(raw: unknown): CodexUsageSnapshot | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const primary = parseRolloutWindow(obj.primary);
  if (!primary) return null;

  const snapshot: CodexUsageSnapshot = { primary, source: 'rollout' };

  const secondary = parseRolloutWindow(obj.secondary);
  if (secondary) snapshot.secondary = secondary;

  const planType = asNonEmptyString(obj.plan_type);
  if (planType) snapshot.planType = planType;

  const spendControlReached = obj.spend_control_reached === true;
  const limitReachedType = asNonEmptyString(obj.rate_limit_reached_type) ?? null;
  snapshot.limitReached = spendControlReached || !!limitReachedType;
  snapshot.limitReachedType = limitReachedType;
  snapshot.spendControlReached = spendControlReached;

  const credits = parseCredits(obj.credits, /*includeOverage*/ false);
  if (credits) snapshot.credits = credits;

  return snapshot;
}

/**
 * Merge a pushed (rollout) snapshot over the last known one. Windows, plan,
 * credits and limit flags come from `incoming` wholesale — the rollout is the
 * fresher truth, and an absent secondary means Codex stopped reporting it.
 * HTTP-only fields (`review`, `models`, `credits.overageLimitReached`) are
 * carried forward from `prev` so the Settings panel doesn't flicker between
 * polls. A later HTTP poll replaces everything (the poll path never merges).
 */
export function mergeCodexSnapshot(
  prev: CodexUsageSnapshot | undefined,
  incoming: CodexUsageSnapshot,
): CodexUsageSnapshot {
  if (!prev) return incoming;
  const merged: CodexUsageSnapshot = { ...incoming };
  if (incoming.review === undefined && prev.review) merged.review = prev.review;
  if (incoming.models === undefined && prev.models) merged.models = prev.models;
  if (
    incoming.credits &&
    incoming.credits.overageLimitReached === undefined &&
    prev.credits?.overageLimitReached !== undefined
  ) {
    merged.credits = { ...incoming.credits, overageLimitReached: prev.credits.overageLimitReached };
  }
  return merged;
}

// ─── Window parsers ──────────────────────────────────────────────────────────

function parseHttpWindow(raw: unknown): UsageWindow | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const utilization = coerceNumber(obj.used_percent);
  if (utilization === null) return null;

  const resetsAt = parseResetsAt(obj.reset_at, obj.reset_after_seconds);
  if (resetsAt === null) return null;

  const window: UsageWindow = { utilization: clamp(utilization, 0, 100), resetsAt };
  const windowSeconds = coerceNumber(obj.limit_window_seconds);
  if (windowSeconds !== null && windowSeconds > 0) window.windowSeconds = windowSeconds;
  return window;
}

function parseRolloutWindow(raw: unknown): UsageWindow | null {
  const obj = asRecord(raw);
  if (!obj) return null;

  const utilization = coerceNumber(obj.used_percent);
  if (utilization === null) return null;

  const resetsAt = parseResetsAt(obj.resets_at, undefined);
  if (resetsAt === null) return null;

  const window: UsageWindow = { utilization: clamp(utilization, 0, 100), resetsAt };
  const windowMinutes = coerceNumber(obj.window_minutes);
  if (windowMinutes !== null && windowMinutes > 0) window.windowSeconds = windowMinutes * 60;
  return window;
}

// ─── Field parsers ───────────────────────────────────────────────────────────

function parseCredits(raw: unknown, includeOverage: boolean): CodexCredits | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const credits: CodexCredits = {
    hasCredits: obj.has_credits === true,
    unlimited: obj.unlimited === true,
    balance: coerceNumber(obj.balance),
  };
  if (includeOverage && typeof obj.overage_limit_reached === 'boolean') {
    credits.overageLimitReached = obj.overage_limit_reached;
  }
  return credits;
}

function parseModelUsage(raw: unknown): CodexModelAvailability[] {
  const obj = asRecord(raw);
  if (!obj) return [];
  const out: CodexModelAvailability[] = [];
  for (const [model, value] of Object.entries(obj)) {
    const entry = asRecord(value);
    if (!entry || !model) continue;
    const item: CodexModelAvailability = { model, available: entry.available === true };
    const availableAt = parseResetsAt(entry.available_at, undefined);
    if (availableAt !== null) item.availableAt = availableAt;
    if (typeof entry.credits_would_enable === 'boolean') item.creditsWouldEnable = entry.credits_would_enable;
    out.push(item);
  }
  return out;
}

// ─── Primitives ──────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
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

// Parses GET https://cursor.com/api/usage-summary into a normalized
// CursorUsageSnapshot.
//
// The endpoint is undocumented (Cursor web/desktop internal) so every field is
// best-effort. Observed shape:
//   {
//     billingCycleStart, billingCycleEnd,           // ISO-8601
//     membershipType, limitType, isUnlimited,
//     individualUsage: {
//       plan: { used, limit, remaining,
//               breakdown: { included, bonus, total },
//               autoPercentUsed, apiPercentUsed, totalPercentUsed },
//       onDemand: { enabled, used, limit, remaining }
//     },
//     teamUsage: {}
//   }
//
// We map the plan into a single billing-cycle window: utilization =
// totalPercentUsed, resetsAt = billingCycleEnd. Returns `null` if the payload
// can't be made sense of, so the caller surfaces "unavailable" rather than
// crashing.

import { CursorUsageSnapshot } from '../../common/types';

export function parseUsageResponse(raw: unknown): CursorUsageSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const individual = obj.individualUsage as Record<string, unknown> | undefined;
  const plan = individual?.plan as Record<string, unknown> | undefined;
  if (!plan || typeof plan !== 'object') return null;

  const utilization = coerceNumber(plan.totalPercentUsed);
  if (utilization === null) return null;

  const resetsAt = parseResetsAt(obj.billingCycleEnd);
  if (resetsAt === null) return null;

  const snapshot: CursorUsageSnapshot = {
    plan: { utilization: clamp(utilization, 0, 100), resetsAt },
  };

  if (typeof obj.membershipType === 'string') snapshot.membershipType = obj.membershipType;

  const used = coerceNumber(plan.used);
  const limit = coerceNumber(plan.limit);
  const remaining = coerceNumber(plan.remaining);
  if (used !== null) snapshot.used = used;
  if (limit !== null) snapshot.limit = limit;
  if (remaining !== null) snapshot.remaining = remaining;

  const breakdown = plan.breakdown as Record<string, unknown> | undefined;
  if (breakdown && typeof breakdown === 'object') {
    const included = coerceNumber(breakdown.included);
    const bonus = coerceNumber(breakdown.bonus);
    const total = coerceNumber(breakdown.total);
    if (included !== null && bonus !== null && total !== null) {
      snapshot.breakdown = { included, bonus, total };
    }
  }

  const onDemand = individual?.onDemand as Record<string, unknown> | undefined;
  if (onDemand && typeof onDemand.enabled === 'boolean') {
    snapshot.onDemandEnabled = onDemand.enabled;
  }

  return snapshot;
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
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

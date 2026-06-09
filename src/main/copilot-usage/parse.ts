// Parses GET https://api.github.com/copilot_internal/user into a normalized
// CopilotUsageSnapshot.
//
// The endpoint is undocumented (used by VS Code's Copilot client) so every field
// is best-effort. Observed shape (validated against a live free-plan account):
//   {
//     login: "Dipen-Dedania",
//     access_type_sku: "free_limited_copilot",
//     quota_snapshots: {
//       chat:                 { percent_remaining, remaining, entitlement, unlimited, … },
//       completions:          { … },
//       premium_interactions: { … }
//     },
//     quota_reset_date_utc: "2026-07-01T00:00:00.000Z"   // monthly
//   }
//
// Each quota maps to one monthly window: utilization = 100 − percent_remaining,
// resetsAt = quota_reset_date_utc. A window is OMITTED when entitlement is 0 and
// not unlimited (free plan reports premium_interactions = 0/0). Returns `null`
// if the payload can't be made sense of, so the caller surfaces "unavailable".
//
// `username`/`sku` from the metadata reader are merged in by the poller — this
// function fills them from the response too (they match) so it's usable standalone.

import { CopilotUsageSnapshot, CopilotQuotaWindow } from '../../common/types';

const QUOTA_ORDER: { key: CopilotQuotaWindow['key']; label: string }[] = [
  { key: 'chat', label: 'Chat' },
  { key: 'completions', label: 'Completions' },
  { key: 'premium_interactions', label: 'Premium' },
];

export function parseUsageResponse(raw: unknown): CopilotUsageSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const snapshots = obj.quota_snapshots as Record<string, unknown> | undefined;
  if (!snapshots || typeof snapshots !== 'object') return null;

  const resetsAt = parseResetsAt(obj.quota_reset_date_utc ?? obj.quota_reset_date);
  if (resetsAt === null) return null;

  const quotas: CopilotQuotaWindow[] = [];
  for (const { key, label } of QUOTA_ORDER) {
    const q = snapshots[key] as Record<string, unknown> | undefined;
    if (!q || typeof q !== 'object') continue;

    const unlimited = q.unlimited === true;
    const entitlement = coerceNumber(q.entitlement) ?? 0;
    // Skip windows that carry no allowance (e.g. premium on the free plan).
    if (!unlimited && entitlement <= 0) continue;

    const percentRemaining = coerceNumber(q.percent_remaining);
    const remaining = coerceNumber(q.remaining) ?? 0;
    const utilization = percentRemaining === null ? 0 : clamp(100 - percentRemaining, 0, 100);

    quotas.push({ key, label, utilization, remaining, entitlement, unlimited, resetsAt });
  }

  // A response with snapshots but no billable windows (e.g. everything 0/0) is
  // still a valid "signed in, nothing to show" state — return an empty quota list
  // rather than null so the UI shows the metadata card, not an error.
  const snapshot: CopilotUsageSnapshot = { quotas, source: 'live' };

  if (typeof obj.login === 'string' && obj.login.trim()) snapshot.username = obj.login.trim();
  if (typeof obj.access_type_sku === 'string' && obj.access_type_sku.trim()) {
    snapshot.sku = obj.access_type_sku.trim();
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

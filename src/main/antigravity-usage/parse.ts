// Parses the IDE's GetAvailableModels response into an
// AntigravityUsageSnapshot.
//
// The response is undocumented and noisy: ~50 entries under
// `response.models`, most of which are internal placeholders with
// `quotaInfo.remainingFraction === 1` and no `resetTime`. The signal lives
// in the entries that DO have a `resetTime` — those are the gated /
// rate-limited models. We keep only those.
//
// Sort order: recommended-first, then by lowest remaining (= most
// depleted). This is the order the bubble UI will render bars in, and the
// order the Settings panel lists models.
//
// Defensive throughout: every field is treated as best-effort. A drift in
// any one model entry shouldn't drop the entire snapshot.

import { AntigravityUsageSnapshot, AntigravityModelWindow } from '../../common/types';

export function parseModelsResponse(raw: unknown): AntigravityUsageSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const response = (raw as Record<string, unknown>).response;
  if (!response || typeof response !== 'object') return null;
  const models = (response as Record<string, unknown>).models;
  if (!models || typeof models !== 'object') return null;

  const out: AntigravityModelWindow[] = [];
  for (const [key, value] of Object.entries(models as Record<string, unknown>)) {
    const parsed = parseModel(key, value);
    if (parsed) out.push(parsed);
  }

  out.sort((a, b) => {
    if (!!b.recommended !== !!a.recommended) return b.recommended ? 1 : -1;
    return (100 - a.utilization) - (100 - b.utilization); // ascending remaining = most depleted first
  });

  return { models: out };
}

function parseModel(modelKey: string, raw: unknown): AntigravityModelWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;

  const quotaInfo = m.quotaInfo;
  if (!quotaInfo || typeof quotaInfo !== 'object') return null;
  const q = quotaInfo as Record<string, unknown>;

  const resetsAt = parseResetTime(q.resetTime);
  if (resetsAt === null) return null;  // skip placeholder models with no real quota window

  // Proto3 omits zero-valued fields from JSON, so an exhausted model arrives
  // with `remainingFraction` missing entirely. Treat absence as 0 rather
  // than dropping the model — those are the ones the user most needs to see.
  // A present-but-malformed value is still a skip (likely a format drift).
  const rfRaw = q.remainingFraction;
  let remaining: number;
  if (rfRaw === undefined || rfRaw === null) {
    remaining = 0;
  } else {
    const coerced = coerceNumber(rfRaw);
    if (coerced === null) return null;
    remaining = coerced;
  }

  const utilization = clamp((1 - remaining) * 100, 0, 100);
  const displayName = typeof m.displayName === 'string' && m.displayName.trim()
    ? m.displayName.trim()
    : modelKey;

  const out: AntigravityModelWindow = {
    modelKey,
    displayName,
    utilization,
    resetsAt,
    recommended: m.recommended === true,
  };
  if (remaining <= 0) out.exhausted = true;
  return out;
}

function parseResetTime(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw > 1e12 ? raw : raw * 1000;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return ms;
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

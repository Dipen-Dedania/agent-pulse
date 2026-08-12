import {
  UsageStatus,
  CodexUsageStatus,
  CursorUsageStatus,
  CopilotUsageStatus,
  AntigravityUsageStatus,
  AntigravityModelWindow,
} from '../../../common/types';

// ── Shared quota presentation helpers ────────────────────────────────────────
// Used by both quota styles on the bubble (BubbleQuotaStyle): the stacked bars
// in Bubble.tsx and the arc gauge in QuotaArc.tsx. Kept in its own module so the
// arc can reuse the bars' colour scale without importing Bubble.tsx (which
// imports the arc — that would be a cycle).

// Every quota visual reads as an "opportunity gauge": FULL = lots of credit
// left, empty = nearly out. Green when plenty remains, amber as it depletes,
// red when nearly out. The thresholds live here once so the bars and the arc can
// never drift into disagreeing about what "low" means.
export type QuotaTier = 'ample' | 'low' | 'critical';

export const quotaTier = (remaining: number): QuotaTier =>
  remaining > 50 ? 'ample' : remaining > 20 ? 'low' : 'critical';

export function fillColorForRemaining(remaining: number, isDark: boolean): string {
  switch (quotaTier(remaining)) {
    case 'ample':
      return isDark ? 'rgba(34,197,94,0.7)' : 'rgba(22,163,74,0.6)';
    case 'low':
      return isDark ? 'rgba(245,158,11,0.75)' : 'rgba(217,119,6,0.65)';
    default:
      return isDark ? 'rgba(239,68,68,0.8)' : 'rgba(220,38,38,0.7)';
  }
}

// Same tiers, near-opaque. The bars can afford translucency because they sit on
// a track over the orb's blurred glass; the arc rings the orb from OUTSIDE, so
// its backdrop is whatever is on the desktop. At the bars' 0.6–0.8 alpha a
// high-contrast edge behind the bubble (a window border, a line of terminal
// text) shows through and visually slices the ring in two.
export function arcColorForRemaining(remaining: number, isDark: boolean): string {
  switch (quotaTier(remaining)) {
    case 'ample':
      return isDark ? 'rgba(34,197,94,0.97)' : 'rgba(22,163,74,0.97)';
    case 'low':
      return isDark ? 'rgba(245,158,11,0.97)' : 'rgba(217,119,6,0.97)';
    default:
      return isDark ? 'rgba(239,68,68,0.97)' : 'rgba(220,38,38,0.97)';
  }
}

// The arc's unfilled remainder. Much heavier than the bars' track for the same
// reason — it has to read as a solid "empty" band against an unknown desktop,
// not as a tint of whatever is behind it.
export const arcTrackColor = (isDark: boolean): string =>
  isDark ? 'rgba(30,41,59,0.85)' : 'rgba(203,213,225,0.9)';

// Unfilled remainder of a bar / arc.
export const quotaTrackColor = (isDark: boolean): string =>
  isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';

// Colourless fill for a window we have no reading for (poller off, signed out,
// error) — distinguishes "no data" from "no credit", which red would imply.
export const quotaInactiveFill = (isDark: boolean): string =>
  isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';

// ── Primary window per provider, for the arc gauge ───────────────────────────
// The arc holds ONE number where the bars hold N, so each provider nominates the
// window that best answers "can I keep going right now". Everything else stays
// in the tooltip, which lists every window under both styles. `null` means
// render no arc at all (rather than an empty ring) — same rule the Copilot bars
// use for "no live quota".
//
// All return REMAINING percent, 0–100, to match the bars' semantics.

export function claudeArcRemaining(status: UsageStatus): number | null {
  if (status.state !== 'ok' || !status.snapshot) return null;
  // The 5-hour window is the one that actually gates the next prompt; the 7-day
  // figure moves slowly and is rarely the binding constraint.
  return 100 - status.snapshot.fiveHour.utilization;
}

export function codexArcRemaining(status: CodexUsageStatus): number | null {
  if (status.state !== 'ok' || !status.snapshot) return null;
  return 100 - status.snapshot.primary.utilization;
}

export function cursorArcRemaining(status: CursorUsageStatus): number | null {
  if (status.state !== 'ok' || !status.snapshot) return null;
  return 100 - status.snapshot.plan.utilization;
}

export function copilotArcRemaining(status: CopilotUsageStatus): number | null {
  if (status.state !== 'ok' || !status.snapshot) return null;
  // Same exclusion the bars make: Completions is Settings-only. Premium
  // interactions is the quota users actually run out of; fall back to whatever
  // else is live (Chat) when it isn't reported.
  const quotas = status.snapshot.quotas.filter((q) => q.key !== 'completions');
  const primary = quotas.find((q) => q.key === 'premium_interactions') ?? quotas[0];
  if (!primary) return null; // live quota off, or signed out → no arc
  return primary.unlimited ? 100 : 100 - primary.utilization;
}

// Antigravity has no single headline quota — it's per model — so the arc shows
// the TIGHTEST of the models the bubble surfaces: that's the one about to block
// you. Takes the already-resolved visible list so this module doesn't need the
// bubble's model matchers.
export function antigravityArcRemaining(
  status: AntigravityUsageStatus,
  visible: AntigravityModelWindow[],
): number | null {
  if (status.state !== 'ok' || visible.length === 0) return null;
  return Math.min(...visible.map((m) => 100 - m.utilization));
}

import { describe, it, expect } from 'vitest';
import {
  fillColorForRemaining,
  arcColorForRemaining,
  quotaTier,
  claudeArcRemaining,
  codexArcRemaining,
  cursorArcRemaining,
  copilotArcRemaining,
  antigravityArcRemaining,
} from '../quota';
import {
  UsageStatus,
  CodexUsageStatus,
  CursorUsageStatus,
  CopilotUsageStatus,
  CopilotQuotaWindow,
  AntigravityUsageStatus,
  AntigravityModelWindow,
} from '../../../../common/types';

// The arc gauge shows ONE window where the bars show N, so these pickers decide
// what a user actually sees. Every one returns REMAINING percent (matching the
// bars' "full = headroom" semantics) or null for "draw nothing" — null and 0 are
// very different claims on a bubble, so the null paths are covered explicitly.

const RESETS = 1_800_000_000_000;

describe('fillColorForRemaining', () => {
  it('steps green → amber → red as credit drains', () => {
    const green = fillColorForRemaining(80, true);
    const amber = fillColorForRemaining(35, true);
    const red = fillColorForRemaining(5, true);
    expect(new Set([green, amber, red]).size).toBe(3);
    // Boundaries: >50 green, >20 amber, else red.
    expect(fillColorForRemaining(51, true)).toBe(green);
    expect(fillColorForRemaining(50, true)).toBe(amber);
    expect(fillColorForRemaining(21, true)).toBe(amber);
    expect(fillColorForRemaining(20, true)).toBe(red);
  });

  it('uses a different scale per theme', () => {
    expect(fillColorForRemaining(80, true)).not.toBe(fillColorForRemaining(80, false));
  });
});

describe('arc vs bar colours', () => {
  it('agrees with the bars on which tier a figure falls in', () => {
    // Both read the same thresholds through quotaTier, so the arc can never call
    // something "amber" that the bars would draw green.
    expect(quotaTier(51)).toBe('ample');
    expect(quotaTier(50)).toBe('low');
    expect(quotaTier(21)).toBe('low');
    expect(quotaTier(20)).toBe('critical');
  });

  it('keeps one distinct colour per tier on both surfaces', () => {
    for (const family of [fillColorForRemaining, arcColorForRemaining]) {
      const byTier = [95, 35, 5].map((r) => family(r, true));
      expect(new Set(byTier).size).toBe(3);
    }
  });

  it('draws the arc far more opaque than the equivalent bar', () => {
    // The bars sit on the orb's blurred glass; the arc sits on the raw desktop,
    // where sub-0.85 alpha lets a hard edge behind the bubble show through and
    // read as a break in the ring.
    const alpha = (c: string) => Number(c.match(/,([\d.]+)\)$/)![1]);
    for (const remaining of [95, 35, 5]) {
      expect(alpha(arcColorForRemaining(remaining, true)))
        .toBeGreaterThan(alpha(fillColorForRemaining(remaining, true)));
      expect(alpha(arcColorForRemaining(remaining, true))).toBeGreaterThanOrEqual(0.9);
    }
  });
});

describe('claudeArcRemaining', () => {
  const ok = (fiveHour: number, sevenDay: number): UsageStatus => ({
    state: 'ok',
    snapshot: {
      fiveHour: { utilization: fiveHour, resetsAt: RESETS },
      sevenDay: { utilization: sevenDay, resetsAt: RESETS },
    },
  });

  it('reports the 5-hour window, not the 7-day one', () => {
    // The 5-hour window is what gates the next prompt.
    expect(claudeArcRemaining(ok(30, 90))).toBe(70);
  });

  it('returns null when there is no reading', () => {
    expect(claudeArcRemaining({ state: 'unknown' })).toBeNull();
    expect(claudeArcRemaining({ state: 'error', message: 'nope' })).toBeNull();
    // 'ok' with no snapshot must not fall through to a bogus 100.
    expect(claudeArcRemaining({ state: 'ok' })).toBeNull();
  });
});

describe('codexArcRemaining / cursorArcRemaining', () => {
  it('reads the codex primary window', () => {
    const status: CodexUsageStatus = {
      state: 'ok',
      snapshot: { primary: { utilization: 82, resetsAt: RESETS } },
    };
    expect(codexArcRemaining(status)).toBe(18);
    expect(codexArcRemaining({ state: 'unknown' })).toBeNull();
  });

  it('reads the cursor billing-cycle window', () => {
    const status: CursorUsageStatus = {
      state: 'ok',
      snapshot: { plan: { utilization: 45, resetsAt: RESETS } },
    };
    expect(cursorArcRemaining(status)).toBe(55);
    expect(cursorArcRemaining({ state: 'unknown' })).toBeNull();
  });
});

describe('copilotArcRemaining', () => {
  const quota = (
    key: CopilotQuotaWindow['key'],
    utilization: number,
    unlimited = false,
  ): CopilotQuotaWindow => ({
    key,
    label: key,
    utilization,
    remaining: 100 - utilization,
    entitlement: 300,
    unlimited,
    resetsAt: RESETS,
  });

  const ok = (quotas: CopilotQuotaWindow[]): CopilotUsageStatus => ({
    state: 'ok',
    snapshot: { quotas, source: 'live' },
  });

  it('prefers premium interactions', () => {
    expect(
      copilotArcRemaining(ok([quota('chat', 10), quota('premium_interactions', 60)])),
    ).toBe(40);
  });

  it('falls back to whatever else is live when premium is absent', () => {
    expect(copilotArcRemaining(ok([quota('chat', 25)]))).toBe(75);
  });

  it('never shows the completions quota, which the bubble hides', () => {
    // Completions is Settings-only. With nothing else live there is no arc —
    // rather than silently promoting the one quota we deliberately hide.
    expect(copilotArcRemaining(ok([quota('completions', 90)]))).toBeNull();
  });

  it('reads an unlimited quota as full', () => {
    expect(
      copilotArcRemaining(ok([quota('premium_interactions', 0, true)])),
    ).toBe(100);
  });

  it('returns null with no live quota at all', () => {
    expect(copilotArcRemaining(ok([]))).toBeNull();
    expect(copilotArcRemaining({ state: 'unknown' })).toBeNull();
  });
});

describe('antigravityArcRemaining', () => {
  const model = (modelKey: string, utilization: number): AntigravityModelWindow => ({
    modelKey,
    displayName: modelKey,
    utilization,
    resetsAt: RESETS,
  });

  const ok: AntigravityUsageStatus = { state: 'ok', snapshot: { models: [] } };

  it('reports the tightest visible model — the one about to block you', () => {
    const visible = [model('opus', 20), model('flash', 75)];
    expect(antigravityArcRemaining(ok, visible)).toBe(25);
  });

  it('returns null when no model is surfaced', () => {
    // Math.min() of an empty list is Infinity, which would render a full ring.
    expect(antigravityArcRemaining(ok, [])).toBeNull();
    expect(antigravityArcRemaining({ state: 'unknown' }, [model('opus', 20)])).toBeNull();
  });
});

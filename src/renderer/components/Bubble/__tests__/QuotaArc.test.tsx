import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { QuotaArc, QUOTA_ARC_BAND } from '../QuotaArc';
import { arcColorForRemaining, arcTrackColor } from '../quota';

// The arc is pure presentation over a single number, so these lock the two
// things a reader depends on: the sweep matching the remaining credit, and the
// colour matching what the bars would have shown for the same figure.

const arcOf = (container: HTMLElement) => container.firstElementChild as HTMLElement | null;

// jsdom reserialises colours — spaces after the commas ("rgba(34, 197, 94,
// 0.7)") and trailing zeros dropped ("0.10" → "0.1"). Normalise both sides
// rather than hand-writing the serialised form, which would silently stop
// matching the helpers if their values ever changed.
const tight = (s: string) =>
  s.replace(/\s+/g, '').replace(/\d*\.\d+/g, (n) => String(Number(n)));

describe('QuotaArc', () => {
  it('renders nothing when there is no reading', () => {
    // Distinct from 0% — an empty ring would claim "no credit left".
    const { container } = render(<QuotaArc remaining={null} size={48} isDark />);
    expect(arcOf(container)).toBeNull();
  });

  it('sweeps proportionally to remaining credit', () => {
    const { container } = render(<QuotaArc remaining={75} size={48} isDark />);
    // 75% of 360deg.
    expect(arcOf(container)!.style.background).toContain('270deg');
  });

  it('sweeps a full ring at 100%', () => {
    const { container } = render(<QuotaArc remaining={100} size={48} isDark />);
    expect(arcOf(container)!.style.background).toContain('360deg');
  });

  it('clamps out-of-range values instead of overwinding', () => {
    const { container } = render(<QuotaArc remaining={140} size={48} isDark />);
    const bg = arcOf(container)!.style.background;
    expect(bg).toContain('360deg');
    expect(bg).not.toContain('504deg');
  });

  it('keeps a visible sliver just above empty', () => {
    // Matches the bars' 2% minimum width: "nearly out" must still read as a red
    // tick rather than vanishing into the track.
    const { container } = render(<QuotaArc remaining={0.4} size={48} isDark />);
    expect(arcOf(container)!.style.background).toContain('7.2deg');
  });

  it('shows a bare track at exactly zero', () => {
    const { container } = render(<QuotaArc remaining={0} size={48} isDark />);
    const bg = arcOf(container)!.style.background;
    expect(bg).toContain('0deg 0deg');
    expect(tight(bg)).toContain(tight(arcTrackColor(true)));
  });

  it('colours the sweep by quota tier', () => {
    for (const remaining of [95, 35, 5]) {
      const { container } = render(<QuotaArc remaining={remaining} size={48} isDark />);
      expect(tight(arcOf(container)!.style.background))
        .toContain(tight(arcColorForRemaining(remaining, true)));
    }
  });

  it('stays legible over an unknown desktop', () => {
    // The arc rings the orb from outside, so its backdrop is the user's desktop
    // rather than the orb's glass. At the bars' 0.6–0.8 alpha a hard edge behind
    // the bubble reads through the band and looks like the ring is cut in half,
    // so the arc is near-opaque AND blurs its own backdrop.
    const { container } = render(<QuotaArc remaining={60} size={48} isDark />);
    const style = arcOf(container)!.style;
    expect(style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'))
      .toContain('blur');
    const alphas = [...tight(style.background).matchAll(/rgba\([\d,]+,([\d.]+)\)/g)]
      .map((m) => Number(m[1]));
    expect(alphas.length).toBeGreaterThan(0);
    for (const a of alphas) expect(a).toBeGreaterThanOrEqual(0.85);
  });

  it('follows the theme', () => {
    const dark = render(<QuotaArc remaining={80} size={48} isDark />);
    const light = render(<QuotaArc remaining={80} size={48} isDark={false} />);
    expect(arcOf(dark.container)!.style.background)
      .not.toBe(arcOf(light.container)!.style.background);
  });

  it('masks a donut hole scaled to the requested size', () => {
    // The hole must be transparent, not filled: the orb, mascot and waveform
    // disc all show through the middle of the ring.
    const { container } = render(<QuotaArc remaining={50} size={48} isDark />);
    const style = arcOf(container)!.style;
    expect(style.width).toBe('48px');
    // Band consumes its own thickness off a 24px radius.
    const expected = ((24 - QUOTA_ARC_BAND) / 24) * 100;
    expect(style.getPropertyValue('mask') || style.getPropertyValue('-webkit-mask'))
      .toContain(String(expected.toFixed(2)).replace(/0+$/, '').replace(/\.$/, ''));
  });

  it('leaves the whole orb visible through the hole', () => {
    // The arc wraps the orb from OUTSIDE — callers pass orb + BAND*2, and the
    // hole must come back out at exactly the orb diameter. If the maths drifts,
    // the band starts eating the orb's face (and the logo inside it).
    for (const orb of [38, 48, 60]) {
      const size = orb + QUOTA_ARC_BAND * 2;
      const { container } = render(<QuotaArc remaining={50} size={size} isDark />);
      const mask = arcOf(container)!.style.getPropertyValue('mask')
        || arcOf(container)!.style.getPropertyValue('-webkit-mask');
      const holePct = Number(mask.match(/([\d.]+)%/)![1]);
      expect((holePct / 100) * size).toBeCloseTo(orb, 5);
    }
  });
});

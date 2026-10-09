import { describe, it, expect } from 'vitest';
import { buildLayout, loopSlice, pointAtFraction, pointAtLength } from '../cometPath';

const W = 1600, H = 1000, INSET = 3;
const RIGHT = W - INSET, BOTTOM = H - INSET;

describe('buildLayout — tray corner (Windows, non-notch Macs, external displays)', () => {
  const layout = buildLayout(W, H, { inset: INSET, cornerRadius: 0, notch: null, trayCorner: 'br' });

  it('starts and ends the loop in the tray corner', () => {
    expect(layout.notched).toBe(false);
    expect(layout.land).toEqual({ x: RIGHT, y: BOTTOM });
    expect(pointAtFraction(layout.perimeter, 0)).toEqual(layout.land);
    const end = pointAtLength(layout.perimeter, layout.perimeter.length);
    expect(end.x).toBeCloseTo(RIGHT, 2);
    expect(end.y).toBeCloseTo(BOTTOM, 2);
  });

  it('measures a square-cornered perimeter exactly', () => {
    const expected = 2 * (W - 2 * INSET) + 2 * (H - 2 * INSET);
    expect(layout.perimeter.length).toBeCloseTo(expected, 0);
  });

  it('runs clockwise: from bottom-right it heads left along the bottom edge', () => {
    const p = pointAtLength(layout.perimeter, 100);
    expect(p.x).toBeCloseTo(RIGHT - 100, 1);
    expect(p.y).toBeCloseTo(BOTTOM, 1);
  });

  it('lights both edges that meet at the corner, outward from it', () => {
    const { rimA, rimB } = layout;
    expect([rimA.xs[0], rimA.ys[0]]).toEqual([RIGHT, BOTTOM]);
    expect([rimB.xs[0], rimB.ys[0]]).toEqual([RIGHT, BOTTOM]);
    // One rim runs along the bottom edge, the other up the right edge.
    expect(rimA.ys[rimA.ys.length - 1]).toBeCloseTo(BOTTOM, 2);
    expect(rimA.xs[rimA.xs.length - 1]).toBeLessThan(RIGHT);
    expect(rimB.xs[rimB.xs.length - 1]).toBeCloseTo(RIGHT, 2);
    expect(rimB.ys[rimB.ys.length - 1]).toBeLessThan(BOTTOM);
    expect(rimA.length).toBeCloseTo(150, 0);
    expect(rimB.length).toBeCloseTo(150, 0);
  });

  it.each([
    ['tl', INSET, INSET],
    ['tr', RIGHT, INSET],
    ['bl', INSET, BOTTOM],
  ] as const)('lands in the %s corner when the tray is there', (corner, x, y) => {
    const l = buildLayout(W, H, { inset: INSET, cornerRadius: 0, notch: null, trayCorner: corner });
    expect(l.land).toEqual({ x, y });
    expect(l.perimeter.length).toBeCloseTo(layout.perimeter.length, 0);
  });

  it('lands mid-way round a rounded corner, and the loop still closes there', () => {
    const r = 10;
    const l = buildLayout(W, H, { inset: INSET, cornerRadius: r, notch: null, trayCorner: 'tr' });
    // Quadratic midpoint of the corner: pulled r/4 in from the sharp corner on both axes.
    expect(l.land.x).toBeCloseTo(RIGHT - r / 4, 5);
    expect(l.land.y).toBeCloseTo(INSET + r / 4, 5);
    const end = pointAtLength(l.perimeter, l.perimeter.length);
    expect(end.x).toBeCloseTo(l.land.x, 2);
    expect(end.y).toBeCloseTo(l.land.y, 2);
    expect(l.perimeter.length).toBeLessThan(layout.perimeter.length);
  });
});

describe('buildLayout — real notch', () => {
  const notch = { width: 190, height: 37 };
  const layout = buildLayout(W, H, { inset: INSET, cornerRadius: 10, notch, trayCorner: 'tr' });

  it('lands just under the notch (ignoring the tray corner) and dips around it', () => {
    expect(layout.notched).toBe(true);
    expect(layout.land).toEqual({ x: W / 2, y: notch.height + INSET });
    const plain = buildLayout(W, H, { inset: INSET, cornerRadius: 10, notch: null, trayCorner: 'tr' });
    expect(layout.perimeter.length).toBeGreaterThan(plain.perimeter.length + notch.height);
  });

  it('never enters the notch cut-out', () => {
    const { xs, ys } = layout.perimeter;
    const x0 = W / 2 - notch.width / 2, x1 = W / 2 + notch.width / 2;
    for (let i = 0; i < xs.length; i++) {
      const inside = xs[i] > x0 && xs[i] < x1 && ys[i] < notch.height;
      expect(inside).toBe(false);
    }
  });

  it('outlines the notch itself for the landing rim', () => {
    expect(layout.rimA.ys[0]).toBe(notch.height);
    expect(layout.rimA.ys[layout.rimA.ys.length - 1]).toBe(0);
    expect(layout.rimA.xs[layout.rimA.xs.length - 1]).toBeCloseTo(W / 2 + notch.width / 2, 5);
    expect(layout.rimB.xs[layout.rimB.xs.length - 1]).toBeCloseTo(W / 2 - notch.width / 2, 5);
  });
});

describe('loopSlice', () => {
  const loop = buildLayout(W, H, { inset: INSET, cornerRadius: 0, notch: null, trayCorner: 'br' }).perimeter;

  it('returns the endpoints of a short slice', () => {
    const pts = loopSlice(loop, 10, 50);
    expect(pts[0]).toBeCloseTo(RIGHT - 10, 2);
    expect(pts[pts.length - 2]).toBeCloseTo(RIGHT - 50, 2);
  });

  it('wraps backwards across the start of the loop and keeps the corner vertex', () => {
    // Tail 40px behind a head 40px past the start: turns the bottom-right corner.
    const pts = loopSlice(loop, -40, 40);
    expect(pts[0]).toBeCloseTo(RIGHT, 1);
    expect(pts[1]).toBeCloseTo(BOTTOM - 40, 1);
    expect(pts[pts.length - 2]).toBeCloseTo(RIGHT - 40, 1);
    expect(pts[pts.length - 1]).toBeCloseTo(BOTTOM, 1);
    let hasCorner = false;
    for (let i = 0; i < pts.length; i += 2) {
      if (Math.abs(pts[i] - RIGHT) < 1e-2 && Math.abs(pts[i + 1] - BOTTOM) < 1e-2) hasCorner = true;
    }
    expect(hasCorner).toBe(true);
  });

  it('is empty for a zero-length slice', () => {
    expect(loopSlice(loop, 5, 5)).toEqual([]);
  });
});

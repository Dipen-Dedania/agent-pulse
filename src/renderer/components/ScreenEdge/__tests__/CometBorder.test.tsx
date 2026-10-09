import React from 'react';
import { render, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CometBorder } from '../CometBorder';
import { EDGE_TIMINGS } from '../../../../common/screenEdge';

// jsdom has no canvas, so drive the real drawing code against a recording
// 2D context and a manual animation clock. This checks the comet's runtime
// behaviour end to end — every coordinate it draws, where it lands, and that
// the loop really idles during the rest gap — without a screen.

const W = 1920, H = 1032; // a 1080p display above a 48px bottom taskbar

type Op = { op: string; args: number[] };

function recordingContext() {
  const ops: Op[] = [];
  const rec = (op: string) => (...args: unknown[]) => { ops.push({ op, args: args.filter((a): a is number => typeof a === 'number') }); };
  const ctx = {
    ops,
    setTransform: rec('setTransform'), clearRect: rec('clearRect'),
    beginPath: rec('beginPath'), moveTo: rec('moveTo'), lineTo: rec('lineTo'),
    stroke: rec('stroke'), arc: rec('arc'), fill: rec('fill'),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    globalCompositeOperation: 'source-over', lineCap: 'butt', lineJoin: 'miter',
    lineWidth: 1, strokeStyle: '', fillStyle: '',
  };
  return ctx;
}

let ctx: ReturnType<typeof recordingContext>;
let now = 0;
let frames: Map<number, FrameRequestCallback>;
let nextId = 1;

function runFrames(ms: number, step = 16) {
  const end = now + ms;
  while (now < end) {
    now += step;
    act(() => { vi.advanceTimersByTime(step); });
    const pending = [...frames.values()];
    frames.clear();
    act(() => { pending.forEach((cb) => cb(now)); });
  }
}

beforeEach(() => {
  ctx = recordingContext();
  now = 0;
  frames = new Map();
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { const id = nextId++; frames.set(id, cb); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  Object.defineProperty(window, 'innerWidth', { value: W, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: H, configurable: true });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const geometry = { notch: null, cornerRadius: 0, trayCorner: 'br' as const };
const pathPoints = (ops: Op[]) => ops.filter((o) => o.op === 'moveTo' || o.op === 'lineTo').map((o) => o.args);

describe('CometBorder (Windows, bottom taskbar)', () => {
  it('draws only finite points inside the window for a whole lap', () => {
    render(<CometBorder color='blue' speed='normal' geometry={geometry} paused={false} />);
    runFrames(EDGE_TIMINGS.normal.lap * 1000);
    const pts = pathPoints(ctx.ops);
    expect(pts.length).toBeGreaterThan(1000);
    for (const [x, y] of pts) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(H);
    }
    // The comet visits all four edges of the screen during the lap.
    const near = (v: number, target: number) => Math.abs(v - target) < 6;
    expect(pts.some(([, y]) => near(y, 3))).toBe(true);       // top
    expect(pts.some(([, y]) => near(y, H - 3))).toBe(true);   // bottom
    expect(pts.some(([x]) => near(x, 3))).toBe(true);         // left
    expect(pts.some(([x]) => near(x, W - 3))).toBe(true);     // right
  });

  it('lands in the bottom-right tray corner, not at the top centre', () => {
    render(<CometBorder color='blue' speed='normal' geometry={geometry} paused={false} />);
    runFrames(EDGE_TIMINGS.normal.lap * 1000);
    ctx.ops.length = 0;
    runFrames(EDGE_TIMINGS.normal.land * 1000 * 0.3);
    const flashes = ctx.ops.filter((o) => o.op === 'arc');
    expect(flashes.length).toBeGreaterThan(0);
    for (const { args: [x, y] } of flashes) {
      expect(x).toBeCloseTo(W - 3, 0);
      expect(y).toBeCloseTo(H - 3, 0);
    }
    // The landing rim lights the two edges meeting at that corner.
    const rim = pathPoints(ctx.ops);
    expect(rim.some(([x, y]) => y === H - 3 && x < W - 50)).toBe(true);
    expect(rim.some(([x, y]) => x === W - 3 && y < H - 50)).toBe(true);
  });

  it('stops requesting frames during the rest gap, then starts the next lap', () => {
    render(<CometBorder color='blue' speed='normal' geometry={geometry} paused={false} />);
    const t = EDGE_TIMINGS.normal;
    runFrames((t.lap + t.land) * 1000 + 50);
    expect(frames.size).toBe(0); // idle: no animation frame pending
    ctx.ops.length = 0;
    runFrames(t.rest * 1000 * 0.8);
    expect(ctx.ops.filter((o) => o.op === 'stroke' || o.op === 'fill')).toHaveLength(0);
    runFrames(t.rest * 1000 * 0.4);
    expect(ctx.ops.some((o) => o.op === 'fill')).toBe(true); // next lap's head is drawn
  });

  it('draws nothing while paused (screen locked)', () => {
    render(<CometBorder color='blue' speed='normal' geometry={geometry} paused />);
    runFrames(1000);
    expect(ctx.ops.filter((o) => o.op === 'stroke' || o.op === 'fill')).toHaveLength(0);
    expect(frames.size).toBe(0);
  });
});

describe('CometBorder (notched MacBook)', () => {
  it('lands under the notch at the top centre', () => {
    const notched = { notch: { width: 192, height: 37 }, cornerRadius: 10, trayCorner: 'tr' as const };
    render(<CometBorder color='green' speed='fast' geometry={notched} paused={false} />);
    runFrames(EDGE_TIMINGS.fast.lap * 1000);
    ctx.ops.length = 0;
    runFrames(100);
    const flash = ctx.ops.find((o) => o.op === 'arc')!;
    expect(flash.args[0]).toBeCloseTo(W / 2, 0);
    expect(flash.args[1]).toBeCloseTo(37 + 3, 0);
  });
});

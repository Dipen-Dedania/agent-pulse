import React, { useEffect, useRef } from 'react';
import { EDGE_PALETTES, EDGE_TIMINGS, EdgeGeometry } from '../../../common/screenEdge';
import type { ScreenEdgeColor, ScreenEdgeSpeed } from '../../../common/types';
import { buildLayout, EdgeLayout, loopSlice, pointAtLength, Polyline } from './cometPath';

// Comet border: a bright head with a tapering tail laps the screen edge,
// lands with a flash and a rim of light, rests, and goes again — for as long as
// an agent is waiting. It lands on the camera notch of a notched MacBook, and
// everywhere else in the corner next to the tray (Windows taskbar end, or the
// macOS menu bar icons), so it never imitates a notch the screen doesn't have.
//
// Drawn on one Canvas 2D layer instead of SVG: this window is full-screen and
// transparent, so blur filters would be re-rasterised over the whole display
// every frame. Here the glow is a few wide, low-alpha strokes in `lighter`
// mode, only the region drawn last frame is cleared, and the animation loop
// stops completely during the rest gap and while paused or hidden.

interface Props {
  color: ScreenEdgeColor;
  speed: ScreenEdgeSpeed;
  geometry: EdgeGeometry;
  paused: boolean;
}

const INSET = 3;          // path distance from the screen edge (px)
const TRAIL = 0.15;       // tail length at full stretch, as a fraction of the perimeter
const COLLAPSE = 0.2;     // tail shrinks over the last 20% of the lap so it lands as a point
const TAIL_PIECES = 40;   // tail is drawn as this many tapered pieces
const CORE_W = 7;         // tail width at the head (px)
const HEAD_R = 7;         // head core radius (px)

type Box = { x0: number; y0: number; x1: number; y1: number };
const EMPTY: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
// Our travel curve: mostly a sine ease (gentle launch, unhurried landing) with
// a little linear mixed in so the comet never looks stalled at either end.
const travelEase = (x: number) => 0.85 * (0.5 - 0.5 * Math.cos(Math.PI * x)) + 0.15 * x;
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 2;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba([r, g, b]: [number, number, number], a: number) {
  return `rgba(${r},${g},${b},${a})`;
}
function lerpRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t].map(Math.round) as [number, number, number];
}

export const CometBorder: React.FC<Props> = ({ color, speed, geometry, paused }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const palette = EDGE_PALETTES[color];
    const timing = EDGE_TIMINGS[speed];
    const white: [number, number, number] = [255, 255, 255];
    const bright = hexRgb(palette.bright), brand = hexRgb(palette.brand), deep = hexRgb(palette.deep);
    // Tail colour ramp: white-hot behind the head → bright → deep at the tip.
    const tailColor = (o: number) => (o < 0.12 ? lerpRgb(white, bright, o / 0.12) : lerpRgb(bright, deep, (o - 0.12) / 0.88));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let layout: EdgeLayout;
    let dpr = 1;
    let dirty: Box = { ...EMPTY };
    const scratch: number[] = [];

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth, h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      layout = buildLayout(w, h, {
        inset: INSET, cornerRadius: geometry.cornerRadius, notch: geometry.notch, trayCorner: geometry.trayCorner,
      });
      dirty = { x0: 0, y0: 0, x1: w, y1: h };
    };

    // ── drawing helpers ──────────────────────────────────────────────────
    let box: Box = { ...EMPTY };
    const grow = (x: number, y: number, pad: number) => {
      box.x0 = Math.min(box.x0, x - pad); box.y0 = Math.min(box.y0, y - pad);
      box.x1 = Math.max(box.x1, x + pad); box.y1 = Math.max(box.y1, y + pad);
    };
    // `additive` strokes (halo, rim glow) brighten what they overlap; tail
    // pieces paint normally with flat ends so their joins don't bead up.
    const strokePts = (pts: number[], width: number, style: string, additive = true, cap: CanvasLineCap = additive ? 'round' : 'butt') => {
      if (pts.length < 4) return;
      ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      ctx.lineCap = cap;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.stroke();
      for (let i = 0; i < pts.length; i += 2) grow(pts[i], pts[i + 1], width);
    };
    const glowDot = (x: number, y: number, r: number, inner: string, outer: string) => {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, inner);
      g.addColorStop(1, outer);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      grow(x, y, r);
    };
    const begin = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Clear only what the previous frame touched (plus a margin for AA).
      if (dirty.x1 > dirty.x0) ctx.clearRect(dirty.x0 - 2, dirty.y0 - 2, dirty.x1 - dirty.x0 + 4, dirty.y1 - dirty.y0 + 4);
      box = { ...EMPTY };
      ctx.lineJoin = 'round';
    };
    const end = () => { dirty = box; };

    // ── phases ───────────────────────────────────────────────────────────
    const drawTravel = (x: number, t: number) => {
      const loop = layout.perimeter, L = loop.length;
      const pos = travelEase(x);                                      // 0 → 1 lap
      const len = Math.min(TRAIL, pos) * Math.min(1, (1 - pos) / COLLAPSE);
      const head = pos * L, tail = len * L;
      const pulse = 1 + 0.08 * Math.sin(t * Math.PI * 4.4);

      if (tail > 0.5) {
        // Halo pass: two wide, faint strokes of the brand colour under the tail.
        for (const [mul, alpha] of [[5, 0.07], [2.6, 0.14]] as const) {
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * tail, b = ((k + 1) / 4) * tail, o = (k + 0.5) / 4;
            loopSlice(loop, head - b, head - a, scratch);
            strokePts(scratch, CORE_W * mul * (1 - 0.7 * o), rgba(brand, alpha * (1 - o)), true, 'butt');
          }
        }
        // Core pass: tapered pieces, thinning and darkening toward the tip.
        for (let k = 0; k < TAIL_PIECES; k++) {
          const o = (k + 0.5) / TAIL_PIECES;
          const a = (k / TAIL_PIECES) * tail, b = ((k + 1) / TAIL_PIECES) * tail;
          loopSlice(loop, head - b, head - a + 0.5, scratch);
          strokePts(scratch, Math.max(0.6, CORE_W * (1 - 0.88 * o ** 0.85)), rgba(tailColor(o), (1 - o) ** 1.4), false);
        }
      }
      const p = pointAtLength(loop, ((head % L) + L) % L);
      glowDot(p.x, p.y, 34 * pulse, rgba(bright, 0.55), rgba(brand, 0));
      glowDot(p.x, p.y, HEAD_R * pulse, 'rgba(255,255,255,1)', rgba(bright, 0));
    };

    const drawRim = (amount: number, width: number, style: string) => {
      for (const half of [layout.rimA, layout.rimB] as Polyline[]) {
        const n = half.cum.length;
        scratch.length = 0;
        for (let i = 0; i < n && half.cum[i] <= amount * half.length; i++) scratch.push(half.xs[i], half.ys[i]);
        const tip = pointAtLength(half, amount * half.length);
        scratch.push(tip.x, tip.y);
        strokePts(scratch, width, style);
      }
    };

    const drawLanding = (e: number) => {
      const { land, notched, rimA } = layout;
      const fade = e < 0.7 ? 1 : 1 - (e - 0.7) / 0.3;

      // Flash: a quick white bloom where the comet touched down.
      const f = clamp01(e / 0.2);
      glowDot(land.x, land.y, 14 + 90 * easeOut(f), rgba(white, 0.9 * (1 - f)), rgba(bright, 0));

      // Bloom: a soft breath of colour — around the notch, or into the tray corner.
      const b = Math.sin(Math.PI * clamp01((e - 0.08) / 0.7));
      const bloomR = notched ? Math.abs(rimA.xs[rimA.xs.length - 1] - land.x) * 1.5 : 130;
      const bloomY = notched ? land.y / 2 : land.y;
      if (b > 0) glowDot(land.x, bloomY, bloomR * (1 + 0.25 * b), rgba(brand, 0.35 * b * fade), rgba(brand, 0));

      // Rim: the notch outline, or the two screen edges meeting at the tray
      // corner, lights outward from the landing point.
      const amount = easeOut(e / 0.35);
      if (fade > 0) {
        drawRim(amount, 14, rgba(bright, 0.35 * fade));
        drawRim(amount, 3.5, rgba(lerpRgb(bright, white, 0.6), fade));
      }
    };

    // ── loop ─────────────────────────────────────────────────────────────
    let raf = 0;
    let restTimer: ReturnType<typeof setTimeout> | null = null;
    let cycleStart = performance.now();
    const travelMs = timing.lap * 1000, landMs = timing.land * 1000;

    const frame = (now: number) => {
      raf = 0;
      const t = (now - cycleStart) / 1000;
      const ms = now - cycleStart;
      begin();
      if (ms < travelMs) {
        drawTravel(ms / travelMs, t);
      } else if (ms < travelMs + landMs) {
        drawLanding((ms - travelMs) / landMs);
      } else {
        // Rest: leave the screen clear and idle the loop until the next lap.
        end();
        restTimer = setTimeout(() => {
          restTimer = null;
          cycleStart = performance.now();
          schedule();
        }, timing.rest * 1000);
        return;
      }
      end();
      schedule();
    };

    const schedule = () => {
      if (!raf && !restTimer && !paused && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const halt = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (restTimer) { clearTimeout(restTimer); restTimer = null; }
    };
    const onVisibility = () => {
      if (document.hidden) halt();
      else if (reduced) drawStatic();
      else { cycleStart = performance.now(); schedule(); }
    };

    const drawStatic = () => {
      // Reduced motion: no lap — just the landing rim, steadily lit.
      begin();
      drawLanding(0.5);
      end();
    };

    resize();
    const onResize = () => { halt(); resize(); if (reduced) drawStatic(); else { cycleStart = performance.now(); schedule(); } };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    if (reduced) drawStatic(); else schedule();

    return () => {
      halt();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [color, speed, geometry.cornerRadius, geometry.notch?.width, geometry.notch?.height, geometry.trayCorner, paused]);

  return <canvas ref={canvasRef} className='absolute inset-0 w-full h-full' />;
};

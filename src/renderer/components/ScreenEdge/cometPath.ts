import type { EdgeCorner, EdgeNotch } from '../../../common/screenEdge';

// Geometry for the comet border, kept free of canvas/DOM so it can be unit
// tested. Every path is pre-sampled into a dense polyline with cumulative
// arc lengths, so "where is the comet at fraction s" is a binary search and a
// lerp — no SVG path measuring at runtime.

export interface Polyline {
  xs: Float32Array;
  ys: Float32Array;
  cum: Float32Array; // cumulative length at each vertex; cum[0] = 0
  length: number;
}

export interface EdgeLayout {
  perimeter: Polyline;   // closed loop, starts AND ends at the landing point, runs clockwise
  rimA: Polyline;        // landing rim, out from the landing point one way …
  rimB: Polyline;        // … and the other (drawn together, growing from the landing point)
  land: { x: number; y: number };
  notched: boolean;      // true = lands on the camera notch; false = lands in the tray corner
}

export interface LayoutOptions {
  inset: number;        // path distance from the window edge
  cornerRadius: number; // display corner rounding (0 = square)
  notch: EdgeNotch | null;
  trayCorner: EdgeCorner; // where to land when there's no notch
  rimLength?: number;   // how far the corner rim lights along each edge (px)
  step?: number;        // sampling distance in px
}

const DEFAULT_RIM = 150;

class Sampler {
  private xs: number[] = [];
  private ys: number[] = [];
  private x = 0;
  private y = 0;
  constructor(private readonly step: number) {}

  moveTo(x: number, y: number) {
    this.x = x; this.y = y;
    this.xs.push(x); this.ys.push(y);
    return this;
  }

  lineTo(x: number, y: number) {
    const n = Math.max(1, Math.ceil(Math.hypot(x - this.x, y - this.y) / this.step));
    for (let i = 1; i <= n; i++) {
      this.xs.push(this.x + ((x - this.x) * i) / n);
      this.ys.push(this.y + ((y - this.y) * i) / n);
    }
    this.x = x; this.y = y;
    return this;
  }

  // Rounded corner: quadratic curve with the control point on the sharp corner.
  quadTo(cx: number, cy: number, x: number, y: number) {
    const approx = Math.hypot(cx - this.x, cy - this.y) + Math.hypot(x - cx, y - cy);
    if (approx < 1e-6) return this;
    const n = Math.max(2, Math.ceil(approx / this.step));
    const x0 = this.x, y0 = this.y;
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      this.xs.push(u * u * x0 + 2 * u * t * cx + t * t * x);
      this.ys.push(u * u * y0 + 2 * u * t * cy + t * t * y);
    }
    this.x = x; this.y = y;
    return this;
  }

  // Corner at (cx, cy), turning from the current heading toward (x, y). Ends at
  // the far tangent point of the rounding (the corner itself when r = 0); the
  // next call draws the straight run from there.
  corner(cx: number, cy: number, x: number, y: number, r: number) {
    if (r <= 0) return this.lineTo(cx, cy);
    const dx0 = Math.sign(cx - this.x), dy0 = Math.sign(cy - this.y);
    const dx1 = Math.sign(x - cx), dy1 = Math.sign(y - cy);
    return this.lineTo(cx - dx0 * r, cy - dy0 * r).quadTo(cx, cy, cx + dx1 * r, cy + dy1 * r);
  }

  build(): Polyline {
    const n = this.xs.length;
    const xs = Float32Array.from(this.xs), ys = Float32Array.from(this.ys);
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    return { xs, ys, cum, length: n ? cum[n - 1] : 0 };
  }
}

export function buildLayout(width: number, height: number, opts: LayoutOptions): EdgeLayout {
  const step = opts.step ?? 4;
  const t = opts.inset;
  const r = Math.min(opts.cornerRadius, (height - 2 * t) / 2);
  const cx = width / 2;
  const right = width - t, bottom = height - t;

  // ── Notched Mac: the loop starts under the notch and dips around it ─────
  if (opts.notch) {
    const { width: sw, height: sh } = opts.notch;
    const sr = Math.min(10, sh / 2);
    const sx0 = cx - sw / 2, sx1 = cx + sw / 2;
    // The comet runs `inset` px outside the notch outline, mirroring the screen edge.
    const nb = sh + t;
    const nr = Math.min(sr, sw / 2 - t);
    const lip = Math.min(8, nb / 2);
    const p = new Sampler(step).moveTo(cx, nb)
      .corner(sx1 + t, nb, sx1 + t, t, nr).corner(sx1 + t, t, right, t, lip)
      .corner(right, t, right, bottom, r)
      .corner(right, bottom, t, bottom, r)
      .corner(t, bottom, t, t, r)
      .corner(t, t, sx0 - t, t, r).corner(sx0 - t, t, sx0 - t, nb, lip).corner(sx0 - t, nb, cx, nb, nr)
      .lineTo(cx, nb);
    // Rim: the notch's own outline, from its bottom centre out to each top corner.
    return {
      perimeter: p.build(),
      rimA: new Sampler(step).moveTo(cx, sh).corner(sx1, sh, sx1, 0, sr).lineTo(sx1, 0).build(),
      rimB: new Sampler(step).moveTo(cx, sh).corner(sx0, sh, sx0, 0, sr).lineTo(sx0, 0).build(),
      land: { x: cx, y: nb },
      notched: true,
    };
  }

  // ── Everything else: the loop starts and ends in the tray corner ────────
  // Corners in clockwise order; the loop is built starting at the tray corner.
  const corners: Record<EdgeCorner, [number, number]> = {
    tl: [t, t], tr: [right, t], br: [right, bottom], bl: [t, bottom],
  };
  const order: EdgeCorner[] = ['tl', 'tr', 'br', 'bl'];
  const i0 = order.indexOf(opts.trayCorner);
  const seq = [0, 1, 2, 3, 4].map((k) => corners[order[(i0 + k) % 4]]);
  // Start at the middle of the tray corner's rounding (the corner itself when square).
  const [sx, sy] = seq[0];
  const [nx, ny] = seq[1];
  const [px, py] = seq[3];
  const ux = Math.sign(nx - sx), uy = Math.sign(ny - sy);   // heading out of the corner
  const vx = Math.sign(sx - px), vy = Math.sign(sy - py);   // heading into the corner
  const k = r > 0 ? 0.25 : 0; // quadratic midpoint: (1/4)·in-tangent + (1/2)·corner + (1/4)·out-tangent
  const land = {
    x: sx + k * (ux * r - vx * r),
    y: sy + k * (uy * r - vy * r),
  };
  const p = new Sampler(step).moveTo(land.x, land.y);
  // Second half of the tray corner's rounding (control point halfway to the out-tangent).
  if (r > 0) p.quadTo(sx + ux * r * 0.5, sy + uy * r * 0.5, sx + ux * r, sy + uy * r);
  for (let c = 1; c <= 3; c++) {
    const [ax, ay] = seq[c];
    const [bx, by] = seq[c + 1];
    p.corner(ax, ay, bx, by, r);
  }
  // Back into the tray corner: straight run, then the first half of its rounding.
  if (r > 0) p.lineTo(sx - vx * r, sy - vy * r).quadTo(sx - vx * r * 0.5, sy - vy * r * 0.5, land.x, land.y);
  else p.lineTo(sx, sy);
  const perimeter = p.build();

  // Rim: light both edges meeting at the corner, outward from the landing point.
  const rim = Math.min(opts.rimLength ?? DEFAULT_RIM, perimeter.length / 8);
  return {
    perimeter,
    rimA: slicePolyline(perimeter, 0, rim),
    rimB: slicePolyline(perimeter, perimeter.length, perimeter.length - rim),
    land,
    notched: false,
  };
}

/** A sub-polyline of `line` from arc length `from` to `to` (reversed when to < from). */
function slicePolyline(line: Polyline, from: number, to: number): Polyline {
  const lo = Math.min(from, to), hi = Math.max(from, to);
  const xs: number[] = [], ys: number[] = [];
  const a = pointAtLength(line, lo);
  xs.push(a.x); ys.push(a.y);
  for (let i = 0; i < line.cum.length; i++) {
    if (line.cum[i] > lo && line.cum[i] < hi) { xs.push(line.xs[i]); ys.push(line.ys[i]); }
  }
  const b = pointAtLength(line, hi);
  xs.push(b.x); ys.push(b.y);
  if (to < from) { xs.reverse(); ys.reverse(); }
  const built = { xs: Float32Array.from(xs), ys: Float32Array.from(ys), cum: new Float32Array(xs.length), length: 0 };
  for (let i = 1; i < xs.length; i++) built.cum[i] = built.cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
  built.length = xs.length ? built.cum[xs.length - 1] : 0;
  return built;
}

/** Index of the segment containing arc length `d` (clamped to the polyline). */
function segmentAt(line: Polyline, d: number): number {
  let lo = 0, hi = line.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line.cum[mid] <= d) lo = mid; else hi = mid;
  }
  return lo;
}

/** Point at arc length `d` along an open polyline (clamped). */
export function pointAtLength(line: Polyline, d: number): { x: number; y: number } {
  const n = line.cum.length;
  if (n === 0) return { x: 0, y: 0 };
  if (d <= 0) return { x: line.xs[0], y: line.ys[0] };
  if (d >= line.length) return { x: line.xs[n - 1], y: line.ys[n - 1] };
  const i = segmentAt(line, d);
  const span = line.cum[i + 1] - line.cum[i] || 1;
  const k = (d - line.cum[i]) / span;
  return { x: line.xs[i] + (line.xs[i + 1] - line.xs[i]) * k, y: line.ys[i] + (line.ys[i + 1] - line.ys[i]) * k };
}

/** Point at fraction `s` of a closed loop (wraps). */
export function pointAtFraction(loop: Polyline, s: number): { x: number; y: number } {
  const f = ((s % 1) + 1) % 1;
  return pointAtLength(loop, f * loop.length);
}

/**
 * Points along a closed loop from arc length `from` to `to` (to > from; both may
 * be negative or exceed one lap — they wrap). Includes interpolated endpoints
 * plus every vertex in between, so corners stay sharp at any sampling step.
 */
export function loopSlice(loop: Polyline, from: number, to: number, out: number[] = []): number[] {
  out.length = 0;
  const L = loop.length;
  if (L === 0 || to <= from) return out;
  const start = pointAtLength(loop, ((from % L) + L) % L);
  out.push(start.x, start.y);
  let d = from;
  while (d < to) {
    const local = ((d % L) + L) % L;
    let i = segmentAt(loop, local) + 1;
    // Walk vertices until we pass `to` or wrap off the end of this lap.
    for (; i < loop.cum.length; i++) {
      const vd = d - local + loop.cum[i];
      if (vd >= to) break;
      out.push(loop.xs[i], loop.ys[i]);
    }
    if (i < loop.cum.length) break;       // reached `to` within this lap
    d = d - local + L + 1e-6;             // continue on the next lap
  }
  const end = pointAtLength(loop, ((to % L) + L) % L);
  out.push(end.x, end.y);
  return out;
}

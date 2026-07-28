import React, { useEffect, useRef } from 'react';
import { AgentState } from '../../../common/types';

// ── "3D orb" bubble fill ─────────────────────────────────────────────────────
// A rotating dotted point-cloud rendered on a plain 2D canvas (no WebGL), with
// the tool logo pinned in the centre. Inspired by the technique behind
// thinking-orbs (MIT): points are placed on a unit sphere / ring, rotated each
// frame, depth-sorted back-to-front, and drawn as filled arcs whose radius and
// alpha scale with depth — that depth-shading is what reads as 3D.
//
// The agent state drives the formation, motion and colour:
//   idle         → calm dotted ring, neutral ink, frozen
//   idle-active  → dotted ring, amber, gentle spin
//   waiting      → multi-ring globe with a rolling brightness wave ("listening")
//   working      → dense rotating sphere ("solving")
//   error        → dotted ring, red, slight jitter
//
// The logo is drawn as an <img> overlay ABOVE the canvas, so it stays fully
// legible — the cloud orbits behind it rather than occluding it.

type Formation = 'ring' | 'globe' | 'sphere';

interface StatePreset {
  formation: Formation;
  spin: number;      // radians/sec around the vertical axis (0 = frozen)
  wave: boolean;     // rolling brightness wave (listening)
  jitter: number;    // per-dot positional jitter amplitude (error)
  color: (isDark: boolean) => [number, number, number];
}

// Monochrome ink for the calm ring states follows the theme (light dots on dark
// backgrounds, dark dots on light) so they stay visible on the glass disc.
const ink = (isDark: boolean): [number, number, number] =>
  isDark ? [235, 238, 245] : [51, 65, 85];

export const PRESETS: Record<AgentState, StatePreset> = {
  idle: { formation: 'ring', spin: 0.15, wave: false, jitter: 0, color: ink },
  'idle-active': {
    formation: 'ring', spin: 0.6, wave: false, jitter: 0,
    color: (d) => (d ? [250, 204, 21] : [202, 138, 4]),
  },
  waiting: {
    formation: 'globe', spin: 0.5, wave: true, jitter: 0,
    color: (d) => (d ? [96, 165, 250] : [37, 99, 235]),
  },
  working: {
    formation: 'sphere', spin: 1.5, wave: false, jitter: 0,
    color: (d) => (d ? [52, 211, 153] : [22, 163, 74]),
  },
  error: {
    formation: 'ring', spin: 0, wave: false, jitter: 0.05,
    color: (d) => (d ? [248, 113, 113] : [220, 38, 38]),
  },
};

interface Point { x: number; y: number; z: number; phase: number }

// Deterministic hash (classic GLSL fract-sin) for stable per-dot jitter.
const hash = (n: number): number => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

// Point count scales with orb size and formation so a 38px orb doesn't turn to
// mush and a 60px orb doesn't waste cycles.
export function buildPoints(formation: Formation, size: number): Point[] {
  const tier = size < 44 ? 0 : size < 56 ? 1 : 2;
  if (formation === 'ring') {
    const n = [18, 22, 28][tier];
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return { x: Math.cos(a), y: Math.sin(a) * 0.28, z: Math.sin(a), phase: a };
    });
  }
  if (formation === 'globe') {
    // A few latitude rings — reads as a wireframe globe and gives the
    // "listening" wave something to roll along.
    const rings = [3, 4, 5][tier];
    const per = [10, 12, 14][tier];
    const pts: Point[] = [];
    for (let r = 0; r < rings; r++) {
      const lat = (-Math.PI / 2) + ((r + 1) / (rings + 1)) * Math.PI;
      const cy = Math.sin(lat);
      const cr = Math.cos(lat);
      for (let i = 0; i < per; i++) {
        const lon = (i / per) * Math.PI * 2;
        pts.push({ x: cr * Math.cos(lon), y: cy, z: cr * Math.sin(lon), phase: lat });
      }
    }
    return pts;
  }
  // Fibonacci sphere — evenly distributed dense cloud.
  const n = [70, 100, 130][tier];
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = i * golden;
    return { x: r * Math.cos(theta), y, z: r * Math.sin(theta), phase: theta };
  });
}

interface Props {
  state: AgentState;
  iconSrc: string;
  iconAlt: string;
  size: number;   // orb diameter in CSS px
  isDark: boolean;
}

export const ParticleOrb: React.FC<Props> = ({ state, iconSrc, iconAlt, size, isDark }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);

    const preset = PRESETS[state] ?? PRESETS.idle;
    const points = buildPoints(preset.formation, size);
    const [cr, cg, cb] = preset.color(isDark);

    const cx = size / 2;
    const cy = size / 2;
    const baseR = size * 0.46;    // cloud reaches near the orb edge
    const camD = 3;               // perspective camera distance (unit space)
    const tiltX = 0.42;           // constant lean so rings read as 3D ellipses
    const dotBase = size < 44 ? 0.7 : 0.9;
    const dotDepth = size < 44 ? 0.9 : 1.3;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // Calm states with no spin/wave/jitter never need a loop.
    const animated = !reduceMotion && (preset.spin !== 0 || preset.wave || preset.jitter > 0);

    const cosT = Math.cos(tiltX);
    const sinT = Math.sin(tiltX);

    const draw = (t: number) => {
      ctx.clearRect(0, 0, size, size);
      const spin = preset.spin * t;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);

      const projected = points.map((p) => {
        let px = p.x;
        let py = p.y;
        let pz = p.z;
        if (preset.jitter > 0) {
          const j = preset.jitter;
          px += (hash(p.phase * 7.1 + t * 3) - 0.5) * j;
          py += (hash(p.phase * 3.3 + t * 3.7) - 0.5) * j;
        }
        // rotate around Y (vertical)
        const rx = px * cs + pz * sn;
        const rz = -px * sn + pz * cs;
        // constant tilt around X so the axis leans toward the viewer
        const ry = py * cosT - rz * sinT;
        const rzz = py * sinT + rz * cosT;
        const scale = camD / (camD - rzz);
        const depth = (rzz + 1) / 2; // 0 far … 1 near
        // rolling brightness wave for "listening"
        let bright = depth;
        if (preset.wave) {
          const w = 0.5 + 0.5 * Math.sin(p.phase * 3 - t * 3.5);
          bright = Math.min(1, depth * 0.6 + w * 0.6);
        }
        return {
          sx: cx + rx * baseR * scale,
          sy: cy + ry * baseR * scale,
          rzz,
          r: (dotBase + dotDepth * depth) * scale,
          a: 0.25 + 0.75 * bright,
        };
      });

      projected.sort((a, b) => a.rzz - b.rzz); // painter's algorithm

      for (const p of projected) {
        if (p.a < 0.03) continue;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${p.a.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, Math.max(0.4, p.r), 0, Math.PI * 2);
        ctx.fill();
      }
    };

    if (!animated) {
      draw(0);
      return;
    }

    // Animated: 30fps cap, paused while the tab is hidden.
    let raf = 0;
    let last = 0;
    const frameMs = 1000 / 30;
    const start = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (now - last < frameMs) return;
      last = now;
      draw((now - start) / 1000);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, size, isDark]);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width: size, height: size }}
      />
      <img
        src={iconSrc}
        alt={iconAlt}
        draggable={false}
        className='object-contain'
        style={{
          position: 'relative',
          width: size * 0.42,
          height: size * 0.42,
          filter: isDark ? 'none' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))',
        }}
      />
    </>
  );
};

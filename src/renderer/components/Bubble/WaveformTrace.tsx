import React, { useEffect, useRef } from 'react';
import { AgentState, BubbleSize } from '../../../common/types';

// ── "Waveform" bubble fill ───────────────────────────────────────────────────
// An oscilloscope-style trace of the last ~20 seconds of agent activity, drawn
// on a plain 2D canvas (no WebGL) inside a circular glass disc the same size as
// the orb, with the agent's logo watermarked behind the trace.
//
// The disc matches the orb exactly (see WAVEFORM_BOX in Bubble.tsx, derived from
// ORB_DIMENSIONS) so a waveform bubble is footprint-identical to every other
// fill — no special window size, and a mixed stack stays one clean column.
//
// The cost of a circle is that the trace can only use a horizontal CHORD, not
// the full diameter: for a band of height h in a circle of radius r the usable
// width is 2·√(r² − (h/2)²). Width falls off slowly near the centre, so a taller
// band is cheap — but the sample count then has to drop to keep enough px per
// sample for the zigzag to read. WAVEFORM_BOX resolves that three-way trade
// (samples × width × amplitude); the window length below is the knob that pays
// for it.
//
// The logo sits CENTRED and dimmed behind the trace rather than watermarking one
// end: at a ~39px chord an edge-anchored logo would cover nearly half the
// history. Centring also matches glass/solid/particle, which all centre the
// logo, so a stack stays scannable. The trace crosses the mark like a heart
// monitor.
//
// The orb answers "what state is it in"; the trace answers "what has it been
// doing" — the shape the orb throws away:
//   working      → a jagged band whose amplitude tracks how hard it's working
//   idle         → flatline
//   idle-active  → barely-there ripple (a session is open, nothing running)
//   waiting      → a held spike: the trace jumps up and stays there until you
//                  come back to it
//   error        → jittery red band
//
// Sampling: one signed sample every WAVEFORM_SAMPLE_MS, WAVEFORM_SAMPLES of
// them, so the drawn trace always spans exactly WAVEFORM_WINDOW_MS. The window
// is deliberately hardcoded — it isn't a setting.
//
// "How hard it's working" comes from hook traffic: every tool call the agent
// makes reaches the bridge (PreToolUse & friends) and bumps the tool's status,
// which the bubble forwards here as `activityAt`. Each bump kicks a `drive`
// level that decays between calls, so a burst of tool calls reads as a tall
// band that tapers off when the agent goes quiet.

// Trace window — the full span of the drawn trace, left edge to right edge.
// Shortened from 60s when the lane became a disc: the chord is ~2.5x narrower
// than the old lane, so something had to give, and history is the cheapest thing
// to spend. Shortening the WINDOW rather than coarsening WAVEFORM_SAMPLE_MS is
// deliberate — see the DRIVE_DECAY note below. A burst still taper-decays over
// ~8s, which is now 40% of the trace rather than an eighth of it, so bursts
// actually read MORE clearly than they did at 60s.
export const WAVEFORM_WINDOW_MS = 20_000;
// One sample per this many ms. Chosen so WAVEFORM_SAMPLES stays below the trace
// chord in CSS px — a zigzag needs ~1.5px per sample to read as up-down rather
// than a solid smear, and the narrowest disc gives 31px for 20 samples (1.55px,
// comfortably better than the 1.4px the old 84px/60-sample lane managed).
// Raising this coarsens the trace AND breaks DRIVE_DECAY; shorten the window
// instead.
export const WAVEFORM_SAMPLE_MS = 1000;
export const WAVEFORM_SAMPLES = Math.round(WAVEFORM_WINDOW_MS / WAVEFORM_SAMPLE_MS);

export interface WavePreset {
  base: number;    // resting amplitude (0–1) with no recent tool calls
  drive: number;   // how much of the amplitude recent tool calls can add
  hold: number;    // >0 → held plateau at this height instead of a zigzag
  jitter: number;  // per-sample randomness on top of the amplitude
  color: (isDark: boolean) => [number, number, number];
}

// Flatline ink follows the theme so an idle trace stays visible on the panel.
const ink = (isDark: boolean): [number, number, number] =>
  isDark ? [226, 232, 240] : [51, 65, 85];

export const WAVE_PRESETS: Record<AgentState, WavePreset> = {
  idle: { base: 0, drive: 0, hold: 0, jitter: 0, color: ink },
  'idle-active': {
    base: 0.07, drive: 0.25, hold: 0, jitter: 0,
    color: (d) => (d ? [250, 204, 21] : [202, 138, 4]),
  },
  waiting: {
    base: 0, drive: 0, hold: 0.78, jitter: 0,
    color: (d) => (d ? [96, 165, 250] : [37, 99, 235]),
  },
  working: {
    base: 0.22, drive: 0.78, hold: 0, jitter: 0,
    color: (d) => (d ? [52, 211, 153] : [22, 163, 74]),
  },
  error: {
    base: 0.45, drive: 0.2, hold: 0, jitter: 0.3,
    color: (d) => (d ? [248, 113, 113] : [220, 38, 38]),
  },
};

// Deterministic hash (classic GLSL fract-sin) — a sample's wobble must not
// change once it has been captured, or the whole trace would shimmer.
const hash = (n: number): number => {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

// Activity level, 0–1. Each tool call kicks it up; it decays every sample tick,
// so a busy stretch reads as a tall band that tapers once the agent stops.
// DRIVE_DECAY per 1000ms tick ≈ 4s to fall to a fifth, ~8s to flat. It is tied
// to WAVEFORM_SAMPLE_MS — the decay is per tick, so changing the sample rate
// without re-deriving this (0.68 per 750ms tick → 0.68 ** (1000/750)) would
// silently change how long a burst stays visible.
export const DRIVE_DECAY = 0.6;
export const DRIVE_KICK = 0.55;
export function nextDrive(drive: number, sawActivity: boolean): number {
  const decayed = drive * DRIVE_DECAY;
  return sawActivity ? Math.min(1, decayed + DRIVE_KICK) : decayed;
}

// One signed sample, -1…1. `index` is the monotonic tick counter: it drives the
// zigzag's alternating sign and the per-sample wobble, so scrolling the buffer
// never re-shapes history.
export function waveSample(
  state: AgentState,
  drive: number,
  index: number,
  spike = false,
): number {
  const preset = WAVE_PRESETS[state] ?? WAVE_PRESETS.idle;
  // Waiting on the user: hold the trace up rather than oscillating. The jump to
  // the plateau (and the flat run after it) is what makes "blocked on you" read
  // differently from "busy".
  if (preset.hold > 0) return preset.hold;

  const amp = preset.base + preset.drive * drive + (spike ? 0.45 : 0);
  if (amp <= 0) return 0;
  const wobble = 0.7 + 0.3 * hash(index * 1.7);
  const jitter = preset.jitter > 0 ? (hash(index * 3.7) - 0.5) * preset.jitter : 0;
  const magnitude = Math.max(0, Math.min(1, amp * wobble + jitter));
  return (index % 2 === 0 ? 1 : -1) * magnitude;
}

// Disc geometry per bubble size, supplied by the caller (Bubble.tsx owns the
// per-size table so it stays next to ORB_DIMENSIONS). `trace` × `band` must fit
// inside the disc as a centred chord — i.e. (trace/2)² + (band/2)² ≤ (disc/2)² —
// or the trace clips against the circle.
export interface WaveformBox {
  disc: number;     // diameter of the circular glass panel (matches the orb)
  band: number;     // height of the trace band (a chord of the disc)
  trace: number;    // width of that chord — the drawn trace spans all of it
  logo: number;     // logo edge length, centred and dimmed BEHIND the trace
}

// Disc geometry per bubble size. `disc` and `logo` MIRROR ORB_DIMENSIONS' `orb`
// and `icon` in Bubble.tsx — keep them in step, that's what makes a waveform
// bubble footprint-identical to every other fill.
//
// Each `trace` is the exact chord width for its band, floored to whole px:
//   small  2·√(19² − 11²) = 30.98 → 30      medium 2·√(24² − 14²) = 38.99 → 38
//   large  2·√(30² − 17²) = 49.44 → 49
//
// Bands are ~0.57·disc, which is where the samples × width × amplitude trade
// lands best: chord width falls off slowly near the centre, so this buys real
// amplitude (halfH 8/11/14) for very little width. At 20 samples that's
// 1.50/1.90/2.45 px per sample — above the ~1.5px zigzag floor at every size,
// and better than the 1.40/1.70/2.07 the old wide lane managed. Widening the
// bands further would push the small size under the floor.
export const WAVEFORM_BOX: Record<BubbleSize, WaveformBox> = {
  small:  { disc: 38, band: 22, trace: 30, logo: 19 },
  medium: { disc: 48, band: 28, trace: 38, logo: 24 },
  large:  { disc: 60, band: 34, trace: 49, logo: 30 },
};

interface Props {
  state: AgentState;
  isDark: boolean;
  box: WaveformBox;
  iconSrc: string;
  label: string;
  // Timestamp of the tool's most recent hook event. Every change is one more
  // beat of activity; the value itself is never displayed.
  activityAt?: number;
}

export const WaveformTrace: React.FC<Props> = ({ state, isDark, box, iconSrc, label, activityAt }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Rolling buffer, oldest → newest. Survives state/theme changes so the trace
  // keeps its history when the agent flips between working and waiting.
  const samples = useRef<number[]>(new Array(WAVEFORM_SAMPLES).fill(0));
  const tick = useRef(0);
  const drive = useRef(0);
  // Set by the activityAt watcher, consumed (and cleared) by the next tick.
  const pendingActivity = useRef(false);
  const activitySeeded = useRef(false);

  useEffect(() => {
    // The value present on mount is whatever the bridge last recorded — often
    // from before this bubble existed — so it seeds the watcher rather than
    // counting as a fresh tool call.
    if (!activitySeeded.current) {
      activitySeeded.current = true;
      return;
    }
    if (activityAt == null) return;
    pendingActivity.current = true;
  }, [activityAt]);

  const traceWidth = Math.max(1, box.trace);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom / no 2D context — the logo still renders

    const width = traceWidth;
    const height = box.band;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    const preset = WAVE_PRESETS[state] ?? WAVE_PRESETS.idle;
    const [cr, cg, cb] = preset.color(isDark);
    const cy = height / 2;
    // Leave room top and bottom so a full-amplitude spike never clips.
    const halfH = height / 2 - 3;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      // Baseline — gives the flatline something to be flat against.
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(width, cy);
      ctx.stroke();

      const buf = samples.current;
      const step = width / (buf.length - 1);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.95)`;
      ctx.lineWidth = 1.2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowBlur = 4;
      ctx.shadowColor = `rgba(${cr},${cg},${cb},0.55)`;
      ctx.beginPath();
      for (let i = 0; i < buf.length; i++) {
        const x = i * step;
        const y = cy - buf[i] * halfH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Leading-edge dot — the "now" cursor at the right edge.
      const head = buf[buf.length - 1];
      ctx.fillStyle = `rgba(${cr},${cg},${cb},1)`;
      ctx.beginPath();
      ctx.arc(width - 1, cy - head * halfH, 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    };

    draw();

    const timer = window.setInterval(() => {
      const sawActivity = pendingActivity.current;
      pendingActivity.current = false;
      drive.current = nextDrive(drive.current, sawActivity);
      tick.current += 1;
      samples.current = [
        ...samples.current.slice(1),
        waveSample(state, drive.current, tick.current, sawActivity),
      ];
      if (document.hidden) return; // keep sampling, skip the paint
      draw();
    }, WAVEFORM_SAMPLE_MS);

    return () => window.clearInterval(timer);
  }, [state, isDark, traceWidth, box.band]);

  return (
    <div
      className='relative flex items-center justify-center overflow-hidden'
      style={{
        width: box.disc,
        height: box.disc,
        borderRadius: '50%',
        background: isDark ? 'rgba(15,23,42,0.55)' : 'rgba(255,255,255,0.62)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        border: `1px solid ${isDark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.10)'}`,
        boxShadow: isDark ? '0 8px 8px 0 rgba(0,0,0,0.4)' : '0 4px 16px 0 rgba(0,0,0,0.15)',
      }}
    >
      {/* The agent logo, centred and dimmed BEHIND the trace — the only thing
          identifying the bubble in a stack, so it keeps a soft theme-matched
          halo to hold its edges against the disc. Rendered before the canvas so
          the trace draws over it. The name stays in the tooltip. */}
      <img
        src={iconSrc}
        alt={label}
        draggable={false}
        className='absolute object-contain pointer-events-none'
        style={{
          width: box.logo,
          height: box.logo,
          opacity: 0.5,
          filter: isDark
            ? 'drop-shadow(0 0 3px rgba(15,23,42,0.95))'
            : 'drop-shadow(0 0 3px rgba(255,255,255,0.95))',
        }}
      />

      <canvas
        ref={canvasRef}
        className='block relative'
        style={{ width: traceWidth, height: box.band }}
      />
    </div>
  );
};

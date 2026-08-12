import React from 'react';
import { arcColorForRemaining, arcTrackColor } from './quota';

// ── "Arc" quota gauge ────────────────────────────────────────────────────────
// A single conic ring around the orb showing REMAINING credit in that tool's
// primary quota window (see the *ArcRemaining pickers in quota.ts). The
// alternative to the stacked bars below the orb — BubbleQuotaStyle in
// common/types.ts.
//
// Trades breadth for space: the arc can only show one window where the bars show
// N, but it costs no vertical room, so the bubble window collapses to a square
// (ARC_DIMENSIONS in bubble-manager.ts). Every window is still listed in the
// hover tooltip under both styles, so nothing is actually lost.
//
// Two implementation notes:
//   • The ring is a conic-gradient masked into a donut. The obvious approach —
//     a conic disc with an opaque circle punched over the middle — can't work
//     here: the bubble window is transparent, so an opaque centre would paint
//     over the glass orb (and the mascot/particle/waveform stages behind it).
//   • It sits entirely OUTSIDE the orb — callers pass `dims.orb + BAND * 2`, so
//     the masked hole is exactly the orb and the band wraps it without taking a
//     pixel of the face. That annulus is where the rotating state rings normally
//     live (`dims.ring` is only orb + 8, and its 2px border eats half that gap),
//     so Bubble.tsx shifts every ring outward in arc mode to make room. See
//     `ringBase` there.

// Ring thickness in px. 4 rather than a bar's 2–3 because the band carries a
// hairline on each edge, which eats into a thinner ring's visible fill. Every
// ring in arc mode stacks outward from this, so raising it further walks the
// escalation ring (orb + BAND*2 + 8) toward the window edge — at 4 that lands at
// orb + 16 = 54/64/76 inside a 58/70/86 window. Exported because the caller
// sizes the ring and the state-ring offsets from it.
export const QUOTA_ARC_BAND = 4;
const BAND = QUOTA_ARC_BAND;

interface Props {
  // Remaining credit, 0–100. `null` → render nothing (no data for this tool:
  // poller off, signed out, or no live quota). An empty ring would read as
  // "no credit left", which is a different and much more alarming claim.
  remaining: number | null;
  // Outer diameter of the ring. Callers pass `dims.orb + BAND * 2` so the hole
  // is exactly the orb and the band sits wholly outside it.
  size: number;
  isDark: boolean;
}

export const QuotaArc: React.FC<Props> = ({ remaining, size, isDark }) => {
  if (remaining == null) return null;

  const clamped = Math.max(0, Math.min(100, remaining));
  // Floor the sweep at a sliver so "almost nothing left" still shows as a red
  // tick rather than vanishing into a bare track — the bars do the same with
  // their 2% minimum width.
  const sweep = clamped > 0 ? Math.max(2, clamped) : 0;
  const fill = arcColorForRemaining(clamped, isDark);
  const track = arcTrackColor(isDark);

  // Donut hole as a fraction of the radius. `closest-side` makes 100% the
  // radius, so the transparent centre ends where the band begins.
  const innerPct = ((size / 2 - BAND) / (size / 2)) * 100;

  return (
    <div
      aria-hidden
      className='absolute rounded-full pointer-events-none'
      style={{
        width: size,
        height: size,
        // from 0deg = 12 o'clock, sweeping clockwise, so a draining quota
        // unwinds the way a clock does.
        background: `conic-gradient(${fill} 0deg ${sweep * 3.6}deg, ${track} ${sweep * 3.6}deg 360deg)`,
        // Blurs whatever is behind the band, so a hard edge on the desktop can't
        // read through it as a break in the ring. Belt-and-braces with the
        // near-opaque colours above: the blur also softens the ring's outer
        // silhouette against a busy backdrop.
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        // Hairline border, drawn inside the mask, to keep the band's edges
        // defined where the fill happens to match what's behind it.
        boxShadow: isDark
          ? 'inset 0 0 0 0.5px rgba(255,255,255,0.28), 0 1px 3px rgba(0,0,0,0.55)'
          : 'inset 0 0 0 0.5px rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.25)',
        mask: `radial-gradient(closest-side, transparent ${innerPct}%, black ${innerPct}%)`,
        WebkitMask: `radial-gradient(closest-side, transparent ${innerPct}%, black ${innerPct}%)`,
        transition: 'background 500ms ease',
      }}
    />
  );
};

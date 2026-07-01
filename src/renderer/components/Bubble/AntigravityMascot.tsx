import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';

// ── Antigravity (GIGI) mascot ─────────────────────────────────────────────────
// An animated stand-in for the Google Antigravity orb — GIGI, a limbless,
// Gemini-style rainbow droplet with a happy face. Each AgentState drives a pose,
// ported (nearly verbatim) from the hand-tuned GSAP demo in
// `clawd-svgs/gigi-actions-demo.html`:
//
//   idle         → leaning on a pillow, sleepy eyes, drifting "zzz"
//   idle-active  → neutral stance, gentle breathing ("on, but doing nothing")
//   waiting      → a "need input" flag grows from the head tip, sways + urgent hop
//   working      → bouncy squash/stretch jog, then jump reps flicking off sweat
//   error        → red wash strobe + glitch shudder + X-eyes + alert badge
//
// The rig is the same droplet SVG used by the demo. Because GIGI has no limbs,
// the props (flag, alert) sit centred on top of the head and need no nudging —
// the only sizing concern is headroom for the flag/alert above the tip, which
// the viewBox carries. Prop positions are easy to tweak right here in the markup.
//
// All animation lives in a `gsap.context` scoped to the component's root. The
// effect re-runs on every state change; the context's `revert()` kills the old
// timelines AND clears the inline styles they set, giving us the demo's
// `resetAll()` for free with no manual loop bookkeeping (inline opacity from a
// face/prop swap is wiped, so the default happy face restores automatically).

interface AntigravityMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// viewBox bounds the droplet (x 22..178, y 14..212) plus the pillow on the left.
// Above (y -64..14) is reserved headroom for the alert badge / raised flag above
// the head tip (up to y -60) and side room for the drifting zzz. Below, the box
// is padded past the droplet (y 212 → box bottom y 260) so the resting droplet
// isn't crammed against the usage bar; this balances the gap BELOW the mascot
// with the reserved prop headroom ABOVE, matching the orb bubbles' spacing. Keep
// extremes in sync with the prop geometry below. The mascot is shrunk on-screen
// by scaling the bubble window + SVG px width down together (see
// MASCOT_WIDTH_ANTIGRAVITY in Bubble.tsx and MASCOT_DIMENSIONS_ANTIGRAVITY in
// bubble-manager.ts) — a uniform zoom-out that keeps every prop inside the
// window, so nothing clips.
const VIEW = { x: -15, y: -64, w: 230, h: 324 };
const ASPECT = VIEW.h / VIEW.w;

export const AntigravityMascot: React.FC<AntigravityMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    const ctx = gsap.context(() => {
      const show = (sel: string) => gsap.to(sel, { opacity: 1, duration: 0.4 });

      // ── idle → SLEEP ──────────────────────────────────────────────────────
      const playSleep = () => {
        show('#pillow');
        gsap.set('#eyes', { opacity: 0 });        // swap happy eyes → sleepy eyes
        gsap.set('#eyes-sleep', { opacity: 1 });
        gsap.timeline()
          .to('#char', { rotation: -13, x: -6, svgOrigin: '100 210', duration: 0.9, ease: 'power2.inOut' })
          .to('#mouth', { scaleY: 0.55, svgOrigin: '100 150', duration: 0.5, ease: 'power2.out' }, '-=0.55')
          .add(() => {
            // gentle breathing about the base
            gsap.to('#gigi', { scaleY: 1.045, scaleX: 0.98, svgOrigin: '100 210', duration: 1.7, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '124 38' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 12, y: -22, scale: 1, duration: 1.8, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.35');
          });
      };

      // ── idle-active → NEUTRAL (on, idle, no task) ──────────────────────────
      const playNeutral = () => {
        gsap.to('#gigi', { scaleY: 1.03, scaleX: 0.99, svgOrigin: '100 210', duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
      };

      // ── working → RUN + WORKOUT ────────────────────────────────────────────
      const playRun = () => {
        const tl = gsap.timeline({ repeat: -1 });
        const O = '100 210';                            // squash about the base

        // Warm-up jog: small hops with squash on landing, stretch on the rise.
        const d = 0.16;
        for (let i = 0; i < 5; i++) {
          tl.to('#gigi', { y: -20, scaleY: 1.10, scaleX: 0.92, svgOrigin: O, duration: d, ease: 'power1.out' })
            .to('#gigi', { y: 0, scaleY: 0.85, scaleX: 1.12, svgOrigin: O, duration: d, ease: 'power1.in' })
            .to('#gigi', { scaleY: 1, scaleX: 1, svgOrigin: O, duration: d * 0.6, ease: 'power2.out' });
        }
        tl.to({}, { duration: 0.2 });

        // Big jump reps: deeper squash, higher pop, sweat droplet flicking off each rep.
        const j = 0.22;
        for (let r = 0; r < 4; r++) {
          tl.to('#gigi', { y: -34, scaleY: 1.16, scaleX: 0.86, svgOrigin: O, duration: j, ease: 'power2.out' })
            .fromTo('#sweat', { opacity: 0, x: 0, y: 0, scale: 0.8 }, { opacity: 1, x: 16, y: -24, scale: 1, duration: j, ease: 'power1.out' }, '<')
            .to('#sweat', { opacity: 0, duration: j * 0.7, ease: 'power1.in' }, '>-0.05')
            .to('#gigi', { y: 0, scaleY: 0.80, scaleX: 1.20, svgOrigin: O, duration: j, ease: 'power2.in' }, '<')
            .to('#gigi', { scaleY: 1, scaleX: 1, svgOrigin: O, duration: j * 0.5, ease: 'power2.out' });
        }
        tl.to({}, { duration: 0.4 });                   // brief beat before the loop repeats
      };

      // ── waiting → NEED HELP (grow a flag from the head, sway it) ────────────
      const playHelp = () => {
        gsap.set('#mouth', { opacity: 0 });             // swap smile → worried mouth
        gsap.set('#mouth-flat', { opacity: 1 });
        gsap.set('#flag', { opacity: 1, scaleY: 0, svgOrigin: '100 20' });
        gsap.timeline()
          .to('#flag', { scaleY: 1, duration: 0.45, ease: 'back.out(1.8)' })   // flag grows up out of the tip
          .add(() => {
            // gentle sway of the sign about the pole base (soft enough to keep text readable)
            gsap.fromTo('#flag', { rotation: -6, svgOrigin: '100 20' }, { rotation: 6, svgOrigin: '100 20', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // urgent hop
            gsap.to('#gigi', { y: -8, duration: 0.45, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // occasional worried blink
            gsap.to('#eyes', { scaleY: 0.15, svgOrigin: '100 110', duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true, repeatDelay: 1.3 });
          });
      };

      // ── error → ALERT + red strobe + glitch + X-eyes ───────────────────────
      const playError = () => {
        gsap.set(['#eyes', '#mouth'], { opacity: 0 });  // swap normal face → X eyes + shock mouth
        gsap.set(['#eyes-x', '#mouth-o'], { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '100 -44' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' })    // badge pops in
          .add(() => {
            // red wash strobing over the rainbow body
            gsap.to('#body-red', { opacity: 0.85, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#char', { x: 3, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -2, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // sharp "no" head-shake about the centre
            gsap.fromTo('#gigi', { rotation: -4, svgOrigin: '100 150' }, { rotation: 4, svgOrigin: '100 150', duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // badge throb to keep drawing the eye
            gsap.to('#alert', { scale: 1.15, svgOrigin: '100 -44', duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      switch (state) {
        case 'idle': playSleep(); break;
        case 'idle-active': playNeutral(); break;
        case 'waiting': playHelp(); break;
        case 'working': playRun(); break;
        case 'error': playError(); break;
      }
    }, rootRef);

    return () => ctx.revert();
  }, [state]);

  return (
    <svg
      ref={rootRef}
      viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
      width={width}
      height={Math.round(width * ASPECT)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ overflow: 'visible', pointerEvents: 'none' }}
    >
      <defs>
        <linearGradient id="gigi-bodyGrad" x1="160" y1="20" x2="40" y2="210" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8AB6FF" />
          <stop offset="0.20" stopColor="#B79CFF" />
          <stop offset="0.40" stopColor="#F0A6D8" />
          <stop offset="0.55" stopColor="#F6A6A6" />
          <stop offset="0.72" stopColor="#FAD27A" />
          <stop offset="0.87" stopColor="#C9E89A" />
          <stop offset="1" stopColor="#8FE0C8" />
        </linearGradient>
      </defs>

      {/* floating "zzz" for sleep (near the head tip) */}
      <text id="zzz" x="118" y="40" fontFamily="ui-sans-serif, sans-serif" fontSize="30"
        fontStyle="italic" fontWeight="700" fill="#cfd3da" opacity="0">z z z</text>

      {/* pillow for sleep (behind GIGI, under the left lean) */}
      <rect id="pillow" x="8" y="196" width="92" height="26" rx="12" fill="#ECE6DA" opacity="0" />

      <g id="char">
        <g id="gigi">
          {/* rainbow droplet body */}
          <path id="body-grad" fill="url(#gigi-bodyGrad)"
            d="M100 14 C150 60 178 108 178 150 C178 194 142 212 100 212 C58 212 22 194 22 150 C22 108 50 60 100 14 Z" />
          {/* solid-red clone, faded in only during the error strobe */}
          <path id="body-red" fill="#E5484D" opacity="0"
            d="M100 14 C150 60 178 108 178 150 C178 194 142 212 100 212 C58 212 22 194 22 150 C22 108 50 60 100 14 Z" />

          {/* ── FACE ── dark slate strokes on the pastel droplet ── */}
          <g stroke="#243B53" strokeWidth="6" strokeLinecap="round" fill="none">
            {/* happy eyes (arching up) */}
            <g id="eyes">
              <path d="M58 116 Q72 100 86 116" />
              <path d="M114 116 Q128 100 142 116" />
            </g>
            {/* sleepy eyes (gentle closed curves) */}
            <g id="eyes-sleep" opacity="0">
              <path d="M58 118 Q72 127 86 118" />
              <path d="M114 118 Q128 127 142 118" />
            </g>
            {/* X eyes for the error state */}
            <g id="eyes-x" opacity="0">
              <line x1="62" y1="100" x2="82" y2="120" />
              <line x1="82" y1="100" x2="62" y2="120" />
              <line x1="118" y1="100" x2="138" y2="120" />
              <line x1="138" y1="100" x2="118" y2="120" />
            </g>
            {/* smile (default) */}
            <path id="mouth" d="M68 142 Q100 176 132 142" />
            {/* worried mouth for "need help" */}
            <path id="mouth-flat" d="M74 160 Q100 146 126 160" opacity="0" />
          </g>
          {/* shocked "O" mouth for the error state (filled) */}
          <ellipse id="mouth-o" cx="100" cy="158" rx="11" ry="14" fill="#243B53" opacity="0" />

          {/* sweat droplet for the workout (flicks off during reps) */}
          <path id="sweat" d="M126 64 C131 71 134 76 134 80 C134 85 130 88 126 88 C122 88 118 85 118 80 C118 76 121 71 126 64 Z"
            fill="#CFE9FF" stroke="#6FB7E8" strokeWidth="1" opacity="0" />
        </g>

        {/* "need input" flag, planted on top of GIGI's head tip */}
        <g id="flag" opacity="0">
          <rect id="flag-pole" x="98" y="-50" width="3.4" height="70" rx="1.7" fill="#5D5B56" />
          <rect id="flag-sign" x="100" y="-52" width="64" height="30" rx="4"
            fill="#FBF7EF" stroke="#D9CFC0" strokeWidth="1" />
          <text x="132" y="-40" textAnchor="middle"
            fontFamily="ui-sans-serif, sans-serif" fontSize="7.5" fontWeight="700" fill="#3A3530">
            <tspan x="132" dy="0">Waiting for</tspan>
            <tspan x="132" dy="9.5">your input</tspan>
          </text>
        </g>

        {/* warning badge for the error state (triangle + "!"), pops above the head */}
        <g id="alert" opacity="0">
          <path d="M100 -60 L120 -28 L80 -28 Z" fill="#E5484D" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
          <rect x="98.5" y="-52" width="3" height="13" rx="1.5" fill="#FFFFFF" />
          <rect x="98.5" y="-34" width="3" height="3" rx="1.5" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
};

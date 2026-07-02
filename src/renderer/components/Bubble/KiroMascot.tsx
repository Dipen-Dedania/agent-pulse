import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';

// ── Kiro ghost mascot ───────────────────────────────────────────────────────
// An animated stand-in for the Kiro orb — the white ghost from the official
// Lottie render. Each AgentState drives a pose, ported (nearly verbatim) from
// the hand-tuned GSAP demo in `clawd-svgs/kiro-actions-demo.html`:
//
//   idle         → slumped on a pillow, closed eyes, drifting "zzz"
//   idle-active  → neutral stance, gentle breathing ("on, but doing nothing")
//   waiting      → a "need input" sign beside the ghost with an urgent hop
//   working      → squash-stretch hops, dash laps, then a victory spin
//   error        → red strobe + glitch shudder + X-eyes + alert badge
//
// The rig is the same ghost SVG used by the demo, but the zzz and the flag were
// scaled UP relative to the character (matching Clawd's proportions) so they
// stay legible at bubble scale — the demo's sign ran far off to the right and
// its text would be unreadable this small. Prop positions are easy to tweak
// right here in the markup. The demo's <defs>/<use> silhouette is inlined
// (white body + red error clone) so multiple mounted instances — e.g. the five
// Settings state cards — can't cross-reference each other's defs by global id.
//
// All animation lives in a `gsap.context` scoped to the component's root. The
// effect re-runs on every state change; the context's `revert()` kills the old
// timelines AND clears the inline styles they set, giving us the demo's
// `resetAll()` for free with no manual loop bookkeeping.

interface KiroMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// viewBox bounds the ghost (x ≈30..516, y ≈0..595, foot line y 590). Above
// (y -200..0) is reserved headroom for the overhead props — the flag sign and
// the drifting zzz reach y ≈ -190. Below, the box is padded past the ghost
// (foot y 590 → box bottom y 660) so the resting character isn't crammed
// against the usage bar. Keep extremes in sync with the prop geometry below.
// The box is SQUARE (like Clawd's) so at the same rendered width the Kiro
// bubble has exactly Clawd's footprint — it shares MASCOT_WIDTH-style sizing
// (see MASCOT_WIDTH_KIRO in Bubble.tsx and MASCOT_DIMENSIONS_KIRO in
// bubble-manager.ts): a uniform zoom-out that keeps every prop inside the
// window, so nothing clips.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const EYES_C = '337 239'; // centre of both eyes
const FOOT_C = '270 590'; // bottom of the ghost (squash / hop pivot)

// Ghost body silhouette (4 overlapping blobs from the Lottie), drawn once in
// white and once as a red error clone.
const GHOST_TRANSFORM = 'translate(265.367,317.039) scale(1.45761) scale(-1,1)';
const GHOST_PATHS = [
  // head + main mass
  'M124.87,-2.1 C121.93,-31.07 121.46,-58.98 113.86,-83.37 C81.31,-222.74 -107.8,-222.6 -145.63,-84.08 C-201.45,150.35 133.69,84.83 124.87,-2.1 Z',
  // left flank + tail
  'M-9.99,160.68 C7.8,54.3 -74.53,-129.56 -145.63,-84.08 C-151.15,-63.76 -172.64,34.71 -119.42,131.25 C-95.27,175.04 -27.93,217.21 -9.99,160.68 Z',
  // bottom-centre foot
  'M-9.99,160.68 C51.06,211.09 133.83,189.49 94.96,103.35 C94.96,103.35 29.18,-50.21 -20.94,-22.83 C-74.72,6.54 -64.24,96.15 -9.99,160.68 Z',
  // right flank
  'M100.24,105.75 C100.24,105.76 100.24,105.74 100.24,105.74 C156.15,126.17 161.72,86.21 149.88,66.35 C112.42,3.53 128.2,-32.83 113.86,-83.37 C81.31,-222.74 -15.53,40.72 100.24,105.75 Z',
];

// One pill eye (from the Lottie), reused for both via per-eye transforms.
const EYE_PILL =
  'M-18.456,-0.001 C-18.456,11.057 -16.138,29.607 -0.615,29.607 C-0.615,29.607 -0.612,29.607 -0.612,29.607 C11.327,29.607 18.456,18.54 18.456,-0.001 C18.456,-9.814 16.48,-17.707 12.741,-22.831 C9.459,-27.328 4.807,-29.607 -0.615,-29.607 C-6.037,-29.607 -10.3,-27.363 -13.28,-22.94 C-16.667,-17.913 -18.456,-9.981 -18.456,-0.001 Z';

export const KiroMascot: React.FC<KiroMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    const ctx = gsap.context(() => {
      const show = (sel: string) => gsap.to(sel, { opacity: 1, duration: 0.4 });

      // ── idle → SLEEP ────────────────────────────────────────────────────
      const playSleep = () => {
        show('#pillow');
        gsap.timeline()
          .to('#char', { rotation: -14, x: -14, y: 14, svgOrigin: '150 590', duration: 0.9, ease: 'power2.inOut' })
          .to('#eyes', { scaleY: 0.1, svgOrigin: EYES_C, duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .add(() => {
            // gentle breathing (the whole blob swells from its base)
            gsap.to('#body', { scaleY: 1.03, scaleX: 1.012, svgOrigin: FOOT_C, duration: 1.7, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '350 -60' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 45, y: -80, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → NEUTRAL (on, idle, no task) ───────────────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
      };

      // ── working → RUN + WORKOUT (all body english — no limbs) ───────────
      const playRun = () => {
        const tl = gsap.timeline({ repeat: -1 });
        const d = 0.16;

        // Hops: crouch (squash) → leap (stretch) → land.
        for (let s = 0; s < 4; s++) {
          tl.to('#char', { scaleY: 0.86, scaleX: 1.08, y: 0, svgOrigin: FOOT_C, duration: d * 0.7, ease: 'power1.in' })
            .to('#char', { scaleY: 1.1, scaleX: 0.94, y: -70, svgOrigin: FOOT_C, duration: d, ease: 'power2.out' })
            .to('#char', { scaleY: 1, scaleX: 1, y: 0, svgOrigin: FOOT_C, duration: d, ease: 'power2.in' });
        }
        tl.to({}, { duration: 0.2 });

        // Dash laps: lean into a sprint left and right (tail-first, then face-first).
        const s = 0.32;
        for (let r = 0; r < 2; r++) {
          tl.to('#char', { x: -85, rotation: -9, svgOrigin: FOOT_C, duration: s, ease: 'power2.inOut' })
            .to('#char', { x: 85, rotation: 9, svgOrigin: FOOT_C, duration: s * 1.6, ease: 'power2.inOut' })
            .to('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C, duration: s, ease: 'power2.inOut' });
        }

        // Victory spin: one quick 360 about the middle, land with a bounce.
        tl.to('#char', { y: -60, duration: 0.25, ease: 'power2.out' })
          .to('#char', { rotation: 360, svgOrigin: '270 300', duration: 0.55, ease: 'power1.inOut' }, '<')
          .to('#char', { y: 0, duration: 0.25, ease: 'power2.in' })
          .set('#char', { rotation: 0 })
          .to('#char', { scaleY: 0.92, scaleX: 1.05, svgOrigin: FOOT_C, duration: 0.1, ease: 'power1.out' })
          .to('#char', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.15 })
          .to({}, { duration: 0.4 }); // brief beat before the loop repeats
      };

      // ── waiting → NEED HELP (sign rises beside the ghost) ───────────────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .add(() => {
            // gentle sway of the sign about the pole base (soft enough to keep text readable)
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // urgent hop
            gsap.to('#char', { y: -18, duration: 0.45, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // occasional worried blink
            gsap.to('#eyes', { scaleY: 0.15, svgOrigin: EYES_C, duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true, repeatDelay: 1.3 });
          });
      };

      // ── error → ALERT + red strobe + glitch + X-eyes ────────────────────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap normal eyes → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .add(() => {
            // red strobe over the whole ghost (multiply overlay fading in/out)
            gsap.to('#red-tint', { opacity: 0.75, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#char', { x: 7, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -5, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // sharp "no" head-shake
            gsap.fromTo('#body', { rotation: -4, svgOrigin: '270 400' }, { rotation: 4, svgOrigin: '270 400', duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // badge throb to keep drawing the eye
            gsap.to('#alert', { scale: 1.15, svgOrigin: '270 -60', duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true });
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
      {/* floating "zzz" for sleep (above the head) */}
      <text id="zzz" x="290" y="-10" fontFamily="ui-sans-serif, sans-serif" fontSize="140" fontStyle="italic" fontWeight="700" fill="#cfd3da" opacity="0">z z z</text>

      {/* pillow for sleep (behind kiro, under the left shoulder) */}
      <rect id="pillow" x="0" y="500" width="230" height="95" rx="44" fill="#ECE6DA" opacity="0" />

      <g id="char">
        <g id="body">
          {/* ghost body silhouette (white) */}
          <g transform={GHOST_TRANSFORM} fill="#FFFFFF">
            {GHOST_PATHS.map((d, i) => <path key={i} d={d} />)}
          </g>

          {/* pill eyes (centres ≈ 289.5,239 and 384.6,239) */}
          <g id="eyes" fill="#000000">
            <path d={EYE_PILL} transform="translate(263.3,317.039) scale(1.45761) translate(17.992,-53.739)" />
            <path d={EYE_PILL} transform="translate(265.367,317.039) scale(1.45761) translate(81.822,-53.739)" />
          </g>

          {/* X eyes for the error state (shown while #eyes is hidden) */}
          <g id="eyes-x" opacity="0" stroke="#000000" strokeWidth="14" strokeLinecap="round">
            <line x1="268" y1="205" x2="311" y2="273" />
            <line x1="311" y1="205" x2="268" y2="273" />
            <line x1="363" y1="205" x2="406" y2="273" />
            <line x1="406" y1="205" x2="363" y2="273" />
          </g>

          {/* red overlay for the error strobe (same silhouette, multiply blend) */}
          <g id="red-tint" transform={GHOST_TRANSFORM} fill="#E5484D" opacity="0" style={{ mixBlendMode: 'multiply' }}>
            {GHOST_PATHS.map((d, i) => <path key={i} d={d} />)}
          </g>
        </g>

        {/* "need input" sign, planted beside the ghost's right flank */}
        <g id="flag" opacity="0">
          <rect id="flag-pole" x="470" y="-175" width="14" height="345" rx="7" fill="#5D5B56" />
          <rect id="flag-sign" x="482" y="-185" width="218" height="145" rx="22" fill="#FBF7EF" stroke="#D9CFC0" strokeWidth="5" />
          <text x="591" y="-128" textAnchor="middle" fontFamily="ui-sans-serif, sans-serif" fontSize="50" fontWeight="700" fill="#3A3530">
            <tspan x="591" dy="0">Need</tspan>
            <tspan x="591" dy="58">input</tspan>
          </text>
        </g>

        {/* warning badge for the error state (triangle + "!"), pops above the head */}
        <g id="alert" opacity="0">
          <path d="M270 -105 L318 -20 L222 -20 Z" fill="#E5484D" stroke="#FFFFFF" strokeWidth="6" strokeLinejoin="round" />
          <rect x="265" y="-80" width="10" height="36" rx="5" fill="#FFFFFF" />
          <rect x="265" y="-36" width="10" height="10" rx="5" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
};

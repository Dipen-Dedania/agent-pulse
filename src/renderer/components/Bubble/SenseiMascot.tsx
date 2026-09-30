import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Sensei mascot ───────────────────────────────────────────────────────────
// An original, hand-drawn black-and-white panda martial artist in the spirit
// of a certain noodle-loving kung fu bear: a round white head with black ears
// and eye patches, a white torso under a black shoulder yoke, a tan sash, and
// black arm/leg stubs for punches and kicks. Each AgentState drives a pose:
//
//   idle         → slumped onto a pillow, big belly breathing, eyes shut,
//                  drifting "zzz"
//   idle-active  → breathing, plus a periodic ear-wiggle + one-eye squint
//   working      → a kung fu combo: three alternating punches, a high kick,
//                  a jump-spin with a squash landing, then a quick bow
//   waiting      → "need input" sign rises, foot-tap, arms fold, body rocks
//   error        → dizzy: stars orbit the head, head wobbles, X-eyes, ⚠ badge
//
// The rig shares Merc/Ghost's coordinate space and prop geometry (pillow,
// zzz, sign, badge all sit where theirs do), so it drops into the same
// window footprint in MASCOT_GEOMETRY without retuning. Every animated part
// pivots at its own local origin: either wrapped in a static
// `<g transform="translate(x y)">` with the inner group animated via
// `transformOrigin: '0px 0px'` (arms, legs), or tweened with an explicit
// `svgOrigin` (body, head, stars) — never a bare rotation on an authored
// transform, which GSAP's revert() would fail to unwind cleanly (see
// mascotRig.ts).
//
// All animation lives in a `gsap.context` scoped to the component's root and
// reverted on every state change; `resetMascotRig` puts the authored
// transforms back first.

interface SenseiMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Merc/Ghost: character spans x ≈ 90..450, y ≈ 40..590
// (base line y 590). Headroom above (y -200..0) holds the sign, zzz, badge
// and the dizzy stars.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const EYES_C = '270 205'; // centre between the two lenses
const FOOT_C = '270 590'; // base of the torso (squash / hop / rock pivot)
const HEAD_C = '270 370'; // where the head meets the torso (head tilt pivot)

const WHITE = '#fafafa';
const BLACK = '#111111';
const SASH = '#c98a2b';
const STAR = '#ffd54a';
const FIST = '#2e2e2e';

// Torso: shoulders at y 330, straight flanks 400..520, rounded base to y 590
// (same silhouette Merc/Knight reuse).
const TORSO_D = 'M130 400 C130 340 190 330 270 330 C350 330 410 340 410 400 L410 520 C410 570 350 590 270 590 C190 590 130 570 130 520 Z';
// Black shoulder yoke: the top ~80 units of the torso.
const YOKE_D = 'M130 400 C130 340 190 330 270 330 C350 330 410 340 410 400 L410 412 L130 412 Z';
// A leg stub: flat at the ground line, rounded above it.
const LEG_D = 'M-55 0 A55 55 0 0 0 55 0 Z';
// A simple 5-point star, centred at its own local origin.
const STAR_D = 'M0,-18 L4.2,-5.6 L17.6,-5.6 L6.7,2.1 L10.9,15 L0,7.2 L-10.9,15 L-6.7,2.1 L-17.6,-5.6 L-4.2,-5.6 Z';

export const SenseiMascot: React.FC<SenseiMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);
  // Authored transforms, captured on mount so every pose can start from them.
  const rigRef = useRef<MascotRigSnapshot | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    // Put the rig back on its authored coordinates before each pose (see
    // mascotRig.ts): ctx.revert() doesn't reliably unwind the SVG transform
    // attribute, so without this the character drifts on every state change.
    if (!rigRef.current) rigRef.current = snapshotMascotRig(rootRef.current);
    resetMascotRig(rigRef.current);

    const ctx = gsap.context(() => {
      const LOCAL = { transformOrigin: '0px 0px' };

      // ── idle → SLEEP ────────────────────────────────────────────────────
      const playSleep = () => {
        gsap.to('#pillow', { opacity: 1, duration: 0.4 });
        gsap.timeline()
          .to('#char', { rotation: -14, x: -14, y: 14, svgOrigin: '150 590', duration: 0.9, ease: 'power2.inOut' })
          .to('#eyes', { scaleY: 0.12, svgOrigin: EYES_C, duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .add(() => {
            // big belly breathing from the base
            gsap.to('#body', { scaleY: 1.05, svgOrigin: FOOT_C, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '350 -60' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 45, y: -80, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → NEUTRAL + ear-wiggle tic ──────────────────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        // Every few seconds: both ears wiggle a few quick beats and one eye
        // squints for a moment, then everything snaps back.
        gsap.timeline({ repeat: -1, repeatDelay: 4.5, delay: 1.2 })
          .to('#ear-l, #ear-r', { rotation: 10, svgOrigin: '150 85', duration: 0.1, ease: 'power1.inOut' })
          .to('#ear-l, #ear-r', { rotation: -10, svgOrigin: '150 85', duration: 0.1, ease: 'power1.inOut' })
          .to('#ear-l, #ear-r', { rotation: 10, svgOrigin: '150 85', duration: 0.1, ease: 'power1.inOut' })
          .to('#ear-l, #ear-r', { rotation: 0, svgOrigin: '150 85', duration: 0.1, ease: 'power1.inOut' })
          .to('#eye-r', { scaleY: 0.45, svgOrigin: '326 205', duration: 0.15, ease: 'power1.inOut' }, '<0.1')
          .to({}, { duration: 0.6 })
          .to('#eye-r', { scaleY: 1, svgOrigin: '326 205', duration: 0.15, ease: 'power1.inOut' });
      };

      // ── working → KUNG FU COMBO: punches, kick, spin, bow ───────────────
      const playRun = () => {
        const tl = gsap.timeline({ repeat: -1 });

        // Three alternating punches, body leaning into each one.
        const punch = 0.14;
        for (let i = 0; i < 3; i++) {
          tl.to('#arm-l', { rotation: -110, ...LOCAL, duration: punch, ease: 'power3.in' })
            .to('#char', { x: -22, rotation: -7, svgOrigin: FOOT_C, duration: punch, ease: 'power2.out' }, '<')
            .to('#arm-l', { rotation: 0, ...LOCAL, duration: punch * 1.6, ease: 'power2.out' })
            .to('#arm-r', { rotation: 110, ...LOCAL, duration: punch, ease: 'power3.in' }, '<')
            .to('#char', { x: 22, rotation: 7, svgOrigin: FOOT_C, duration: punch, ease: 'power2.out' }, '<')
            .to('#arm-r', { rotation: 0, ...LOCAL, duration: punch * 1.6, ease: 'power2.out' });
        }
        tl.to('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C, duration: 0.2, ease: 'power2.inOut' });

        // High kick, leaning back into it.
        tl.to('#leg-r', { rotation: -80, ...LOCAL, duration: 0.22, ease: 'power3.out' })
          .to('#char', { rotation: -10, svgOrigin: FOOT_C, duration: 0.22, ease: 'power2.out' }, '<')
          .to('#leg-r', { rotation: 0, ...LOCAL, duration: 0.3, ease: 'power2.in' })
          .to('#char', { rotation: 0, svgOrigin: FOOT_C, duration: 0.3, ease: 'power2.in' }, '<');

        // Jump-spin with a squash landing.
        tl.to('#char', { y: -60, duration: 0.25, ease: 'power2.out' })
          .to('#char', { rotation: 360, svgOrigin: '270 300', duration: 0.55, ease: 'power1.inOut' }, '<')
          .to('#char', { y: 0, duration: 0.25, ease: 'power2.in' })
          .set('#char', { rotation: 0 })
          .to('#char', { scaleY: 0.92, scaleX: 1.05, svgOrigin: FOOT_C, duration: 0.1, ease: 'power1.out' })
          .to('#char', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.15 });

        // A quick bow, then a beat before the combo repeats.
        tl.to('#head', { rotation: 10, svgOrigin: HEAD_C, duration: 0.2, ease: 'power2.out' })
          .to({}, { duration: 0.3 })
          .to('#head', { rotation: 0, svgOrigin: HEAD_C, duration: 0.2, ease: 'power2.in' })
          .to({}, { duration: 0.4 });
      };

      // ── waiting → NEED INPUT (sign rises, foot-tap, arms fold) ──────────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .to('#arm-l', { rotation: -35, ...LOCAL, duration: 0.3, ease: 'power2.out' }, '-=0.3')
          .to('#arm-r', { rotation: 35, ...LOCAL, duration: 0.3, ease: 'power2.out' }, '<')
          .to('#eyes', { x: 10, y: -6, duration: 0.3, ease: 'power2.out' }, '<') // glance at the sign
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // impatient foot-tap
            gsap.to('#leg-r', { y: -10, ...LOCAL, duration: 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // restless rock on the base
            gsap.fromTo('#body', { rotation: -3, svgOrigin: FOOT_C }, { rotation: 3, svgOrigin: FOOT_C, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      // ── error → DIZZY: stars orbit, head wobbles, X-eyes, ⚠ ─────────────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap lenses → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.set('#stars', { opacity: 0 });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .to('#stars', { opacity: 1, duration: 0.3 }, '-=0.2')
          .add(() => {
            // stars circling the head, forever
            gsap.to('#stars', { rotation: 360, svgOrigin: '270 40', duration: 2, ease: 'none', repeat: -1 });
            // head wobble
            gsap.fromTo('#head', { rotation: -8, svgOrigin: HEAD_C }, { rotation: 8, svgOrigin: HEAD_C, duration: 0.5, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // the coat drains to near-black in a strobe
            gsap.to('#dark-tint', { opacity: 0.5, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#char', { x: 7, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -5, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // badge throb
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

      {/* pillow for sleep (behind him, under the left shoulder) */}
      <rect id="pillow" x="0" y="500" width="230" height="95" rx="44" fill="#ECE6DA" opacity="0" />

      <g id="char">
        <g id="body">
          {/* torso: white base under a black shoulder yoke and a tan sash */}
          <path d={TORSO_D} fill={WHITE} />
          <path d={YOKE_D} fill={BLACK} />
          <rect id="sash" x="130" y="470" width="280" height="30" fill={SASH} />

          {/* leg stubs, wrapped in a static translate so each pivots at the
              hip; the right one kicks / taps, the left stays put */}
          <g transform="translate(170 590)"><g id="leg-l" transform="rotate(0)"><path d={LEG_D} fill={BLACK} /></g></g>
          <g transform="translate(370 590)"><g id="leg-r" transform="rotate(0)"><path d={LEG_D} fill={BLACK} /></g></g>

          {/* arm stubs, wrapped in a static translate at each shoulder */}
          <g transform="translate(132 430)">
            <g id="arm-l" transform="rotate(0)">
              <circle cx="0" cy="0" r="44" fill={BLACK} />
              <circle cx="10" cy="-10" r="14" fill={FIST} />
            </g>
          </g>
          <g transform="translate(408 430)">
            <g id="arm-r" transform="rotate(0)">
              <circle cx="0" cy="0" r="44" fill={BLACK} />
              <circle cx="-10" cy="-10" r="14" fill={FIST} />
            </g>
          </g>

          <g id="head">
            <circle cx="270" cy="205" r="165" fill={WHITE} />
            {/* black ears, each pivots about its own centre for the tic */}
            <g id="ear-l"><circle cx="150" cy="85" r="46" fill={BLACK} /></g>
            <g id="ear-r"><circle cx="390" cy="85" r="46" fill={BLACK} /></g>
            {/* black eye patches, angled outward */}
            <g id="patches" fill={BLACK}>
              <ellipse cx="214" cy="205" rx="46" ry="60" transform="rotate(-12 214 205)" />
              <ellipse cx="326" cy="205" rx="46" ry="60" transform="rotate(12 326 205)" />
            </g>
            {/* nose + smile, unaffected by the eye states below */}
            <ellipse cx="270" cy="268" rx="18" ry="12" fill={BLACK} />
            <path d="M240 300 Q270 320 300 300" stroke={BLACK} strokeWidth="8" fill="none" strokeLinecap="round" />
            {/* white lenses with black pupils */}
            <g id="eyes" fill={WHITE}>
              <g id="eye-l"><ellipse cx="214" cy="205" rx="20" ry="26" /><circle cx="214" cy="207" r="10" fill={BLACK} /></g>
              <g id="eye-r"><ellipse cx="326" cy="205" rx="20" ry="26" /><circle cx="326" cy="207" r="10" fill={BLACK} /></g>
            </g>
            {/* X eyes for the error state (shown while #eyes is hidden) */}
            <g id="eyes-x" opacity="0" stroke={WHITE} strokeWidth="10" strokeLinecap="round">
              <line x1="192" y1="181" x2="236" y2="229" />
              <line x1="236" y1="181" x2="192" y2="229" />
              <line x1="304" y1="181" x2="348" y2="229" />
              <line x1="348" y1="181" x2="304" y2="229" />
            </g>
          </g>

          {/* black overlay for the error strobe (same silhouette) */}
          <g id="dark-tint" fill={BLACK} opacity="0">
            <path d={TORSO_D} />
            <circle cx="132" cy="430" r="44" />
            <circle cx="408" cy="430" r="44" />
            <circle cx="270" cy="205" r="165" />
          </g>
        </g>

        {/* dizzy stars, orbiting above the head for the error state */}
        <g id="stars" opacity="0">
          <g transform="translate(200 -50)"><path d={STAR_D} fill={STAR} /></g>
          <g transform="translate(270 -75)"><path d={STAR_D} fill={STAR} /></g>
          <g transform="translate(340 -50)"><path d={STAR_D} fill={STAR} /></g>
        </g>

        {/* "need input" sign, planted beside his right flank */}
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

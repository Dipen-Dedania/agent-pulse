import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Merc mascot ─────────────────────────────────────────────────────────────
// An original, hand-drawn red-masked mercenary in the spirit of a certain
// fourth-wall-breaking comic anti-hero: red chibi body with black side panels,
// black teardrop eye patches with white lenses, a grey utility belt, two sword
// hilts crossed behind the shoulders. No arms to speak of beyond two stubs, so
// like Kiro everything is body english. Each AgentState drives a pose:
//
//   idle         → sprawled on a pillow, lenses shut, drifting "zzz"
//   idle-active  → breathing, plus a periodic sideways glance at the viewer
//                  with one lens narrowed (the fourth-wall look)
//   waiting      → "need input" sign beside him, impatient rock + eye-roll
//   working      → the swords come out: alternating slashes, dash laps, a
//                  360 spin, land, wink
//   error        → colour drains to black in a strobe (the character is
//                  already red, so the usual red tint would vanish), glitch
//                  shudder, X-eyes, ⚠ badge
//
// The rig shares Kiro's coordinate space and prop geometry (pillow, zzz, sign,
// badge all sit where the ghost's do), so it drops into Ghost's footprint in
// MASCOT_GEOMETRY without retuning. Every animated part has its pivot at its
// own local origin (blade groups are wrapped in a static translate), so poses
// can use plain `transformOrigin: '0 0'` and never fight an authored transform.
//
// All animation lives in a `gsap.context` scoped to the component's root and
// reverted on every state change; `resetMascotRig` puts the authored transforms
// back first (see mascotRig.ts for why).

interface MercMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Kiro: character spans x ≈ 90..450, y ≈ 40..590 (base line
// y 590). Headroom above (y -200..0) holds the sign, zzz and badge; the blades
// swing out to roughly x -60 / 600 and up to y ≈ 100 in the working pose.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const EYES_C = '270 208'; // centre between the two lenses
const FOOT_C = '270 590'; // base of the torso (squash / hop pivot)
const HEAD_C = '270 370'; // where the head meets the torso (head tilt pivot)

const RED = '#c8102e';
const BLACK = '#111111';
const WHITE = '#ffffff';
const BELT = '#4a4a4a';
const BUCKLE = '#d9d9d9';
const GRIP = '#2b2b2b';
const GRIP_WRAP = '#6b6b6b';
const STEEL = '#9a9a9a';
const BLADE = '#e6e9ee';
const BLADE_EDGE = '#b9c0c9';

// Torso: shoulders at y 330, straight flanks 400..520, rounded base to y 590.
const TORSO_D = 'M130 400 C130 340 190 330 270 330 C350 330 410 340 410 400 L410 520 C410 570 350 590 270 590 C190 590 130 570 130 520 Z';
// Red centre panel over the black torso (leaves black side panels showing).
const PANEL_D = 'M200 332 Q270 326 340 332 L336 560 Q270 592 204 560 Z';

// A sheathed hilt, drawn pointing up from its guard at the local origin.
const Hilt: React.FC = () => (
  <>
    <rect x="-11" y="-112" width="22" height="112" rx="8" fill={GRIP} />
    <rect x="-11" y="-92" width="22" height="6" fill={GRIP_WRAP} />
    <rect x="-11" y="-66" width="22" height="6" fill={GRIP_WRAP} />
    <rect x="-11" y="-40" width="22" height="6" fill={GRIP_WRAP} />
    <ellipse cx="0" cy="0" rx="30" ry="10" fill={STEEL} />
    <circle cx="0" cy="-120" r="12" fill={STEEL} />
  </>
);

// A drawn katana: guard at the local origin, blade up (-y), grip down (+y).
const Sword: React.FC = () => (
  <>
    <rect x="-9" y="0" width="18" height="78" rx="6" fill={GRIP} />
    <rect x="-9" y="20" width="18" height="6" fill={GRIP_WRAP} />
    <rect x="-9" y="46" width="18" height="6" fill={GRIP_WRAP} />
    <circle cx="0" cy="84" r="10" fill={STEEL} />
    <ellipse cx="0" cy="0" rx="28" ry="9" fill={STEEL} />
    <path d="M-8 -6 L-8 -330 L0 -372 L8 -330 L8 -6 Z" fill={BLADE} />
    <path d="M4 -6 L4 -330 L0 -372 L8 -330 L8 -6 Z" fill={BLADE_EDGE} />
  </>
);

export const MercMascot: React.FC<MercMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);
  // Authored transforms, captured on mount so every pose can start from them.
  const rigRef = useRef<MascotRigSnapshot | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    // GSAP's revert() leaves SVG transform residue behind (see mascotRig.ts):
    // without this the character drifts a few user units lower on every state
    // change until it overlaps the usage bars.
    if (!rigRef.current) rigRef.current = snapshotMascotRig(rootRef.current);
    resetMascotRig(rigRef.current);

    const ctx = gsap.context(() => {
      const show = (sel: string) => gsap.to(sel, { opacity: 1, duration: 0.4 });
      const LOCAL = { transformOrigin: '0px 0px' };

      // ── idle → SLEEP ────────────────────────────────────────────────────
      const playSleep = () => {
        show('#pillow');
        gsap.timeline()
          .to('#char', { rotation: -14, x: -14, y: 14, svgOrigin: '150 590', duration: 0.9, ease: 'power2.inOut' })
          .to('#eyes', { scaleY: 0.12, svgOrigin: EYES_C, duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .add(() => {
            // slow breathing from the base
            gsap.to('#body', { scaleY: 1.03, scaleX: 1.012, svgOrigin: FOOT_C, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '350 -60' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 45, y: -80, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → NEUTRAL + fourth-wall glance ──────────────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        // Every few seconds: lenses slide sideways, head tips a touch, one lens
        // narrows for a beat, then everything snaps back.
        gsap.timeline({ repeat: -1, repeatDelay: 4.5, delay: 1.2 })
          .to('#eyes', { x: 18, duration: 0.25, ease: 'power2.out' })
          .to('#head', { rotation: 3, svgOrigin: HEAD_C, duration: 0.25, ease: 'power2.out' }, '<')
          .to('#eye-r', { scaleY: 0.5, svgOrigin: '326 208', duration: 0.15, ease: 'power1.inOut' })
          .to({}, { duration: 0.7 })
          .to('#eye-r', { scaleY: 1, svgOrigin: '326 208', duration: 0.15, ease: 'power1.inOut' })
          .to('#eyes', { x: 0, duration: 0.2, ease: 'power2.in' })
          .to('#head', { rotation: 0, svgOrigin: HEAD_C, duration: 0.2, ease: 'power2.in' }, '<');
      };

      // ── working → SWORDS OUT: slashes, dash laps, spin, wink ────────────
      const playRun = () => {
        gsap.set('#hilts', { opacity: 0 });
        gsap.set('#blades', { opacity: 1 });
        const tl = gsap.timeline({ repeat: -1 });

        // Alternating slashes: each blade sweeps from its raised guard position
        // down and across, while the body leans into the cut.
        const cut = 0.16;
        for (let i = 0; i < 3; i++) {
          tl.to('#blade-l', { rotation: -125, ...LOCAL, duration: cut, ease: 'power3.in' })
            .to('#char', { x: -22, rotation: -7, svgOrigin: FOOT_C, duration: cut, ease: 'power2.out' }, '<')
            .to('#blade-l', { rotation: -30, ...LOCAL, duration: cut * 1.6, ease: 'power2.out' })
            .to('#blade-r', { rotation: 125, ...LOCAL, duration: cut, ease: 'power3.in' }, '<')
            .to('#char', { x: 22, rotation: 7, svgOrigin: FOOT_C, duration: cut, ease: 'power2.out' }, '<')
            .to('#blade-r', { rotation: 30, ...LOCAL, duration: cut * 1.6, ease: 'power2.out' });
        }
        tl.to('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C, duration: 0.2, ease: 'power2.inOut' });

        // Dash laps: lean into a sprint left and right.
        const s = 0.32;
        for (let r = 0; r < 2; r++) {
          tl.to('#char', { x: -85, rotation: -9, svgOrigin: FOOT_C, duration: s, ease: 'power2.inOut' })
            .to('#char', { x: 85, rotation: 9, svgOrigin: FOOT_C, duration: s * 1.6, ease: 'power2.inOut' })
            .to('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C, duration: s, ease: 'power2.inOut' });
        }

        // Jump-spin with both blades out, land with a squash, then a wink.
        tl.to('#char', { y: -60, duration: 0.25, ease: 'power2.out' })
          .to('#char', { rotation: 360, svgOrigin: '270 300', duration: 0.55, ease: 'power1.inOut' }, '<')
          .to('#char', { y: 0, duration: 0.25, ease: 'power2.in' })
          .set('#char', { rotation: 0 })
          .to('#char', { scaleY: 0.92, scaleX: 1.05, svgOrigin: FOOT_C, duration: 0.1, ease: 'power1.out' })
          .to('#char', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.15 })
          .to('#eye-l', { scaleY: 0.15, svgOrigin: '214 208', duration: 0.1, ease: 'power1.inOut', repeat: 1, yoyo: true, repeatDelay: 0.25 })
          .to({}, { duration: 0.4 }); // beat before the loop repeats
      };

      // ── waiting → NEED INPUT (sign rises, impatient rock + eye-roll) ────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // impatient rock on the base, foot-tap tempo
            gsap.fromTo('#body', { rotation: -3, svgOrigin: FOOT_C }, { rotation: 3, svgOrigin: FOOT_C, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // eye-roll on each rock, arms bob the other way
            gsap.to('#eyes', { y: -12, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
            gsap.to('#arm-l, #arm-r', { y: 6, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      // ── error → colour drain + glitch + X-eyes + ⚠ ──────────────────────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap lenses → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .add(() => {
            // the suit drains to near-black in a strobe (red is his resting colour)
            gsap.to('#dark-tint', { opacity: 0.72, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#char', { x: 7, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -5, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // sharp "no" head-shake
            gsap.fromTo('#head', { rotation: -4, svgOrigin: HEAD_C }, { rotation: 4, svgOrigin: HEAD_C, duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true });
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
        {/* sheathed hilts crossed behind the shoulders (hidden while working) */}
        <g id="hilts">
          <g transform="translate(175 345)"><g transform="rotate(-35)"><Hilt /></g></g>
          <g transform="translate(365 345)"><g transform="rotate(35)"><Hilt /></g></g>
        </g>

        <g id="body">
          {/* torso: black base with red centre panel → black side panels */}
          <g id="torso">
            <path d={TORSO_D} fill={BLACK} />
            <path d={PANEL_D} fill={RED} />
            <g id="belt">
              <rect x="130" y="478" width="280" height="34" fill={BELT} />
              <circle cx="270" cy="495" r="34" fill={BUCKLE} />
              <circle cx="270" cy="495" r="22" fill={BELT} />
            </g>
          </g>

          {/* arm stubs, sitting on the black side panels */}
          <g id="arm-l"><circle cx="132" cy="440" r="40" fill={RED} stroke={BLACK} strokeWidth="6" /></g>
          <g id="arm-r"><circle cx="408" cy="440" r="40" fill={RED} stroke={BLACK} strokeWidth="6" /></g>

          {/* drawn swords for the working pose; each pivots at its arm */}
          <g id="blades" opacity="0">
            <g transform="translate(132 440)"><g id="blade-l" transform="rotate(-30)"><Sword /></g></g>
            <g transform="translate(408 440)"><g id="blade-r" transform="rotate(30)"><Sword /></g></g>
          </g>

          <g id="head">
            <circle cx="270" cy="205" r="165" fill={RED} />
            {/* black teardrop patches, angled outward */}
            <g id="patches" fill={BLACK}>
              <ellipse cx="212" cy="205" rx="50" ry="78" transform="rotate(-16 212 205)" />
              <ellipse cx="328" cy="205" rx="50" ry="78" transform="rotate(16 328 205)" />
            </g>
            {/* white lenses */}
            <g id="eyes" fill={WHITE}>
              <ellipse id="eye-l" cx="214" cy="208" rx="22" ry="34" transform="rotate(-16 214 208)" />
              <ellipse id="eye-r" cx="326" cy="208" rx="22" ry="34" transform="rotate(16 326 208)" />
            </g>
            {/* X eyes for the error state (shown while #eyes is hidden) */}
            <g id="eyes-x" opacity="0" stroke={WHITE} strokeWidth="12" strokeLinecap="round">
              <line x1="192" y1="184" x2="236" y2="232" />
              <line x1="236" y1="184" x2="192" y2="232" />
              <line x1="304" y1="184" x2="348" y2="232" />
              <line x1="348" y1="184" x2="304" y2="232" />
            </g>
          </g>

          {/* black overlay for the error strobe (same silhouette) */}
          <g id="dark-tint" fill={BLACK} opacity="0">
            <path d={TORSO_D} />
            <circle cx="132" cy="440" r="43" />
            <circle cx="408" cy="440" r="43" />
            <circle cx="270" cy="205" r="165" />
          </g>
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

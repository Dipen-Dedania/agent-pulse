import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Knight mascot ───────────────────────────────────────────────────────────
// An original, hand-drawn caped vigilante in the spirit of a certain brooding,
// cowled comic hero: a dark cowl with pointed ears, a flowing two-tone cape, a
// gold diamond emblem on the chest (not a bat shape) and a gold belt. Rim-light
// strokes trace the silhouette so he still reads against dark glass. Each
// AgentState drives a pose:
//
//   idle         → cape wraps around him on the pillow, eyes shut, zzz drifts
//   idle-active  → slow breathing, cape sways, a periodic narrowed-eye /
//                  head-turn "tic" with a cape twitch
//   waiting      → "need input" sign rises, arms fold inward, body rocks,
//                  cape sways, eyes glance at the sign
//   working      → crouch, leap with the cape flaring, land, two dash laps,
//                  then throws his boomerang out and back
//   error        → X-eyes, the chest emblem cracks, head shakes, a red tint
//                  strobes over the (otherwise all-dark) silhouette, ⚠ badge
//
// The rig shares Merc/Kiro's coordinate space and prop geometry (pillow, zzz,
// sign, badge all sit where theirs do), so it drops into the same window
// footprint without retuning. Every animated part pivots at its own local
// origin (the boomerang is wrapped in a static translate so it can be
// tweened with a plain 0,0 transform origin), so poses never fight an
// authored transform.
//
// All animation lives in a `gsap.context` scoped to the component's root and
// reverted on every state change; `resetMascotRig` puts the authored
// transforms back first (see mascotRig.ts for why).

interface KnightMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Merc/Kiro: character spans x ≈ 90..450, y ≈ 40..590 (base
// line y 590). Headroom above (y -200..0) holds the sign, zzz and badge; the
// cape flares out to roughly x 55..485 and the boomerang throw reaches x 330.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const EYES_C = '270 200'; // centre between the two eye-slits
const FOOT_C = '270 590'; // base of the torso (squash / crouch / leap pivot)
const HEAD_C = '270 370'; // where the head meets the torso (head turn / shake pivot)
const CAPE_C = '270 330'; // shoulder line where the cape gathers

const COWL = '#2a2e38';
const RIM = '#7f8aa3';
const CAPE_OUTER = '#1a1d26';
const CAPE_INNER = '#3b2f52';
const GOLD = '#e0b13a';
const WHITE = '#ffffff';
const SKIN = '#d8b89c';
const RED = '#c8102e';

// Torso: shoulders at y 330, straight flanks 400..520, rounded base to y 590
// (identical geometry to Merc's TORSO_D so both drop into the same footprint).
const TORSO_D = 'M130 400 C130 340 190 330 270 330 C350 330 410 340 410 400 L410 520 C410 570 350 590 270 590 C190 590 130 570 130 520 Z';

// Wide cloak draping from the shoulders down past the feet, gathered in a
// shallow collar notch at the neck.
const CAPE_D = 'M170 330 C100 345 55 430 65 520 C72 575 120 604 180 604 L360 604 C420 604 468 575 475 520 C485 430 440 345 370 330 C345 352 315 362 270 362 C225 362 195 352 170 330 Z';
// Inner lining, glimpsed through the front opening of the cloak.
const CAPE_INNER_D = 'M270 380 C230 400 205 460 210 540 C213 570 240 590 270 590 C300 590 327 570 330 540 C335 460 310 400 270 380 Z';

export const KnightMascot: React.FC<KnightMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);
  // Authored transforms, captured on mount so every pose can start from them.
  const rigRef = useRef<MascotRigSnapshot | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    // See mascotRig.ts: gsap's revert() leaves SVG transform residue behind,
    // so put the rig back on its authored coordinates before each pose.
    if (!rigRef.current) rigRef.current = snapshotMascotRig(rootRef.current);
    resetMascotRig(rigRef.current);

    const ctx = gsap.context(() => {
      const show = (sel: string) => gsap.to(sel, { opacity: 1, duration: 0.4 });
      const LOCAL = { transformOrigin: '0px 0px' };

      // ── idle → SLEEP: cape wraps around him ─────────────────────────────
      const playSleep = () => {
        show('#pillow');
        gsap.timeline()
          .to('#char', { rotation: -14, x: -14, y: 14, svgOrigin: '150 590', duration: 0.9, ease: 'power2.inOut' })
          .to('#eyes', { scaleY: 0.12, svgOrigin: EYES_C, duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .to('#cape', { scaleX: 0.8, svgOrigin: CAPE_C, duration: 0.5, ease: 'power2.out' }, '<')
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

      // ── idle-active → NEUTRAL + narrowed-eye / head-turn tic ────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        // Continuous slow cape sway (independent property of the tic below).
        gsap.fromTo('#cape', { rotation: -3, svgOrigin: CAPE_C }, { rotation: 3, svgOrigin: CAPE_C, duration: 2.6, ease: 'sine.inOut', repeat: -1, yoyo: true });
        // Every few seconds: eyes narrow, head turns, cape twitches, hold, reset.
        gsap.timeline({ repeat: -1, repeatDelay: 3.7, delay: 1.2 })
          .to('#eyes', { scaleY: 0.45, svgOrigin: EYES_C, duration: 0.2, ease: 'power2.out' })
          .to('#head', { rotation: 4, svgOrigin: HEAD_C, duration: 0.2, ease: 'power2.out' }, '<')
          .to('#cape', { scaleX: 1.08, svgOrigin: CAPE_C, duration: 0.2, ease: 'power2.out' }, '<')
          .to({}, { duration: 0.8 })
          .to('#eyes', { scaleY: 1, svgOrigin: EYES_C, duration: 0.2, ease: 'power2.in' })
          .to('#head', { rotation: 0, svgOrigin: HEAD_C, duration: 0.2, ease: 'power2.in' }, '<')
          .to('#cape', { scaleX: 1, svgOrigin: CAPE_C, duration: 0.2, ease: 'power2.in' }, '<');
      };

      // ── working → crouch, leap, dash laps, throw the boomerang ──────────
      const playRun = () => {
        gsap.set('#boomerang', { opacity: 0 });
        const tl = gsap.timeline({ repeat: -1 });

        // Crouch, leap with the cape flaring, land with a squash.
        tl.to('#char', { scaleY: 0.9, svgOrigin: FOOT_C, duration: 0.18, ease: 'power2.in' })
          .to('#char', { y: -90, scaleY: 1, svgOrigin: FOOT_C, duration: 0.32, ease: 'power2.out' })
          .to('#cape', { scaleX: 1.45, scaleY: 1.2, svgOrigin: CAPE_C, duration: 0.32, ease: 'power2.out' }, '<')
          .to('#char', { y: 0, duration: 0.28, ease: 'power2.in' })
          .to('#cape', { scaleX: 1, scaleY: 1, svgOrigin: CAPE_C, duration: 0.28, ease: 'power2.in' }, '<')
          .to('#char', { scaleY: 0.9, scaleX: 1.08, svgOrigin: FOOT_C, duration: 0.1, ease: 'power1.out' })
          .to('#char', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.15 });

        // Two dash laps, leaning into the sprint (same rhythm as Merc's).
        const s = 0.32;
        for (let r = 0; r < 2; r++) {
          tl.to('#char', { x: -85, rotation: -9, svgOrigin: FOOT_C, duration: s, ease: 'power2.inOut' })
            .to('#char', { x: 85, rotation: 9, svgOrigin: FOOT_C, duration: s * 1.6, ease: 'power2.inOut' })
            .to('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C, duration: s, ease: 'power2.inOut' });
        }

        // The throw: boomerang whips out, spins, and returns.
        tl.set('#boomerang', { opacity: 1, x: 0, rotation: 0 })
          .to('#boomerang', { x: 330, rotation: 720, duration: 0.45, ease: 'power2.out', ...LOCAL })
          .to('#boomerang', { x: 0, rotation: 1440, opacity: 0, duration: 0.45, ease: 'power2.in', ...LOCAL })
          .to({}, { duration: 0.3 });
      };

      // ── waiting → NEED INPUT (arms fold, restless rock, glance at sign) ─
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .to('#arm-l', { x: 30, duration: 0.3, ease: 'power2.out' }, '-=0.2') // fold arms inward
          .to('#arm-r', { x: -30, duration: 0.3, ease: 'power2.out' }, '<')
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // impatient rock on the base, foot-tap tempo
            gsap.fromTo('#body', { rotation: -3, svgOrigin: FOOT_C }, { rotation: 3, svgOrigin: FOOT_C, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // cape sways along with the rock
            gsap.fromTo('#cape', { rotation: -4, svgOrigin: CAPE_C }, { rotation: 4, svgOrigin: CAPE_C, duration: 0.6, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // eyes glance up toward the sign
            gsap.to('#eyes', { x: 10, y: -6, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      // ── error → cracked emblem + head shake + red strobe + X-eyes + ⚠ ───
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap eye-slits → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.set('#emblem-crack', { opacity: 0 });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .to('#emblem-crack', { opacity: 1, duration: 0.3, ease: 'power1.out' }, '-=0.2') // chest cracks
          .add(() => {
            // he is all dark, so a red tint reads as the "fault" colour
            gsap.to('#red-tint', { opacity: 0.4, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#char', { x: 7, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -5, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // head shake
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
      <defs>
        <clipPath id="knight-head-clip"><circle cx="270" cy="205" r="160" /></clipPath>
      </defs>

      {/* floating "zzz" for sleep (above the head) */}
      <text id="zzz" x="290" y="-10" fontFamily="ui-sans-serif, sans-serif" fontSize="140" fontStyle="italic" fontWeight="700" fill="#cfd3da" opacity="0">z z z</text>

      {/* pillow for sleep (behind him, under the left shoulder) */}
      <rect id="pillow" x="0" y="500" width="230" height="95" rx="44" fill="#ECE6DA" opacity="0" />

      <g id="char">
        {/* cape, drawn behind the body so it reads as draped over the shoulders */}
        <g id="cape">
          <path d={CAPE_D} fill={CAPE_OUTER} stroke={RIM} strokeWidth="5" />
          <path d={CAPE_INNER_D} fill={CAPE_INNER} />
        </g>

        <g id="body">
          <path d={TORSO_D} fill={COWL} stroke={RIM} strokeWidth="5" />
          <rect id="belt" x="130" y="478" width="280" height="26" fill={GOLD} />

          {/* chest emblem: a plain gold diamond, no franchise shapes */}
          <path id="emblem" d="M270 390 L315 420 L270 450 L225 420 Z" fill={GOLD} />
          <g id="emblem-crack" opacity="0" stroke={CAPE_OUTER} strokeWidth="4" strokeLinecap="round">
            <line x1="245" y1="405" x2="270" y2="435" />
            <line x1="270" y1="392" x2="270" y2="448" />
            <line x1="295" y1="405" x2="270" y2="435" />
          </g>

          {/* arm stubs */}
          <g id="arm-l"><circle cx="132" cy="440" r="40" fill={COWL} stroke={RIM} strokeWidth="5" /></g>
          <g id="arm-r"><circle cx="408" cy="440" r="40" fill={COWL} stroke={RIM} strokeWidth="5" /></g>

          {/* boomerang, thrown from the right hand during the working pose */}
          <g transform="translate(408 440)">
            <g id="boomerang" opacity="0">
              <line x1="0" y1="0" x2="30" y2="-52" stroke={CAPE_OUTER} strokeWidth="14" strokeLinecap="round" />
              <line x1="0" y1="0" x2="30" y2="52" stroke={CAPE_OUTER} strokeWidth="14" strokeLinecap="round" />
            </g>
          </g>

          <g id="head">
            {/* pointed cowl ears */}
            <path d="M190 90 L150 10 L235 85 Z" fill={COWL} stroke={RIM} strokeWidth="5" strokeLinejoin="round" />
            <path d="M350 90 L390 10 L305 85 Z" fill={COWL} stroke={RIM} strokeWidth="5" strokeLinejoin="round" />
            {/* cowl */}
            <circle cx="270" cy="205" r="160" fill={COWL} stroke={RIM} strokeWidth="5" />
            {/* exposed lower-face skin, clipped to the cowl */}
            <g clipPath="url(#knight-head-clip)">
              <rect x="110" y="240" width="320" height="130" fill={SKIN} />
            </g>
            {/* white angular eye-slits */}
            <g id="eyes" fill={WHITE}>
              <ellipse id="eye-l" cx="214" cy="200" rx="30" ry="12" transform="rotate(-12 214 200)" />
              <ellipse id="eye-r" cx="326" cy="200" rx="30" ry="12" transform="rotate(12 326 200)" />
            </g>
            {/* X eyes for the error state (shown while #eyes is hidden) */}
            <g id="eyes-x" opacity="0" stroke={WHITE} strokeWidth="10" strokeLinecap="round">
              <line x1="192" y1="180" x2="236" y2="224" />
              <line x1="236" y1="180" x2="192" y2="224" />
              <line x1="304" y1="180" x2="348" y2="224" />
              <line x1="348" y1="180" x2="304" y2="224" />
            </g>
          </g>

          {/* red overlay for the error strobe (same silhouette, he is all dark otherwise) */}
          <g id="red-tint" fill={RED} opacity="0">
            <path d={CAPE_D} />
            <path d={TORSO_D} />
            <circle cx="132" cy="440" r="43" />
            <circle cx="408" cy="440" r="43" />
            <circle cx="270" cy="205" r="160" />
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

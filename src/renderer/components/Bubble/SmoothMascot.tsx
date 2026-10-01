import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Smooth mascot ───────────────────────────────────────────────────────────
// An original, hand-drawn stage dancer in the spirit of a certain moonwalking
// pop legend: a slim black jacket over a white shirt, a black fedora whose brim
// shadows the whole upper face (no facial features beyond a jaw line: this is a
// costume silhouette, never a likeness), ONE white glove with a silver glint,
// and high-water trousers over white socks and black loafers. Each AgentState
// drives a pose:
//
//   idle         → the impossible forward lean, hat tipped over the eyes,
//                  slow breathing, drifting "zzz"
//   idle-active  → upright sway; every few seconds a hat tip, then a
//                  toe-stand with a glove sparkle
//   working      → moonwalk one way, spin, toe-stand freeze, moonwalk back
//   waiting      → "need input" sign rises, foot-tap, brim down, the other
//                  hand taps the gloved wrist (an invisible watch)
//   error        → zombie shuffle: arms out stiff, stiff sway, green tint,
//                  the glove sparkle fizzles out, X-eyes, ⚠ badge
//
// The rig shares Merc/Sensei's coordinate space and prop geometry (pillow,
// zzz, sign, badge all sit where theirs do), so it drops into the same window
// footprint in MASCOT_GEOMETRY without retuning. Unlike Sensei's leg stubs,
// the legs here hang from a hip pivot ABOVE the base line so they can slide
// and rock independently of the torso (that is the moonwalk). Every animated
// part pivots at its own local origin: either wrapped in a static
// `<g transform="translate(x y)">` with the inner group animated via
// `transformOrigin: '0px 0px'` (arms, legs, sparkles), or tweened with an
// explicit `svgOrigin` (body, head, hat) — never a bare rotation on an
// authored transform, which GSAP's revert() would fail to unwind cleanly (see
// mascotRig.ts).
//
// All animation lives in a `gsap.context` scoped to the component's root and
// reverted on every state change; `resetMascotRig` puts the authored
// transforms back first.

interface SmoothMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Merc/Sensei: character spans x ≈ 90..450, y ≈ 20..590
// (base line y 590). Headroom above (y -200..0) holds the sign, zzz and badge.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const EYES_C = '270 205'; // centre between the two glints
const FOOT_C = '270 590'; // loafer soles (squash / hop / lean pivot)
const HEAD_C = '270 370'; // where the head meets the torso (head tilt pivot)
const HAT_R = '390 165';  // right edge of the brim (a tip dips the front/left)

const BLACK = '#1c1c1e';
const RIM = '#5a5a5e';      // light rim so the suit reads on dark glass
const WHITE = '#fafafa';
const SKIN = '#d9a980';
const SILVER = '#e6e9f0';
const ZOMBIE = '#3aa655';
const SHADOW = '#0b0b0c';

// Slim jacket: shoulders at y 330, straight flanks 160..380, hem at y 500
// (the legs hang below it from the hips).
const TORSO_D = 'M160 400 C160 345 210 330 270 330 C330 330 380 345 380 400 L380 500 L160 500 Z';
// Trouser leg: hangs from the hip (local origin) down to the sock line.
const LEG_D = 'M-28 0 L28 0 L28 62 L-28 62 Z';
// Loafer: flat sole on the base line, rounded toe pointing screen-right.
const SHOE_D = 'M-30 78 L30 78 C46 78 52 84 52 90 L-30 90 Z';
// A 4-point silver glint, centred at its own local origin.
const GLINT_D = 'M0,-14 L4,-4 L14,0 L4,4 L0,14 L-4,4 L-14,0 L-4,-4 Z';

export const SmoothMascot: React.FC<SmoothMascotProps> = ({ state, width }) => {
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

      // Glove glints blinking out of phase, used by several poses.
      const twinkle = () => {
        ['#glint-1', '#glint-2', '#glint-3'].forEach((id, i) => {
          gsap.fromTo(id, { opacity: 0.2, scale: 0.6 }, { opacity: 1, scale: 1.1, ...LOCAL, duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: i * 0.3 });
        });
      };

      // ── idle → THE LEAN ─────────────────────────────────────────────────
      const playSleep = () => {
        gsap.timeline()
          .to('#char', { rotation: -28, svgOrigin: FOOT_C, duration: 1.0, ease: 'power2.inOut' })
          .to('#hat', { rotation: -12, y: 22, svgOrigin: HAT_R, duration: 0.5, ease: 'power2.out' }, '-=0.5')
          .to('#eyes', { scaleY: 0.15, svgOrigin: EYES_C, duration: 0.4, ease: 'power2.out' }, '<')
          .add(() => {
            // slow breathing from the soles
            gsap.to('#body', { scaleY: 1.03, svgOrigin: FOOT_C, duration: 2.0, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '350 -60' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 45, y: -80, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → SWAY + hat-tip / toe-stand tic ────────────────────
      const playNeutral = () => {
        gsap.fromTo('#body', { rotation: -2, svgOrigin: FOOT_C }, { rotation: 2, svgOrigin: FOOT_C, duration: 1.6, ease: 'sine.inOut', repeat: -1, yoyo: true });
        gsap.timeline({ repeat: -1, repeatDelay: 4.2, delay: 1.0 })
          // hat tip: the gloved hand comes up, the hat lifts and dips
          .to('#arm-r', { rotation: -150, ...LOCAL, duration: 0.25, ease: 'power2.out' })
          .to('#hat', { rotation: -18, y: -14, svgOrigin: HAT_R, duration: 0.2, ease: 'power2.out' }, '-=0.1')
          .to({}, { duration: 0.35 })
          .to('#hat', { rotation: 0, y: 0, svgOrigin: HAT_R, duration: 0.2, ease: 'power2.in' })
          .to('#arm-r', { rotation: 0, ...LOCAL, duration: 0.25, ease: 'power2.in' }, '<')
          // toe-stand: up on the toes, legs stretch from the hips
          .to('#char', { y: -12, duration: 0.18, ease: 'power2.out' })
          .to('#leg-l, #leg-r', { scaleY: 1.1, ...LOCAL, duration: 0.18, ease: 'power2.out' }, '<')
          .to('#glints', { opacity: 1, duration: 0.1 }, '<')
          .to({}, { duration: 0.45 })
          .to('#char', { y: 0, duration: 0.15, ease: 'power2.in' })
          .to('#leg-l, #leg-r', { scaleY: 1, ...LOCAL, duration: 0.15, ease: 'power2.in' }, '<')
          .to('#glints', { opacity: 0.35, duration: 0.3 });
      };

      // ── working → MOONWALK, spin, freeze, moonwalk back ─────────────────
      const playRun = () => {
        gsap.to('#spot', { opacity: 1, duration: 0.4 });
        gsap.set('#glints', { opacity: 1 });
        twinkle();

        const tl = gsap.timeline({ repeat: -1 });

        // One moonwalk glide: the body drifts `dir`-ward while the back foot
        // slides the OTHER way flat and snaps under, and the front foot rocks
        // on its toe. Arms swing opposite to the legs.
        const glide = (dir: 1 | -1) => {
          tl.fromTo('#char', { x: -40 * dir }, { x: 40 * dir, duration: 1.2, ease: 'none' });
          for (let i = 0; i < 2; i++) {
            const back = i % 2 === 0 ? '#leg-l' : '#leg-r';
            const front = i % 2 === 0 ? '#leg-r' : '#leg-l';
            tl.to(back, { x: -26 * dir, ...LOCAL, duration: 0.42, ease: 'none' }, i === 0 ? '<' : '>')
              .to(front, { rotation: -10 * dir, y: -6, ...LOCAL, duration: 0.42, ease: 'sine.inOut' }, '<')
              .to('#arm-l', { rotation: 22 * dir, ...LOCAL, duration: 0.42, ease: 'sine.inOut' }, '<')
              .to('#arm-r', { rotation: -22 * dir, ...LOCAL, duration: 0.42, ease: 'sine.inOut' }, '<')
              .to(back, { x: 0, ...LOCAL, duration: 0.18, ease: 'power3.out' })
              .to(front, { rotation: 0, y: 0, ...LOCAL, duration: 0.18, ease: 'power2.out' }, '<');
          }
        };

        glide(-1);

        // Spin about the middle, hat held on.
        tl.to('#arm-r', { rotation: -150, ...LOCAL, duration: 0.15, ease: 'power2.out' })
          .to('#char', { rotation: 360, svgOrigin: '270 300', duration: 0.55, ease: 'power1.inOut' })
          .set('#char', { rotation: 0 })
          .to('#arm-r', { rotation: 0, ...LOCAL, duration: 0.15, ease: 'power2.in' });

        // Toe-stand freeze, arms out.
        tl.to('#char', { y: -14, duration: 0.15, ease: 'power2.out' })
          .to('#leg-l, #leg-r', { scaleY: 1.12, ...LOCAL, duration: 0.15, ease: 'power2.out' }, '<')
          .to('#arm-l', { rotation: -95, ...LOCAL, duration: 0.15, ease: 'power2.out' }, '<')
          .to('#arm-r', { rotation: 95, ...LOCAL, duration: 0.15, ease: 'power2.out' }, '<')
          .to({}, { duration: 0.4 })
          .to('#char', { y: 0, duration: 0.15, ease: 'power2.in' })
          .to('#leg-l, #leg-r', { scaleY: 1, ...LOCAL, duration: 0.15, ease: 'power2.in' }, '<')
          .to('#arm-l, #arm-r', { rotation: 0, ...LOCAL, duration: 0.2, ease: 'power2.in' }, '<');

        glide(1);

        // Spin back the other way and a beat before the loop.
        tl.to('#char', { rotation: -360, svgOrigin: '270 300', duration: 0.55, ease: 'power1.inOut' })
          .set('#char', { rotation: 0, x: 0 })
          .to({}, { duration: 0.3 });
      };

      // ── waiting → NEED INPUT (sign rises, foot-tap, watch-tap) ──────────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .to('#hat', { rotation: 8, svgOrigin: '150 165', duration: 0.3, ease: 'power2.out' }, '-=0.3') // brim down
          .to('#arm-r', { rotation: -55, ...LOCAL, duration: 0.3, ease: 'power2.out' }, '<') // glove to the middle
          .to('#arm-l', { rotation: 58, ...LOCAL, duration: 0.3, ease: 'power2.out' }, '<') // other hand crosses to it
          .to('#eyes', { x: 10, y: -6, duration: 0.3, ease: 'power2.out' }, '<') // glance at the sign
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // impatient foot-tap
            gsap.to('#leg-r', { y: -10, ...LOCAL, duration: 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // tapping the gloved wrist
            gsap.to('#arm-l', { rotation: 66, ...LOCAL, duration: 0.25, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      // ── error → ZOMBIE SHUFFLE: arms out, green tint, glints die, ⚠ ─────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap glints → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .to('#arm-l, #arm-r', { rotation: -90, ...LOCAL, duration: 0.5, ease: 'power2.out' }, '-=0.3') // both arms out, stiff
          .to('#head', { rotation: 8, svgOrigin: HEAD_C, duration: 0.5, ease: 'power2.out' }, '<')
          .add(() => {
            // stiff shuffle: alternating hip tilt with a foot lifting each step
            gsap.fromTo('#body', { rotation: -4, svgOrigin: FOOT_C }, { rotation: 4, svgOrigin: FOOT_C, duration: 0.55, ease: 'power1.inOut', repeat: -1, yoyo: true });
            gsap.fromTo('#leg-l', { y: 0 }, { y: -8, ...LOCAL, duration: 0.55, ease: 'power1.inOut', repeat: -1, yoyo: true });
            gsap.fromTo('#leg-r', { y: -8 }, { y: 0, ...LOCAL, duration: 0.55, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // the suit goes graveyard green in a slow pulse
            gsap.to('#zombie-tint', { opacity: 0.4, duration: 0.6, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // the glove sparkle flickers and dies
            gsap.timeline()
              .to('#glints', { opacity: 0, duration: 0.08, repeat: 7, yoyo: true })
              .set('#glints', { opacity: 0 });
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

      {/* pillow prop kept for footprint parity with the other rigs (unused: he leans) */}
      <rect id="pillow" x="0" y="500" width="230" height="95" rx="44" fill="#ECE6DA" opacity="0" />

      {/* stage spotlight under the feet, only in the working pose */}
      <ellipse id="spot" cx="270" cy="592" rx="230" ry="26" fill={WHITE} opacity="0" />

      <g id="char">
        <g id="body">
          {/* legs: trousers hang from the hips, white socks, black loafers */}
          <g transform="translate(215 500)">
            <g id="leg-l">
              <path d={LEG_D} fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-26" y="60" width="52" height="20" fill={WHITE} />
              <path d={SHOE_D} fill={SHADOW} />
            </g>
          </g>
          <g transform="translate(325 500)">
            <g id="leg-r">
              <path d={LEG_D} fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-26" y="60" width="52" height="20" fill={WHITE} />
              <path d={SHOE_D} fill={SHADOW} />
            </g>
          </g>

          {/* jacket over a white shirt V and a thin tie */}
          <path d={TORSO_D} fill={BLACK} stroke={RIM} strokeWidth="6" />
          <path d="M236 334 L304 334 L270 430 Z" fill={WHITE} />
          <rect x="265" y="340" width="10" height="82" rx="4" fill={SHADOW} />

          {/* arms, wrapped in a static translate at each shoulder; the right
              hand is THE glove */}
          <g transform="translate(162 430)">
            <g id="arm-l">
              <rect x="-20" y="-10" width="40" height="112" rx="20" fill={BLACK} stroke={RIM} strokeWidth="5" />
              <circle cx="0" cy="112" r="22" fill={SKIN} />
            </g>
          </g>
          <g transform="translate(378 430)">
            <g id="arm-r">
              <rect x="-20" y="-10" width="40" height="112" rx="20" fill={BLACK} stroke={RIM} strokeWidth="5" />
              <circle id="glove" cx="0" cy="112" r="25" fill={WHITE} />
            </g>
          </g>

          <g id="head">
            {/* face: skin, with the brim shadow over everything above the jaw */}
            <ellipse cx="270" cy="230" rx="128" ry="142" fill={SKIN} />
            <circle cx="150" cy="235" r="30" fill={SHADOW} />
            <circle cx="390" cy="235" r="30" fill={SHADOW} />
            <ellipse cx="270" cy="212" rx="128" ry="64" fill={SHADOW} opacity="0.92" />

            {/* the fedora: brim + dented crown, pivots at the right brim edge */}
            <g id="hat">
              <ellipse cx="270" cy="165" rx="222" ry="38" fill={BLACK} stroke={RIM} strokeWidth="6" />
              <path d="M150 168 L160 60 C160 36 200 30 270 30 C340 30 380 36 380 60 L390 168 Z" fill={BLACK} stroke={RIM} strokeWidth="6" strokeLinejoin="round" />
              <path d="M170 62 C220 48 320 48 370 62" stroke={RIM} strokeWidth="6" strokeLinecap="round" fill="none" />
              <rect x="158" y="120" width="224" height="26" fill={SHADOW} />
            </g>

            {/* two glints under the brim stand in for eyes */}
            <g id="eyes" fill={WHITE}>
              <ellipse cx="214" cy="205" rx="16" ry="10" />
              <ellipse cx="326" cy="205" rx="16" ry="10" />
            </g>
            {/* X eyes for the error state (shown while #eyes is hidden) */}
            <g id="eyes-x" opacity="0" stroke={WHITE} strokeWidth="9" strokeLinecap="round">
              <line x1="196" y1="189" x2="232" y2="221" />
              <line x1="232" y1="189" x2="196" y2="221" />
              <line x1="308" y1="189" x2="344" y2="221" />
              <line x1="344" y1="189" x2="308" y2="221" />
            </g>
          </g>

          {/* silver glints around the glove, each pivoting at its own centre */}
          <g id="glints" opacity="0.35" fill={SILVER}>
            <g transform="translate(424 518)"><g id="glint-1"><path d={GLINT_D} /></g></g>
            <g transform="translate(344 566)"><g id="glint-2"><path d={GLINT_D} transform="scale(0.7)" /></g></g>
            <g transform="translate(418 588)"><g id="glint-3"><path d={GLINT_D} transform="scale(0.8)" /></g></g>
          </g>

          {/* green overlay for the zombie error pose (same silhouette) */}
          <g id="zombie-tint" fill={ZOMBIE} opacity="0">
            <path d={TORSO_D} />
            <rect x="142" y="420" width="40" height="112" rx="20" />
            <rect x="358" y="420" width="40" height="112" rx="20" />
            <ellipse cx="270" cy="230" rx="128" ry="142" />
            <ellipse cx="270" cy="165" rx="222" ry="38" />
            <path d="M150 168 L160 60 C160 36 200 30 270 30 C340 30 380 36 380 60 L390 168 Z" />
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

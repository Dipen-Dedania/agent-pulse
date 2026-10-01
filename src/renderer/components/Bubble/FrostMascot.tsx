import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Frost mascot ────────────────────────────────────────────────────────────
// An original, hand-drawn hooded ninja in the spirit of a certain ice-blasting
// tournament fighter: a black hood and suit with an ice-cyan cowl band, tabard
// and face mask, steel forearm and shin guards, and glowing cyan eye slits.
// Each AgentState drives a pose:
//
//   idle         → sits cross-legged, arms folded, slits closed, frost mist
//                  pooling at his feet, drifting "zzz"
//   idle-active  → breathing; every few seconds a cold breath puff drifts up
//                  from the mask and one slit narrows
//   working      → a bug scurries in; an ice bolt freezes it mid-stride and
//                  it bursts; two slide-kick laps; loop
//   waiting      → "need input" sign rises, arms fold, breath puffs, foot-tap
//   error        → freezes solid inside an ice block, shatters into shards,
//                  pops back with a squash; X-eyes, ⚠ badge
//
// The rig shares Merc/Sensei's coordinate space and prop geometry (pillow,
// zzz, sign, badge all sit where theirs do), so it drops into the same window
// footprint in MASCOT_GEOMETRY without retuning. Legs hang from a hip pivot
// above the base line (like Smooth) so they can fold and kick. Every animated
// part pivots at its own local origin: either wrapped in a static
// `<g transform="translate(x y)">` with the inner group animated via
// `transformOrigin: '0px 0px'` (arms, legs, bolt, bug, shards), or tweened
// with an explicit `svgOrigin` (body, head) — never a bare rotation on an
// authored transform, which GSAP's revert() would fail to unwind cleanly (see
// mascotRig.ts).
//
// All animation lives in a `gsap.context` scoped to the component's root and
// reverted on every state change; `resetMascotRig` puts the authored
// transforms back first.

interface FrostMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Merc/Sensei: character spans x ≈ 90..450, y ≈ 20..590
// (base line y 590). Headroom above (y -200..0) holds the sign, zzz and badge.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const EYES_C = '270 210'; // centre between the two slits
const FOOT_C = '270 590'; // soles (squash / hop / rock pivot)
const HEAD_C = '270 370'; // where the head meets the torso (head tilt pivot)

const BLACK = '#111111';
const RIM = '#3d3d42';      // light rim so the black suit reads on dark glass
const ICE = '#8be0ff';
const ICE_DEEP = '#3fb6e8';
const STEEL = '#9fb3c8';
const WHITE = '#ffffff';
const FIST = '#2e2e2e';
const BUG = '#5a3d2b';

// Torso: shoulders at y 330, straight flanks 130..410, hem at y 500 (legs
// hang below it from the hips).
const TORSO_D = 'M130 400 C130 340 190 330 270 330 C350 330 410 340 410 400 L410 500 L130 500 Z';
// Trouser leg hanging from the hip (local origin) with a flat foot on the base.
const LEG_D = 'M-30 0 L30 0 L30 78 L-30 78 Z';
const FOOT_D = 'M-34 78 L34 78 C46 78 50 84 50 90 L-34 90 Z';
// Face mask: covers the lower half of the hood.
const MASK_D = 'M120 238 Q270 252 420 238 L404 302 Q270 362 136 302 Z';
// Ice bolt, pointing screen-right from its local origin.
const BOLT_D = 'M0 -13 L42 -5 L66 0 L42 5 L0 13 L12 0 Z';
// A shard: a tall triangle centred on its own origin.
const SHARD_D = 'M0 -30 L26 15 L-26 15 Z';

// Eight shard directions around the body centre for the shatter.
const SHARDS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  return { id: `shard-${i}`, cx: 270 + Math.cos(a) * 70, cy: 330 + Math.sin(a) * 110, dx: Math.cos(a) * 150, dy: Math.sin(a) * 150, rot: (i % 2 ? -1 : 1) * 140 };
});

export const FrostMascot: React.FC<FrostMascotProps> = ({ state, width }) => {
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

      // A cold breath: a puff drifts up-right from the mask and fades.
      const breath = (repeatDelay: number, delay = 0.8) =>
        gsap.timeline({ repeat: -1, repeatDelay, delay })
          .fromTo('#breath', { opacity: 0, x: 0, y: 0, scale: 0.5 }, { opacity: 0.85, x: 50, y: -50, scale: 1.2, ...LOCAL, duration: 1.1, ease: 'sine.out' })
          .to('#breath', { opacity: 0, duration: 0.4 }, '-=0.3');

      // ── idle → SITS CROSS-LEGGED ────────────────────────────────────────
      const playSleep = () => {
        gsap.timeline()
          .to('#char', { y: 46, duration: 0.8, ease: 'power2.inOut' })
          .to('#leg-l', { rotation: -72, ...LOCAL, duration: 0.8, ease: 'power2.inOut' }, '<')
          .to('#leg-r', { rotation: 72, ...LOCAL, duration: 0.8, ease: 'power2.inOut' }, '<')
          .to('#arm-l', { rotation: 72, ...LOCAL, duration: 0.6, ease: 'power2.out' }, '-=0.5')
          .to('#arm-r', { rotation: -72, ...LOCAL, duration: 0.6, ease: 'power2.out' }, '<')
          .to('#head', { rotation: 6, svgOrigin: HEAD_C, duration: 0.6, ease: 'power2.out' }, '<')
          .to('#eyes', { scaleY: 0.15, svgOrigin: EYES_C, duration: 0.4, ease: 'power2.out' }, '<')
          .to('#mist', { opacity: 1, duration: 0.8 }, '<')
          .add(() => {
            // slow breathing from the base
            gsap.to('#body', { scaleY: 1.03, svgOrigin: FOOT_C, duration: 2.0, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // the mist drifts
            gsap.to('#mist', { x: 16, duration: 2.6, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '350 -60' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 45, y: -80, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → NEUTRAL + cold-breath tic ─────────────────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        breath(4.8, 1.2);
        gsap.timeline({ repeat: -1, repeatDelay: 4.8, delay: 1.4 })
          .to('#eye-r', { scaleY: 0.4, svgOrigin: '326 210', duration: 0.15, ease: 'power1.inOut' })
          .to({}, { duration: 0.6 })
          .to('#eye-r', { scaleY: 1, svgOrigin: '326 210', duration: 0.15, ease: 'power1.inOut' });
      };

      // ── working → FREEZE THE BUG, slide kicks ───────────────────────────
      const playRun = () => {
        const tl = gsap.timeline({ repeat: -1 });

        // The bug scurries in from the right, legs wiggling.
        tl.set('#bug', { opacity: 1, x: 0, scale: 1 })
          .set('#bug-ice', { opacity: 0 })
          .to('#bug', { x: -110, ...LOCAL, duration: 0.6, ease: 'none' })
          .to('#bug-legs', { rotation: 12, ...LOCAL, duration: 0.08, repeat: 7, yoyo: true, ease: 'none' }, '<');

        // Arm thrust and the bolt flies; the bug freezes mid-stride.
        tl.to('#arm-r', { rotation: -95, ...LOCAL, duration: 0.12, ease: 'power3.out' }, '-=0.1')
          .to('#char', { x: 16, rotation: 5, svgOrigin: FOOT_C, duration: 0.12, ease: 'power2.out' }, '<')
          .set('#bolt', { opacity: 1, x: 0 })
          .to('#bolt', { x: 200, ...LOCAL, duration: 0.18, ease: 'none' })
          .set('#bolt', { opacity: 0 })
          .to('#bug-ice', { opacity: 0.9, duration: 0.1 })
          .to({}, { duration: 0.35 })
          // burst
          .to('#bug', { scale: 1.35, ...LOCAL, duration: 0.1, ease: 'power2.out' })
          .to('#bug', { opacity: 0, duration: 0.12 })
          .to('#arm-r', { rotation: 0, ...LOCAL, duration: 0.25, ease: 'power2.inOut' }, '-=0.1')
          .to('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C, duration: 0.25, ease: 'power2.inOut' }, '<');

        // Two slide-kick laps: leg extends, body leans and slides that way.
        tl.to('#leg-r', { rotation: -85, ...LOCAL, duration: 0.2, ease: 'power3.out' })
          .to('#char', { x: 44, rotation: 10, y: 10, svgOrigin: FOOT_C, duration: 0.3, ease: 'power2.out' }, '<')
          .to('#leg-r', { rotation: 0, ...LOCAL, duration: 0.25, ease: 'power2.in' })
          .to('#char', { x: 0, rotation: 0, y: 0, svgOrigin: FOOT_C, duration: 0.25, ease: 'power2.in' }, '<')
          .to('#leg-l', { rotation: 85, ...LOCAL, duration: 0.2, ease: 'power3.out' })
          .to('#char', { x: -44, rotation: -10, y: 10, svgOrigin: FOOT_C, duration: 0.3, ease: 'power2.out' }, '<')
          .to('#leg-l', { rotation: 0, ...LOCAL, duration: 0.25, ease: 'power2.in' })
          .to('#char', { x: 0, rotation: 0, y: 0, svgOrigin: FOOT_C, duration: 0.25, ease: 'power2.in' }, '<')
          .to({}, { duration: 0.35 });
      };

      // ── waiting → NEED INPUT (sign rises, arms fold, breath, foot-tap) ──
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .to('#arm-l', { rotation: 72, ...LOCAL, duration: 0.3, ease: 'power2.out' }, '-=0.3')
          .to('#arm-r', { rotation: -72, ...LOCAL, duration: 0.3, ease: 'power2.out' }, '<')
          .to('#eye-l', { scaleY: 0.5, svgOrigin: '214 210', duration: 0.3, ease: 'power2.out' }, '<')
          .to('#eyes', { x: 10, y: -6, duration: 0.3, ease: 'power2.out' }, '<') // glance at the sign
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // impatient foot-tap
            gsap.to('#leg-r', { y: -10, ...LOCAL, duration: 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true });
            breath(1.2, 0.4);
          });
      };

      // ── error → FREEZE SOLID AND SHATTER ────────────────────────────────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap slits → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' });
        gsap.to('#alert', { scale: 1.15, svgOrigin: '270 -60', duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true, delay: 0.4 });

        const tl = gsap.timeline({ repeat: -1, delay: 0.3 });
        // ice creeps over him, he shudders, then holds solid
        tl.to('#ice-block', { opacity: 0.62, duration: 0.3, ease: 'power2.out' })
          .to('#body', { x: 5, duration: 0.05, repeat: 5, yoyo: true, ease: 'none' }, '<')
          .to({}, { duration: 0.45 });
        // shatter: body and block vanish, shards fly out and fade
        tl.set('#body', { opacity: 0 })
          .set('#ice-block', { opacity: 0 })
          .set('#shards', { opacity: 1 });
        SHARDS.forEach((s) => {
          tl.fromTo(`#${s.id}`, { x: 0, y: 0, rotation: 0, opacity: 1 }, { x: s.dx, y: s.dy, rotation: s.rot, opacity: 0, ...LOCAL, duration: 0.5, ease: 'power2.out' }, '<');
        });
        tl.to({}, { duration: 0.45 });
        // pop back with a squash, a one-beat red flash so the state reads
        tl.set('#body', { opacity: 1, scaleY: 0.85, scaleX: 1.12, svgOrigin: FOOT_C })
          .to('#body', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.25, ease: 'back.out(2)' })
          .to('#red-tint', { opacity: 0.45, duration: 0.08, yoyo: true, repeat: 1 }, '<')
          .to({}, { duration: 0.6 });
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

      {/* pillow prop kept for footprint parity with the other rigs (unused: he sits) */}
      <rect id="pillow" x="0" y="500" width="230" height="95" rx="44" fill="#ECE6DA" opacity="0" />

      {/* frost mist pooling at the feet (idle) */}
      <g id="mist" opacity="0" fill={WHITE}>
        <ellipse cx="170" cy="586" rx="70" ry="14" opacity="0.45" />
        <ellipse cx="290" cy="590" rx="90" ry="16" opacity="0.35" />
        <ellipse cx="400" cy="584" rx="60" ry="12" opacity="0.45" />
      </g>

      <g id="char">
        <g id="body">
          {/* legs: hang from the hips, steel shin guards, flat feet */}
          <g transform="translate(190 500)">
            <g id="leg-l">
              <path d={LEG_D} fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-24" y="34" width="48" height="36" rx="8" fill={STEEL} />
              <path d={FOOT_D} fill={BLACK} />
            </g>
          </g>
          <g transform="translate(350 500)">
            <g id="leg-r">
              <path d={LEG_D} fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-24" y="34" width="48" height="36" rx="8" fill={STEEL} />
              <path d={FOOT_D} fill={BLACK} />
            </g>
          </g>

          {/* torso with the ice tabard and a belt */}
          <path d={TORSO_D} fill={BLACK} stroke={RIM} strokeWidth="6" />
          <rect x="200" y="338" width="140" height="162" rx="18" fill={ICE} />
          <rect x="130" y="452" width="280" height="24" fill={FIST} />
          <rect x="250" y="446" width="40" height="36" rx="6" fill={STEEL} />

          {/* arms, wrapped in a static translate at each shoulder; the right
              fist also carries the ice bolt */}
          <g transform="translate(132 430)">
            <g id="arm-l">
              <rect x="-20" y="-10" width="40" height="104" rx="20" fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-22" y="36" width="44" height="34" rx="8" fill={STEEL} />
              <circle cx="0" cy="104" r="22" fill={FIST} />
            </g>
          </g>
          <g transform="translate(408 430)">
            <g id="arm-r">
              <rect x="-20" y="-10" width="40" height="104" rx="20" fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-22" y="36" width="44" height="34" rx="8" fill={STEEL} />
              <circle cx="0" cy="104" r="22" fill={FIST} />
              <g transform="translate(0 104)">
                <g id="bolt" opacity="0">
                  <path d={BOLT_D} fill={ICE} />
                  <path d="M6 -4 L40 -1 L40 1 L6 4 Z" fill={WHITE} />
                </g>
              </g>
            </g>
          </g>

          <g id="head">
            {/* hood with a peak, cowl band across the brow, mask over the jaw */}
            <path d="M234 62 L270 18 L306 62 Z" fill={BLACK} stroke={RIM} strokeWidth="6" strokeLinejoin="round" />
            <circle cx="270" cy="210" r="160" fill={BLACK} stroke={RIM} strokeWidth="6" />
            <rect x="122" y="150" width="296" height="34" rx="12" fill={ICE} />
            <path d={MASK_D} fill={ICE} />
            <g stroke={ICE_DEEP} strokeWidth="6" strokeLinecap="round">
              <line x1="225" y1="278" x2="225" y2="310" />
              <line x1="255" y1="284" x2="255" y2="318" />
              <line x1="285" y1="284" x2="285" y2="318" />
              <line x1="315" y1="278" x2="315" y2="310" />
            </g>

            {/* glowing eye slits */}
            <g id="eyes">
              <g id="eye-l">
                <rect x="190" y="200" width="48" height="20" rx="10" fill={ICE} />
                <rect x="200" y="207" width="28" height="6" rx="3" fill={WHITE} />
              </g>
              <g id="eye-r">
                <rect x="302" y="200" width="48" height="20" rx="10" fill={ICE} />
                <rect x="312" y="207" width="28" height="6" rx="3" fill={WHITE} />
              </g>
            </g>
            {/* X eyes for the error state (shown while #eyes is hidden) */}
            <g id="eyes-x" opacity="0" stroke={ICE} strokeWidth="9" strokeLinecap="round">
              <line x1="196" y1="192" x2="232" y2="228" />
              <line x1="232" y1="192" x2="196" y2="228" />
              <line x1="308" y1="192" x2="344" y2="228" />
              <line x1="344" y1="192" x2="308" y2="228" />
            </g>

            {/* cold breath puff, drifts up from the mask */}
            <ellipse id="breath" cx="330" cy="300" rx="22" ry="13" fill={WHITE} opacity="0" />
          </g>

          {/* red overlay for the one-beat flash after each shatter */}
          <g id="red-tint" fill="#E5484D" opacity="0">
            <path d={TORSO_D} />
            <circle cx="270" cy="210" r="160" />
          </g>
        </g>

        {/* the ice block that encases him in the error pose */}
        <rect id="ice-block" x="96" y="6" width="348" height="590" rx="60" fill={ICE} stroke={WHITE} strokeWidth="8" opacity="0" />

        {/* shards for the shatter, each in its own wrapper around the body centre */}
        <g id="shards" opacity="0" fill={ICE} stroke={WHITE} strokeWidth="4" strokeLinejoin="round">
          {SHARDS.map((s) => (
            <g key={s.id} transform={`translate(${s.cx.toFixed(1)} ${s.cy.toFixed(1)})`}>
              <g id={s.id}><path d={SHARD_D} /></g>
            </g>
          ))}
        </g>

        {/* the target bug (working): scurries in from the right, then freezes */}
        <g transform="translate(560 572)">
          <g id="bug" opacity="0">
            <g id="bug-legs" stroke={BUG} strokeWidth="5" strokeLinecap="round">
              <line x1="-14" y1="0" x2="-26" y2="16" />
              <line x1="0" y1="2" x2="0" y2="18" />
              <line x1="14" y1="0" x2="26" y2="16" />
              <line x1="-14" y1="-2" x2="-28" y2="-14" />
              <line x1="14" y1="-2" x2="28" y2="-14" />
            </g>
            <ellipse cx="0" cy="0" rx="24" ry="14" fill={BUG} />
            <circle cx="-26" cy="-2" r="9" fill={BUG} />
            <ellipse id="bug-ice" cx="-4" cy="-1" rx="36" ry="22" fill={ICE} stroke={WHITE} strokeWidth="3" opacity="0" />
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

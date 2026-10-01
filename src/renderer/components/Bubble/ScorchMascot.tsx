import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Scorch mascot ───────────────────────────────────────────────────────────
// An original, hand-drawn hooded ninja in the spirit of a certain
// spear-throwing, hell-fire tournament fighter: a black hood and suit with a
// gold cowl band, tabard and face mask, dark-gold forearm and shin guards,
// blank white eyes, and a rope spear (a kunai on a line) held in the right
// fist. Each AgentState drives a pose:
//
//   idle         → slumped onto a pillow, eyes shut, drifting "zzz"
//   idle-active  → breathing; every few seconds the spear rope twitches and
//                  the eyes flare
//   working      → spear throw, teleport punch (vanish in a flame puff,
//                  reappear on the other side), low spin; loop
//   waiting      → the spear hooks the "need input" sign off-screen and yanks
//                  it in; arms fold, rope twitches
//   error        → mask drops to reveal a skull, flames rise behind the head,
//                  red strobe, glitch shudder, X-eyes, ⚠ badge
//
// The rig shares Merc/Sensei's coordinate space and prop geometry (pillow,
// zzz, sign, badge all sit where theirs do), so it drops into the same window
// footprint in MASCOT_GEOMETRY without retuning. The sign's authored transform
// is never touched: the yank is a gsap `x` tween from +220 back to 0. Every
// animated part pivots at its own local origin: either wrapped in a static
// `<g transform="translate(x y)">` with the inner group animated via
// `transformOrigin: '0px 0px'` (arms, legs, rope, blade), or tweened with an
// explicit `svgOrigin` (body, head, flames) — never a bare rotation on an
// authored transform, which GSAP's revert() would fail to unwind cleanly (see
// mascotRig.ts).
//
// All animation lives in a `gsap.context` scoped to the component's root and
// reverted on every state change; `resetMascotRig` puts the authored
// transforms back first.

interface ScorchMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Merc/Sensei: character spans x ≈ 90..450, y ≈ 20..590
// (base line y 590). Headroom above (y -200..0) holds the sign, zzz, badge
// and the flames.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const EYES_C = '270 210'; // centre between the two eyes
const FOOT_C = '270 590'; // soles (squash / hop / rock pivot)
const HEAD_C = '270 370'; // where the head meets the torso (head tilt pivot)

const BLACK = '#111111';
const RIM = '#3d3d42';      // light rim so the black suit reads on dark glass
const GOLD = '#e3a51a';
const GOLD_DEEP = '#a86f0e';
const GUARD = '#c98a2b';
const WHITE = '#ffffff';
const FIST = '#2e2e2e';
const ROPE = '#c9b79a';
const FLAME = '#ff7a1a';
const FLAME_CORE = '#ffd54a';

// The sign is authored at pole x 470; the spear must reach it where it waits,
// 220 units further right, so the rope is drawn that long from the fist.
const FLAG_OFFSET = 220;
const ROPE_LEN = 470 + FLAG_OFFSET - 408;

// Torso: shoulders at y 330, straight flanks 130..410, hem at y 500 (legs
// hang below it from the hips).
const TORSO_D = 'M130 400 C130 340 190 330 270 330 C350 330 410 340 410 400 L410 500 L130 500 Z';
// Trouser leg hanging from the hip (local origin) with a flat foot on the base.
const LEG_D = 'M-30 0 L30 0 L30 78 L-30 78 Z';
const FOOT_D = 'M-34 78 L34 78 C46 78 50 84 50 90 L-34 90 Z';
// Face mask: covers the lower half of the hood.
const MASK_D = 'M120 238 Q270 252 420 238 L404 302 Q270 362 136 302 Z';
// Skull jaw revealed under the mask in the error pose.
const SKULL_D = 'M150 240 Q270 262 390 240 L378 298 Q270 346 162 298 Z';
// Kunai blade pointing screen-right from its local origin.
const BLADE_D = 'M0 -10 L36 -6 L58 0 L36 6 L0 10 Z';
// One flame tongue rising from its local origin.
const FLAME_D = 'M0 0 C-30 -40 -12 -80 0 -124 C12 -80 30 -40 0 0 Z';

export const ScorchMascot: React.FC<ScorchMascotProps> = ({ state, width }) => {
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

      // Spear out along the rope (to `len`) and back, from the right fist.
      const spearOut = (tl: gsap.core.Timeline, len: number, dur: number) =>
        tl.to('#rope', { scaleX: len / ROPE_LEN, ...LOCAL, duration: dur, ease: 'back.out(1.2)' })
          .to('#blade', { x: len, ...LOCAL, duration: dur, ease: 'back.out(1.2)' }, '<');
      const spearBack = (tl: gsap.core.Timeline, dur: number, pos: string | number = '>') =>
        tl.to('#rope', { scaleX: 0, ...LOCAL, duration: dur, ease: 'power3.in' }, pos)
          .to('#blade', { x: 0, ...LOCAL, duration: dur, ease: 'power3.in' }, '<');

      // The rope twitch tic shared by idle-active and waiting.
      const twitch = (repeatDelay: number, delay: number) =>
        gsap.timeline({ repeat: -1, repeatDelay, delay })
          .to('#spear', { rotation: -14, ...LOCAL, duration: 0.08, ease: 'power1.inOut' })
          .to('#spear', { rotation: 10, ...LOCAL, duration: 0.08, ease: 'power1.inOut' })
          .to('#spear', { rotation: 0, ...LOCAL, duration: 0.1, ease: 'power1.inOut' });

      // ── idle → SLEEP ────────────────────────────────────────────────────
      const playSleep = () => {
        gsap.to('#pillow', { opacity: 1, duration: 0.4 });
        gsap.timeline()
          .to('#char', { rotation: -14, x: -14, y: 14, svgOrigin: '150 590', duration: 0.9, ease: 'power2.inOut' })
          .to('#eyes', { scaleY: 0.12, svgOrigin: EYES_C, duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .add(() => {
            // slow breathing from the base
            gsap.to('#body', { scaleY: 1.04, svgOrigin: FOOT_C, duration: 1.9, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '350 -60' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 45, y: -80, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → NEUTRAL + rope twitch / eye flare tic ─────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        twitch(4.6, 1.2);
        gsap.timeline({ repeat: -1, repeatDelay: 4.6, delay: 1.3 })
          .to('#eye-glow', { opacity: 1, duration: 0.15, ease: 'power1.out' })
          .to({}, { duration: 0.5 })
          .to('#eye-glow', { opacity: 0, duration: 0.3, ease: 'power1.in' });
      };

      // ── working → SPEAR THROW, teleport punch, low spin ─────────────────
      const playRun = () => {
        const tl = gsap.timeline({ repeat: -1 });

        // Spear throw: arm points, rope shoots out, snaps back.
        tl.to('#arm-r', { rotation: -95, ...LOCAL, duration: 0.14, ease: 'power3.out' })
          .to('#char', { x: 14, rotation: 6, svgOrigin: FOOT_C, duration: 0.14, ease: 'power2.out' }, '<');
        spearOut(tl, 250, 0.15);
        tl.to({}, { duration: 0.1 });
        spearBack(tl, 0.15);
        tl.to('#arm-r', { rotation: 0, ...LOCAL, duration: 0.22, ease: 'power2.inOut' })
          .to('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C, duration: 0.22, ease: 'power2.inOut' }, '<');

        // Teleport: vanish in a puff, reappear leaning on the far side, punch,
        // vanish again, back to centre.
        const puff = () =>
          tl.fromTo('#puff', { opacity: 1, scale: 0.4 }, { opacity: 0, scale: 1.4, svgOrigin: '270 588', duration: 0.3, ease: 'power2.out' });
        puff();
        tl.set('#body', { opacity: 0 }, '<0.08')
          .set('#char', { x: -70, rotation: -8, svgOrigin: FOOT_C }, '>0.05')
          .set('#puff', { x: -70 })
          .set('#body', { opacity: 1 });
        puff();
        tl.to('#arm-l', { rotation: -105, ...LOCAL, duration: 0.12, ease: 'power3.in' }, '<')
          .to('#arm-l', { rotation: 0, ...LOCAL, duration: 0.2, ease: 'power2.out' });
        puff();
        tl.set('#body', { opacity: 0 }, '<0.08')
          .set('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C }, '>0.05')
          .set('#puff', { x: 0 })
          .set('#body', { opacity: 1 });
        puff();

        // Low spin: crouch and whip round, then a beat before the loop.
        tl.to('#char', { y: 26, duration: 0.15, ease: 'power2.out' }, '<')
          .to('#char', { rotation: 360, svgOrigin: '270 420', duration: 0.5, ease: 'power1.inOut' })
          .set('#char', { rotation: 0 })
          .to('#char', { y: 0, duration: 0.15, ease: 'power2.in' })
          .to({}, { duration: 0.4 });
      };

      // ── waiting → NEED INPUT (spear hauls the sign in, arms fold) ───────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, x: FLAG_OFFSET, y: 0 });
        const tl = gsap.timeline();
        tl.to('#flag', { opacity: 1, duration: 0.3 })
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.25, ease: 'power2.out' }, '<') // lean toward it
          .to('#arm-r', { rotation: -95, ...LOCAL, duration: 0.2, ease: 'power3.out' }, '<')
          .to('#eyes', { x: 10, y: -6, duration: 0.3, ease: 'power2.out' }, '<'); // glance at the sign
        spearOut(tl, ROPE_LEN, 0.2);
        tl.to({}, { duration: 0.12 });
        // the yank: sign and spear come back together
        tl.to('#flag', { x: 0, duration: 0.25, ease: 'power3.in' });
        spearBack(tl, 0.25, '<');
        tl.to('#flag', { rotation: -6, svgOrigin: '477 170', duration: 0.12, ease: 'power2.out' })
          .to('#arm-r', { rotation: -72, ...LOCAL, duration: 0.3, ease: 'power2.inOut' }, '<')
          .to('#arm-l', { rotation: 72, ...LOCAL, duration: 0.3, ease: 'power2.inOut' }, '<')
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // impatient foot-tap
            gsap.to('#leg-r', { y: -10, ...LOCAL, duration: 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true });
            twitch(1.6, 0.5);
          });
      };

      // ── error → MASK OFF, skull, flames, red strobe, glitch, ⚠ ──────────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap eyes → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.set('#flames', { opacity: 0, scaleY: 0.2, svgOrigin: '270 80' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .to('#mask', { opacity: 0, y: 40, duration: 0.25, ease: 'power2.in' }, '-=0.3') // mask drops
          .to('#skull', { opacity: 1, duration: 0.15 }, '<0.1')
          .to('#flames', { opacity: 1, scaleY: 1, svgOrigin: '270 80', duration: 0.35, ease: 'power2.out' }, '<')
          .add(() => {
            // flames flicker from their base
            gsap.to('#flames', { scaleY: 0.82, scaleX: 1.06, svgOrigin: '270 80', duration: 0.16, ease: 'sine.inOut', repeat: -1, yoyo: true });
            gsap.to('#flame-1, #flame-3, #flame-5', { rotation: 6, ...LOCAL, duration: 0.2, ease: 'sine.inOut', repeat: -1, yoyo: true });
            gsap.to('#flame-2, #flame-4', { rotation: -6, ...LOCAL, duration: 0.24, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // the suit strobes red
            gsap.to('#red-tint', { opacity: 0.45, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#char', { x: 7, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -5, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // head wobble
            gsap.fromTo('#head', { rotation: -6, svgOrigin: HEAD_C }, { rotation: 6, svgOrigin: HEAD_C, duration: 0.5, ease: 'sine.inOut', repeat: -1, yoyo: true });
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

      {/* teleport flame puff at the feet (working); moves with the character) */}
      <g id="puff" opacity="0" fill={FLAME}>
        <ellipse cx="270" cy="586" rx="120" ry="30" opacity="0.7" />
        <ellipse cx="230" cy="570" rx="50" ry="36" />
        <ellipse cx="310" cy="566" rx="56" ry="40" />
        <ellipse cx="270" cy="560" rx="40" ry="30" fill={FLAME_CORE} />
      </g>

      <g id="char">
        {/* flames rising behind the head (error) */}
        <g id="flames" opacity="0" fill={FLAME}>
          <g transform="translate(190 90)"><g id="flame-1"><path d={FLAME_D} transform="scale(0.8)" /></g></g>
          <g transform="translate(230 70)"><g id="flame-2"><path d={FLAME_D} /><path d={FLAME_D} transform="scale(0.45)" fill={FLAME_CORE} /></g></g>
          <g transform="translate(270 60)"><g id="flame-3"><path d={FLAME_D} transform="scale(1.2)" /><path d={FLAME_D} transform="scale(0.55)" fill={FLAME_CORE} /></g></g>
          <g transform="translate(310 70)"><g id="flame-4"><path d={FLAME_D} /><path d={FLAME_D} transform="scale(0.45)" fill={FLAME_CORE} /></g></g>
          <g transform="translate(350 90)"><g id="flame-5"><path d={FLAME_D} transform="scale(0.8)" /></g></g>
        </g>

        <g id="body">
          {/* legs: hang from the hips, gold shin guards, flat feet */}
          <g transform="translate(190 500)">
            <g id="leg-l">
              <path d={LEG_D} fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-24" y="34" width="48" height="36" rx="8" fill={GUARD} />
              <path d={FOOT_D} fill={BLACK} />
            </g>
          </g>
          <g transform="translate(350 500)">
            <g id="leg-r">
              <path d={LEG_D} fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-24" y="34" width="48" height="36" rx="8" fill={GUARD} />
              <path d={FOOT_D} fill={BLACK} />
            </g>
          </g>

          {/* torso with the gold tabard and a belt */}
          <path d={TORSO_D} fill={BLACK} stroke={RIM} strokeWidth="6" />
          <rect x="200" y="338" width="140" height="162" rx="18" fill={GOLD} />
          <rect x="130" y="452" width="280" height="24" fill={FIST} />
          <rect x="250" y="446" width="40" height="36" rx="6" fill={GUARD} />

          {/* arms, wrapped in a static translate at each shoulder; the right
              fist holds the rope spear */}
          <g transform="translate(132 430)">
            <g id="arm-l">
              <rect x="-20" y="-10" width="40" height="104" rx="20" fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-22" y="36" width="44" height="34" rx="8" fill={GUARD} />
              <circle cx="0" cy="104" r="22" fill={FIST} />
            </g>
          </g>
          <g transform="translate(408 430)">
            <g id="arm-r">
              <rect x="-20" y="-10" width="40" height="104" rx="20" fill={BLACK} stroke={RIM} strokeWidth="5" />
              <rect x="-22" y="36" width="44" height="34" rx="8" fill={GUARD} />
              <circle cx="0" cy="104" r="22" fill={FIST} />
              {/* the spear: a rope that stretches from the fist (authored at
                  zero length) and a kunai that rides its far end */}
              <g transform="translate(0 104)">
                <g id="spear">
                  <rect id="rope" x="0" y="-4" width={ROPE_LEN} height="8" rx="4" fill={ROPE} transform="scale(0 1)" />
                  <g id="blade">
                    <path d={BLADE_D} fill={GOLD} stroke={GOLD_DEEP} strokeWidth="3" strokeLinejoin="round" />
                    <circle cx="-6" cy="0" r="9" fill={GOLD_DEEP} />
                  </g>
                </g>
              </g>
            </g>
          </g>

          <g id="head">
            {/* hood with a peak, cowl band across the brow, mask over the jaw
                (the skull sits under it, hidden until the error pose) */}
            <path d="M234 62 L270 18 L306 62 Z" fill={BLACK} stroke={RIM} strokeWidth="6" strokeLinejoin="round" />
            <circle cx="270" cy="210" r="160" fill={BLACK} stroke={RIM} strokeWidth="6" />
            <rect x="122" y="150" width="296" height="34" rx="12" fill={GOLD} />
            <g id="skull" opacity="0">
              <path d={SKULL_D} fill={WHITE} />
              <g fill={BLACK}>
                <rect x="222" y="262" width="14" height="30" rx="3" />
                <rect x="248" y="266" width="14" height="34" rx="3" />
                <rect x="278" y="266" width="14" height="34" rx="3" />
                <rect x="304" y="262" width="14" height="30" rx="3" />
              </g>
            </g>
            <g id="mask">
              <path d={MASK_D} fill={GOLD} />
              <g stroke={GOLD_DEEP} strokeWidth="6" strokeLinecap="round">
                <line x1="225" y1="278" x2="225" y2="310" />
                <line x1="255" y1="284" x2="255" y2="318" />
                <line x1="285" y1="284" x2="285" y2="318" />
                <line x1="315" y1="278" x2="315" y2="310" />
              </g>
            </g>

            {/* blank white eyes with a glow that flares in the tic */}
            <g id="eyes">
              <g id="eye-l"><rect x="190" y="198" width="48" height="24" rx="12" fill={WHITE} /></g>
              <g id="eye-r"><rect x="302" y="198" width="48" height="24" rx="12" fill={WHITE} /></g>
              <g id="eye-glow" opacity="0" fill={WHITE}>
                <rect x="180" y="190" width="68" height="40" rx="20" opacity="0.45" />
                <rect x="292" y="190" width="68" height="40" rx="20" opacity="0.45" />
              </g>
            </g>
            {/* X eyes for the error state (shown while #eyes is hidden) */}
            <g id="eyes-x" opacity="0" stroke={WHITE} strokeWidth="9" strokeLinecap="round">
              <line x1="196" y1="192" x2="232" y2="228" />
              <line x1="232" y1="192" x2="196" y2="228" />
              <line x1="308" y1="192" x2="344" y2="228" />
              <line x1="344" y1="192" x2="308" y2="228" />
            </g>
          </g>

          {/* red overlay for the error strobe (same silhouette) */}
          <g id="red-tint" fill="#E5484D" opacity="0">
            <path d={TORSO_D} />
            <circle cx="270" cy="210" r="160" />
            <rect x="112" y="420" width="40" height="104" rx="20" />
            <rect x="388" y="420" width="40" height="104" rx="20" />
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

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Sprout mascot ───────────────────────────────────────────────────────────
// An original, hand-drawn baby-sapling creature in the spirit of a certain
// dancing sapling from a space-opera comic: an OVERSIZED bark head with big
// glossy eyes and a fan of twig "hair", a slender twiggy trunk, and long thin
// branch arms ending in twig fingers that can sprout curling vines. Each
// AgentState drives a pose:
//
//   idle         → leaning onto a pillow, crown drooped, eyes shut, drifting
//                  "zzz"
//   idle-active  → breathing, a slow crown sway, plus a periodic tic where a
//                  extra leaf pops out of the crown and a blink
//   working      → THE DANCE: vines grow out of both arms while the body
//                  sways to a beat, arms swing counter-rhythm, the crown
//                  bounces, a little hop, then the vines retract
//   waiting      → "need input" sign rises, one arm scratches the head, body
//                  rocks, crown sways, eyes glance at the sign
//   error        → the leaves wilt: the crown droops and tints dry, cracks
//                  appear on the bark, the head droops, X-eyes, ⚠ badge
//
// The rig shares Merc/Sensei's coordinate space and prop geometry (pillow,
// zzz, sign, badge all sit where theirs do), so it drops into the same window
// footprint in MASCOT_GEOMETRY without retuning. Every animated part pivots
// at its own local origin: either wrapped in a static
// `<g transform="translate(x y)">` with the inner group animated via
// `transformOrigin: '0px 0px'` (crown, arms, vines), or tweened with an
// explicit `svgOrigin` (body, head, eyes) — never a bare rotation on an
// authored transform, which GSAP's revert() would fail to unwind cleanly
// (see mascotRig.ts).
//
// All animation lives in a `gsap.context` scoped to the component's root and
// reverted on every state change; `resetMascotRig` puts the authored
// transforms back first.

interface SproutMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Merc/Sensei: character spans x ≈ 90..450, y ≈ 40..590
// (base line y 590). Headroom above (y -200..0) holds the sign, zzz, badge
// and the top of the twig-hair crown.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const EYES_C = '270 225'; // centre between the two big eyes
const FOOT_C = '270 590'; // base of the trunk (squash / hop / sway pivot)
const HEAD_C = '270 350'; // where the head meets the neck (droop pivot)

const BARK = '#7a5230';
const BARK_LIGHT = '#a07048';
const BARK_DEEP = '#4e3119';
const GRAIN = '#5c3c22';
const MOSS = '#6aa84f';
const MOSS_DARK = '#4f8a3a';
const EYE = '#141414';
const GLINT = '#ffffff';
const MOUTH = '#3a2414';
const WILT = '#7a5a3a';

// Oversized head: tall and rounded, widest at the brow (~y120), tapering to
// a soft chin at (270, 340). Reused for the silhouette tint.
const HEAD_D = 'M270 60 C205 60 155 78 138 105 C130 118 130 118 130 130 C130 175 142 218 168 258 C196 302 230 340 270 340 C310 340 344 302 372 258 C398 218 410 175 410 130 C410 118 410 118 402 105 C385 78 335 60 270 60 Z';
// Slender trunk: shoulders 200..340 @ y370, waist 225..315 @ y470, hips
// 205..335 @ y560, rounding to the base at y590.
const TORSO_D = 'M270 358 C230 358 205 362 200 370 C207 405 218 435 225 470 C214 500 206 530 205 560 C204 578 225 590 270 590 C315 590 336 578 335 560 C334 530 326 500 315 470 C322 435 333 405 340 370 C335 362 310 358 270 358 Z';
// A long thin branch arm, drawn at its own local origin (the shoulder),
// bending outward-down to a hand; mirrored via scale(-1,1) for the right arm.
const ARM_D = 'M0 0 L-25 84 Q-35 128 -10 172';
const ARM_HL_D = 'M-28 96 Q-34 130 -12 168';
// A curling vine, drawn from the hand (local 0,0) up and out.
const VINE_D = 'M0,0 C -15,-35 15,-55 -10,-90 C -30,-115 10,-140 -15,-180 C -30,-200 5,-215 -10,-220';

// A curling vine with 3 small leaves, drawn out of the local origin. Reused
// (mirrored via a static wrapper) for both arms.
const Vine: React.FC = () => (
  <>
    <path d={VINE_D} stroke={BARK} strokeWidth="8" fill="none" strokeLinecap="round" />
    <ellipse cx="-10" cy="-90" rx="15" ry="9" fill={MOSS} transform="rotate(-20 -10 -90)" />
    <ellipse cx="-18" cy="-150" rx="15" ry="9" fill={MOSS_DARK} transform="rotate(15 -18 -150)" />
    <ellipse cx="-8" cy="-205" rx="15" ry="9" fill={MOSS} transform="rotate(-10 -8 -205)" />
  </>
);

// A long branch-arm, drawn at its own local origin (the shoulder), ending in
// 3 short twig fingers at the hand.
const Branch: React.FC = () => (
  <>
    <path d={ARM_D} stroke={BARK} strokeWidth="16" strokeLinecap="round" fill="none" />
    <path d={ARM_HL_D} stroke={BARK_LIGHT} strokeWidth="9" strokeLinecap="round" fill="none" />
    <g transform="translate(-10 172)" stroke={BARK} strokeWidth="6" strokeLinecap="round" fill="none">
      <path d="M0 0 L-15 20" />
      <path d="M0 0 L0 24" />
      <path d="M0 0 L15 20" />
    </g>
  </>
);

export const SproutMascot: React.FC<SproutMascotProps> = ({ state, width }) => {
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
          .to('#crown', { rotation: 25, scaleY: 0.85, ...LOCAL, duration: 0.5, ease: 'power2.out' }, '-=0.6')
          .to('#eyes', { scaleY: 0.12, svgOrigin: EYES_C, duration: 0.4, ease: 'power2.out' }, '-=0.5')
          .add(() => {
            // slow breathing from the base
            gsap.to('#body', { scaleY: 1.04, scaleX: 1.01, svgOrigin: FOOT_C, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '350 -60' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 45, y: -80, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → NEUTRAL + crown sway + tic-leaf pop ───────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        gsap.fromTo('#crown', { rotation: -6, ...LOCAL }, { rotation: 6, ...LOCAL, duration: 3, ease: 'sine.inOut', repeat: -1, yoyo: true });
        // Every few seconds: a little extra leaf pops out of the crown and
        // holds, then shrinks back, with a quick blink along the way.
        gsap.timeline({ repeat: -1, repeatDelay: 4.5, delay: 1.2 })
          .to('#tic-leaf', { scale: 1, ...LOCAL, duration: 0.35, ease: 'back.out(2)' })
          .to('#eyes', { scaleY: 0.15, svgOrigin: EYES_C, duration: 0.1, ease: 'power1.inOut', repeat: 1, yoyo: true }, '+=0.2')
          .to({}, { duration: 0.9 })
          .to('#tic-leaf', { scale: 0, ...LOCAL, duration: 0.25, ease: 'power2.in' });
      };

      // ── working → THE DANCE: vines grow, sway, hop, retract ─────────────
      const playRun = () => {
        const tl = gsap.timeline({ repeat: -1 });

        // vines grow out of both arms
        tl.to('#vine-l, #vine-r', { scale: 1, ...LOCAL, duration: 0.6, ease: 'elastic.out(1, 0.5)' });

        // 4 sways on a beat, arms swinging counter-rhythm, crown bouncing
        const beat = 0.4;
        for (let i = 0; i < 4; i++) {
          const dir = i % 2 === 0 ? 1 : -1;
          tl.to('#char', { rotation: 9 * dir, x: 14 * dir, svgOrigin: FOOT_C, duration: beat / 2, ease: 'sine.inOut' })
            .to('#arm-l', { rotation: -25 * dir, ...LOCAL, duration: beat / 2, ease: 'sine.inOut' }, '<')
            .to('#arm-r', { rotation: 25 * dir, ...LOCAL, duration: beat / 2, ease: 'sine.inOut' }, '<')
            .to('#crown', { scaleY: dir > 0 ? 1.1 : 0.9, ...LOCAL, duration: beat / 2, ease: 'sine.inOut' }, '<');
        }
        tl.to('#char', { rotation: 0, x: 0, svgOrigin: FOOT_C, duration: 0.2, ease: 'power2.inOut' })
          .to('#arm-l, #arm-r', { rotation: 0, ...LOCAL, duration: 0.2 }, '<')
          .to('#crown', { scaleY: 1, ...LOCAL, duration: 0.2 }, '<');

        // a little hop, squash on landing
        tl.to('#char', { y: -40, duration: 0.2, ease: 'power2.out' })
          .to('#char', { y: 0, duration: 0.18, ease: 'power2.in' })
          .to('#char', { scaleY: 0.9, scaleX: 1.08, svgOrigin: FOOT_C, duration: 0.1, ease: 'power1.out' })
          .to('#char', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.15 });

        // the vines retract, then a beat before the dance repeats
        tl.to('#vine-l, #vine-r', { scale: 0, ...LOCAL, duration: 0.35, ease: 'power2.in' })
          .to({}, { duration: 0.3 });
      };

      // ── waiting → NEED INPUT (sign rises, scratches head, rocks) ────────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .to('#arm-r', { rotation: -120, ...LOCAL, duration: 0.4, ease: 'power2.out' }, '-=0.3') // scratch the head
          .to('#eyes', { x: 14, duration: 0.3, ease: 'power2.out' }, '<') // glance at the sign
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // impatient rock on the base
            gsap.fromTo('#body', { rotation: -3, svgOrigin: FOOT_C }, { rotation: 3, svgOrigin: FOOT_C, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // crown sways along
            gsap.fromTo('#crown', { rotation: -4, ...LOCAL }, { rotation: 4, ...LOCAL, duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // small scratching wiggles on the raised arm
            gsap.to('#arm-r', { rotation: -108, ...LOCAL, duration: 0.25, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      // ── error → WILT: crown droops, cracks, head droops, X-eyes, ⚠ ──────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap eyes → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .to('#crown', { rotation: 40, scaleY: 0.7, ...LOCAL, duration: 0.6, ease: 'power2.out' }, '-=0.2')
          .to('#wilt-tint', { opacity: 0.7, duration: 0.6, ease: 'power2.out' }, '<')
          .to('#cracks', { opacity: 1, duration: 0.4 }, '<')
          .to('#head', { rotation: 8, y: 12, svgOrigin: HEAD_C, duration: 0.5, ease: 'power2.out' }, '<')
          .add(() => {
            // the bark drains dark in a strobe
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
          {/* short neck stem, peeking out below the oversized head */}
          <rect x="250" y="335" width="40" height="35" fill={BARK} />

          {/* slender trunk with grain lines and a shoulder moss patch */}
          <path d={TORSO_D} fill={BARK} />
          <g id="grooves" stroke={GRAIN} strokeWidth="6" fill="none" strokeLinecap="round">
            <path d="M215 375 Q205 470 210 575" />
            <path d="M243 368 Q230 470 232 580" />
            <path d="M270 362 Q268 470 270 585" />
            <path d="M297 368 Q310 470 308 580" />
            <path d="M325 375 Q335 470 330 575" />
          </g>
          <g id="patches" fill={MOSS}>
            <ellipse cx="205" cy="390" rx="26" ry="18" transform="rotate(-10 205 390)" />
            <ellipse cx="218" cy="402" rx="18" ry="12" fill={MOSS_DARK} transform="rotate(15 218 402)" />
          </g>

          {/* stubby root feet at the base */}
          <g id="roots" fill={BARK_DEEP}>
            <path d="M215 555 C210 570 210 585 225 590 L245 590 C258 585 255 570 250 555 Z" />
            <path d="M290 555 C285 570 285 585 300 590 L320 590 C333 585 330 570 325 555 Z" />
            <path d="M215 588 L195 599 L221 592 Z" />
            <path d="M235 590 L233 606 L246 592 Z" />
            <path d="M325 588 L345 599 L319 592 Z" />
            <path d="M305 590 L307 606 L294 592 Z" />
          </g>

          {/* long thin branch arms; each can sprout a curling vine for the dance */}
          <g transform="translate(205 385)">
            <g id="arm-l" transform="rotate(0)"><Branch /></g>
            <g id="vine-l" transform="scale(0)">
              <g transform="translate(-10 172)"><Vine /></g>
            </g>
          </g>
          <g transform="translate(335 385)">
            <g id="arm-r" transform="rotate(0)"><g transform="scale(-1,1)"><Branch /></g></g>
            <g id="vine-r" transform="scale(0)">
              <g transform="translate(10 172) scale(-1,1)"><Vine /></g>
            </g>
          </g>

          <g id="head">
            <path d={HEAD_D} fill={BARK} />
            {/* vertical grain lines down the face sides */}
            <g stroke={GRAIN} strokeWidth="5" fill="none" strokeLinecap="round">
              <path d="M150 130 Q140 220 160 320" />
              <path d="M190 110 Q180 210 195 330" />
              <path d="M270 300 Q268 320 270 338" />
              <path d="M350 110 Q360 210 345 330" />
              <path d="M390 130 Q400 220 380 320" />
            </g>
            {/* moss patches: a larger pair upper-left, a smaller one on the right cheek */}
            <g fill={MOSS}>
              <ellipse cx="165" cy="100" rx="34" ry="24" transform="rotate(-15 165 100)" />
              <ellipse cx="185" cy="118" rx="24" ry="16" fill={MOSS_DARK} transform="rotate(10 185 118)" />
              <ellipse cx="350" cy="275" rx="20" ry="13" transform="rotate(15 350 275)" />
            </g>
            {/* big glossy dark eyes with a large glint each and a tiny second glint */}
            <g id="eyes" fill={EYE}>
              <g id="eye-l"><ellipse cx="208" cy="225" rx="34" ry="44" /><circle cx="192" cy="205" r="11" fill={GLINT} /><circle cx="222" cy="242" r="4" fill={GLINT} /></g>
              <g id="eye-r"><ellipse cx="332" cy="225" rx="34" ry="44" /><circle cx="316" cy="205" r="11" fill={GLINT} /><circle cx="346" cy="242" r="4" fill={GLINT} /></g>
            </g>
            <path d="M250 300 Q270 312 290 300" stroke={MOUTH} strokeWidth="8" fill="none" strokeLinecap="round" />
            {/* X eyes for the error state (shown while #eyes is hidden) */}
            <g id="eyes-x" opacity="0" stroke={EYE} strokeWidth="10" strokeLinecap="round">
              <line x1="178" y1="185" x2="238" y2="265" />
              <line x1="238" y1="185" x2="178" y2="265" />
              <line x1="302" y1="185" x2="362" y2="265" />
              <line x1="362" y1="185" x2="302" y2="265" />
            </g>
          </g>

          {/* jagged cracks over the bark for the error state */}
          <g id="cracks" opacity="0" stroke={EYE} strokeWidth="6" strokeLinecap="round" fill="none">
            <path d="M180 100 L195 150 L175 200 L190 250" />
            <path d="M362 90 L347 140 L367 180" />
            <path d="M230 400 L250 450 L225 500 L245 540" />
          </g>

          {/* dark overlay for the error strobe (same silhouette) */}
          <g id="dark-tint" fill="#111111" opacity="0">
            <path d={HEAD_D} />
            <path d={TORSO_D} />
            <rect x="172" y="380" width="53" height="185" rx="22" />
            <rect x="315" y="380" width="53" height="185" rx="22" />
          </g>
        </g>

        {/* twig-hair crown, wrapped in a static translate so it pivots at the head top */}
        <g transform="translate(270 70)">
          <g id="crown">
            <g id="sprigs" stroke={BARK} strokeLinecap="round" fill="none">
              <path d="M0 0 L-61 -22" strokeWidth="7" />
              <path d="M0 0 L-57 -57" strokeWidth="8" />
              <path d="M-31 -31 L-51 -46" strokeWidth="6" />
              <path d="M0 0 L-27 -75" strokeWidth="9" />
              <path d="M0 0 L0 -75" strokeWidth="9" />
              <path d="M0 0 L27 -75" strokeWidth="9" />
              <path d="M0 0 L57 -57" strokeWidth="8" />
              <path d="M31 -31 L51 -46" strokeWidth="6" />
              <path d="M0 0 L61 -22" strokeWidth="7" />
            </g>
            <g id="leaves" fill={MOSS}>
              <ellipse cx="-27" cy="-75" rx="16" ry="8" transform="rotate(-20 -27 -75)" />
              <ellipse cx="-19" cy="-83" rx="14" ry="7" fill={MOSS_DARK} transform="rotate(10 -19 -83)" />
              <ellipse cx="0" cy="-75" rx="16" ry="8" />
              <ellipse cx="8" cy="-84" rx="14" ry="7" fill={MOSS_DARK} transform="rotate(15 8 -84)" />
              <ellipse cx="27" cy="-75" rx="16" ry="8" transform="rotate(20 27 -75)" />
              <ellipse cx="19" cy="-83" rx="14" ry="7" fill={MOSS_DARK} transform="rotate(-10 19 -83)" />
            </g>
            {/* dry overlay on the leaves for the error wilt */}
            <g id="wilt-tint" fill={WILT} opacity="0">
              <ellipse cx="-27" cy="-75" rx="16" ry="8" transform="rotate(-20 -27 -75)" />
              <ellipse cx="0" cy="-75" rx="16" ry="8" />
              <ellipse cx="27" cy="-75" rx="16" ry="8" transform="rotate(20 27 -75)" />
            </g>
            {/* extra leaf for the idle-active tic, authored hidden */}
            <g transform="translate(0 -75)">
              <g id="tic-leaf" transform="scale(0)">
                <ellipse cx="0" cy="-14" rx="18" ry="10" fill={MOSS} />
              </g>
            </g>
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

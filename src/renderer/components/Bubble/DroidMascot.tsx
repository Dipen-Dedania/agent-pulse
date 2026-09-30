import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Droid mascot ────────────────────────────────────────────────────────────
// An original, hand-drawn utility droid in the spirit of a certain beeping
// astromech: a WHITE cylinder body with BLUE panel details and vent slots, a
// SILVER half-disc dome carrying an off-centre dark radar-eye lens, a small
// holoprojector and two crown indicator bulbs, two side legs on blue shoulder
// hubs plus a retractable centre leg, and a stowed tool arm with a 3-prong
// claw. Each AgentState drives a pose:
//
//   idle         → dome turns away, lens-glow dims, centre leg tucks further
//                  in, lean onto a pillow, drifting "zzz"
//   idle-active  → breathing, dome idly scans left-right, plus a periodic
//                  lens-glow pulse + dome snap-glance tic
//   working      → ROLL AND FIX: centre leg drops, the dome spins a full 360
//                  the whole time, the tool arm extends and its claw spins,
//                  while the body does dash laps with a fast wobble layered
//                  on top; tool retracts before the loop repeats
//   waiting      → "need input" sign rises, dome tilts toward it, lens-glow
//                  blinks, body rocks, centre leg taps impatiently
//   error        → smoke puffs rise off the dome in a staggered loop, the
//                  spare red crown bulb strobes, the dome jitters, the whole
//                  droid lists to one side, X-eyes, ⚠ badge
//
// The rig shares Merc/Sensei's coordinate space and prop geometry (pillow,
// zzz, sign, badge all sit where theirs do), so it drops into the same
// window footprint in MASCOT_GEOMETRY without retuning. Every animated part
// pivots at its own local origin: either wrapped in a static
// `<g transform="translate(x y)">` with the inner group animated via
// `transformOrigin: '0px 0px'` (the tool arm, its claw, the centre leg), or
// tweened with an explicit `svgOrigin` (the dome, the body, the whole
// character) — never a bare rotation/scale on an authored transform, which
// GSAP's revert() would fail to unwind cleanly (see mascotRig.ts).
//
// All animation lives in a single `gsap.context` scoped to the component's
// root and reverted on every state change; `resetMascotRig` puts the
// authored transforms back first.

interface DroidMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Merc/Sensei: character spans x ≈ 90..450, y ≈ 40..590
// (base line y 590). Headroom above (y -200..0) holds the sign, zzz, badge
// and the smoke puffs.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const FOOT_C = '270 590'; // base of the body (lean / dash / list pivot)
const DOME_C = '270 300'; // dome's flat base centre (rotation pivot)

const WHITE = '#f3f5f8';
const WHITE_SHADE = '#d5dae2';
const SILVER = '#b9bfc9';
const SILVER_SHADE = '#9aa2ae';
const BLUE = '#1f4fa3';
const BLUE_LIGHT = '#2e6fd8';
const DARK = '#1c1f24';
const LENS = '#0b0d11';
const LENS_RIM = '#7f8794';
const RED = '#e5484d';
const BULB_BLUE = '#63a5ff';
const SMOKE = '#9aa0a6';

// Half-disc dome: flat side down along y 300, rounded top through y 170.
const DOME_D = 'M140 300 A130 130 0 0 1 400 300 Z';

export const DroidMascot: React.FC<DroidMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);
  // Authored transforms, captured on mount so every pose can start from them.
  const rigRef = useRef<MascotRigSnapshot | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    // Put the rig back on its authored coordinates before each pose (see
    // mascotRig.ts): ctx.revert() doesn't reliably unwind the SVG transform
    // attribute, so without this the droid drifts on every state change.
    if (!rigRef.current) rigRef.current = snapshotMascotRig(rootRef.current);
    resetMascotRig(rigRef.current);

    const ctx = gsap.context(() => {
      // One puff of smoke, looping forever with its own delay for the stagger.
      const smoke = (id: string, cx: number, cy: number, delay: number) => {
        gsap.timeline({ repeat: -1, delay })
          .fromTo(`#${id}`, { opacity: 0, y: 0, scale: 1 }, {
            opacity: 0.7, y: -70, scale: 1.4, svgOrigin: `${cx} ${cy}`, duration: 0.7, ease: 'sine.out',
          })
          .to(`#${id}`, { opacity: 0, duration: 0.7, ease: 'sine.in' });
      };

      // ── idle → SLEEP ────────────────────────────────────────────────────
      const playSleep = () => {
        gsap.to('#pillow', { opacity: 1, duration: 0.4 });
        gsap.timeline()
          .to('#char', { rotation: -14, x: -14, y: 14, svgOrigin: '150 590', duration: 0.9, ease: 'power2.inOut' })
          .to('#dome', { rotation: -30, svgOrigin: DOME_C, duration: 0.6, ease: 'power2.out' }, '-=0.75')
          .to('#lens-glow', { opacity: 0, duration: 0.3 }, '<')
          .to('#leg-c', { y: -55, duration: 0.5, ease: 'power2.out' }, '<')
          .add(() => {
            // faint breathing from the base
            gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.2, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '350 -60' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 45, y: -80, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → NEUTRAL: dome scan + glow-pulse/snap-glance tic ───
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });

        // Slow idle scan; paused during the tic below so the two don't fight
        // over the same #dome rotation, then rebuilt fresh afterwards.
        let scan = gsap.fromTo('#dome', { rotation: -12 }, { rotation: 12, svgOrigin: DOME_C, duration: 3, ease: 'sine.inOut', repeat: -1, yoyo: true });

        gsap.timeline({ repeat: -1, repeatDelay: 4.5, delay: 1.2 })
          .call(() => scan.pause())
          .to('#lens-glow', { scale: 1.6, svgOrigin: '309 231', duration: 0.2, ease: 'sine.inOut', yoyo: true, repeat: 3 }, '<')
          .to('#dome', { rotation: 32, svgOrigin: DOME_C, duration: 0.3, ease: 'back.out(1.8)' }, '<')
          .to({}, { duration: 0.6 })
          .to('#dome', { rotation: 0, svgOrigin: DOME_C, duration: 0.3, ease: 'power2.inOut' })
          .call(() => {
            scan.kill();
            scan = gsap.fromTo('#dome', { rotation: -12 }, { rotation: 12, svgOrigin: DOME_C, duration: 3, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      // ── working → ROLL AND FIX: spin, extend tool, dash, wobble ─────────
      const playRun = () => {
        const tl = gsap.timeline({ repeat: -1 });
        let spin: ReturnType<typeof gsap.to> | null = null;
        let bitSpin: ReturnType<typeof gsap.to> | null = null;
        let wobble: ReturnType<typeof gsap.fromTo> | null = null;

        tl.to('#leg-c', { y: 0, duration: 0.3, ease: 'power2.out' })
          .to('#tool-arm', { scaleX: 1, duration: 0.35, ease: 'back.out(1.6)' }, '-=0.1')
          .call(() => {
            spin = gsap.to('#dome', { rotation: 360, svgOrigin: DOME_C, duration: 1.1, ease: 'none', repeat: -1 });
            bitSpin = gsap.to('#tool-bit', { rotation: 720, duration: 0.6, ease: 'none', repeat: -1 });
            wobble = gsap.fromTo('#head', { rotation: -3, svgOrigin: DOME_C }, { rotation: 3, svgOrigin: DOME_C, duration: 0.15, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });

        // Two dash laps, leaning into the sprint like Merc's.
        const s = 0.32;
        for (let r = 0; r < 2; r++) {
          tl.to('#char', { x: -85, rotation: -6, svgOrigin: FOOT_C, duration: s, ease: 'power2.inOut' })
            .to('#char', { x: 85, rotation: 6, svgOrigin: FOOT_C, duration: s * 1.6, ease: 'power2.inOut' })
            .to('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C, duration: s, ease: 'power2.inOut' });
        }

        tl.call(() => { wobble?.kill(); gsap.set('#head', { rotation: 0 }); })
          .to('#tool-arm', { scaleX: 0, duration: 0.3, ease: 'power2.in' })
          .to('#leg-c', { y: -40, duration: 0.3, ease: 'power2.in' })
          .call(() => {
            spin?.kill();
            bitSpin?.kill();
            gsap.set('#dome', { rotation: 0 });
            gsap.set('#tool-bit', { rotation: 0 });
          })
          .to({}, { duration: 0.3 }); // beat before the loop repeats
      };

      // ── waiting → NEED INPUT (sign rises, dome tilts, leg taps) ─────────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .to('#dome', { rotation: 28, svgOrigin: DOME_C, duration: 0.4, ease: 'power2.out' }, '-=0.3')
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // impatient rock on the base
            gsap.fromTo('#body', { rotation: -3, svgOrigin: FOOT_C }, { rotation: 3, svgOrigin: FOOT_C, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // lens-glow blink
            gsap.to('#lens-glow', { opacity: 0.2, duration: 0.5, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // centre leg taps
            gsap.to('#leg-c', { y: -50, duration: 0.3, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      // ── error → smoke puffs + red bulb strobe + jitter + list + ⚠ ──────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap the main lens → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#eye-red', { opacity: 0 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .to('#char', { rotation: 8, svgOrigin: FOOT_C, duration: 0.3, ease: 'power2.out' }, '-=0.2') // list to one side
          .add(() => {
            // smoke puffs rising off the dome, staggered
            smoke('smoke-1', 230, 150, 0);
            smoke('smoke-2', 270, 125, 0.45);
            smoke('smoke-3', 310, 150, 0.9);
            // the spare red crown bulb strobes
            gsap.to('#eye-red', { opacity: 1, duration: 0.25, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // the dome jitters
            gsap.to('#dome', { rotation: 5, svgOrigin: DOME_C, duration: 0.08, ease: 'none', repeat: -1, yoyo: true });
            // white shell drains to near-black in a strobe
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
      {/* floating "zzz" for sleep (above the dome) */}
      <text id="zzz" x="290" y="-10" fontFamily="ui-sans-serif, sans-serif" fontSize="140" fontStyle="italic" fontWeight="700" fill="#cfd3da" opacity="0">z z z</text>

      {/* pillow for sleep (behind it, under the left flank) */}
      <rect id="pillow" x="0" y="500" width="230" height="95" rx="44" fill="#ECE6DA" opacity="0" />

      <g id="char">
        <g id="body">
          {/* white cylinder shell, with a shade sliver along the right edge
              for roundness, then the blue panel details laid on top */}
          <rect x="140" y="300" width="260" height="260" rx="26" fill={WHITE} />
          <rect x="384" y="300" width="16" height="260" rx="8" fill={WHITE_SHADE} />

          {/* top shoulder band, full width */}
          <rect x="140" y="305" width="260" height="20" rx="10" fill={BLUE} />

          {/* two side-by-side panels with a plain white gap between them */}
          <rect x="165" y="340" width="80" height="60" rx="8" fill={BLUE} />
          <rect x="295" y="340" width="80" height="60" rx="8" fill={BLUE} />

          {/* dark vent grille, two stacked slats each with 3 thin light lines */}
          <rect x="230" y="415" width="80" height="30" rx="6" fill={DARK} />
          <rect x="236" y="423" width="68" height="3" fill={WHITE_SHADE} />
          <rect x="236" y="431" width="68" height="3" fill={WHITE_SHADE} />
          <rect x="236" y="439" width="68" height="3" fill={WHITE_SHADE} />
          <rect x="230" y="455" width="80" height="30" rx="6" fill={DARK} />
          <rect x="236" y="463" width="68" height="3" fill={WHITE_SHADE} />
          <rect x="236" y="471" width="68" height="3" fill={WHITE_SHADE} />
          <rect x="236" y="479" width="68" height="3" fill={WHITE_SHADE} />

          {/* power coupling square, bottom centre */}
          <rect x="255" y="500" width="30" height="30" rx="4" fill={BLUE} />

          {/* thin blue strips on the lower flanks */}
          <rect x="160" y="420" width="18" height="120" rx="4" fill={BLUE} />
          <rect x="362" y="420" width="18" height="120" rx="4" fill={BLUE} />

          {/* side legs on blue shoulder hubs, angled struts flaring out to
              wedge feet with a dark tread pad and a blue face detail */}
          <g id="leg-l">
            <circle cx="120" cy="350" r="34" fill={BLUE} />
            <path d="M112 348 L148 348 L168 540 L72 540 Z" fill={WHITE} />
            <path d="M68 540 L172 540 L152 588 L88 588 Z" fill={WHITE} />
            <rect x="88" y="578" width="64" height="12" rx="5" fill={DARK} />
            <rect x="100" y="552" width="40" height="16" rx="4" fill={BLUE} />
          </g>
          <g id="leg-r">
            <circle cx="420" cy="350" r="34" fill={BLUE} />
            <path d="M428 348 L392 348 L372 540 L468 540 Z" fill={WHITE} />
            <path d="M472 540 L368 540 L388 588 L452 588 Z" fill={WHITE} />
            <rect x="388" y="578" width="64" height="12" rx="5" fill={DARK} />
            <rect x="400" y="552" width="40" height="16" rx="4" fill={BLUE} />
          </g>

          {/* centre leg: white strut with a small dark foot pad, authored
              retracted (translated up); a `y` tween drops it for the
              working pose or taps it while waiting */}
          <g id="leg-c" transform="translate(0 -40)">
            <rect x="245" y="500" width="50" height="90" rx="10" fill={WHITE} />
            <rect x="245" y="576" width="50" height="14" rx="6" fill={DARK} />
          </g>

          {/* stowed tool arm: static translate to its mount point (a small
              dark hatch on the left panel column), inner group authored
              scaleX(0) so it "extends" out of the hatch */}
          <g transform="translate(150 420)">
            <rect x="-14" y="-16" width="24" height="32" rx="4" fill={DARK} />
            <g id="tool-arm" transform="scale(0 1)">
              <rect x="0" y="-8" width="130" height="16" rx="8" fill={WHITE} />
              <g transform="translate(130 0)">
                <g id="tool-bit" stroke={DARK} strokeWidth="8" strokeLinecap="round">
                  <line x1="0" y1="0" x2="14" y2="-16" />
                  <line x1="0" y1="0" x2="18" y2="0" />
                  <line x1="0" y1="0" x2="14" y2="16" />
                </g>
              </g>
            </g>
          </g>

          {/* dome + lens, wrapped so #head is the contract's stable id and
              #dome is the part that actually tweens (pivot: svgOrigin '270 300') */}
          <g id="head">
            <g id="dome">
              <path d={DOME_D} fill={SILVER} />
              {/* shade crescent along the right edge, for roundness */}
              <path d="M400 300 A130 130 0 0 0 380 220 A110 110 0 0 1 400 300 Z" fill={SILVER_SHADE} />
              {/* blue band hugging the flat base */}
              <path d="M175 300 A95 30 0 0 1 365 300" stroke={BLUE_LIGHT} strokeWidth="20" fill="none" strokeLinecap="round" />
              {/* radial sensor-panel segments across the crown */}
              <path d="M316.9 265.9 L365.5 230.6 L321.7 193.9 L295.4 247.9 Z" fill={BLUE_LIGHT} />
              <path d="M284 243.7 L298.6 185.5 L241.4 185.5 L256 243.7 Z" fill={BLUE_LIGHT} />
              <path d="M244.6 247.9 L218.3 193.9 L174.5 230.6 L223.1 265.9 Z" fill={BLUE_LIGHT} />

              {/* small holoprojector lens */}
              <circle cx="225" cy="215" r="14" fill={LENS} />
              {/* spare red crown bulb, only lit up during the error strobe */}
              <circle id="eye-red" cx="250" cy="190" r="9" fill={RED} opacity="0" />
              {/* companion blue crown bulb, always lit */}
              <circle cx="290" cy="190" r="9" fill={BULB_BLUE} />

              {/* off-centre radar eye */}
              <g id="eyes">
                <g id="eye-l">
                  <circle cx="300" cy="240" r="30" fill={LENS} stroke={LENS_RIM} strokeWidth="6" />
                  <circle id="lens-glow" cx="309" cy="231" r="8" fill={BULB_BLUE} />
                </g>
              </g>
              {/* X eyes for the error state (shown while #eyes is hidden) */}
              <g id="eyes-x" opacity="0" stroke={LENS} strokeWidth="10" strokeLinecap="round">
                <line x1="278" y1="218" x2="322" y2="262" />
                <line x1="322" y1="218" x2="278" y2="262" />
              </g>
            </g>
          </g>

          {/* dark overlay for the error strobe (same silhouette: body, dome, feet) */}
          <g id="dark-tint" fill="#111111" opacity="0">
            <rect x="140" y="300" width="260" height="260" rx="26" />
            <path d="M112 348 L148 348 L168 540 L72 540 Z" />
            <path d="M68 540 L172 540 L152 588 L88 588 Z" />
            <path d="M428 348 L392 348 L372 540 L468 540 Z" />
            <path d="M472 540 L368 540 L388 588 L452 588 Z" />
            <path d={DOME_D} />
          </g>
        </g>

        {/* smoke puffs, rising off the dome for the error state */}
        <g id="smoke">
          <circle id="smoke-1" cx="230" cy="150" r="22" fill={SMOKE} opacity="0" />
          <circle id="smoke-2" cx="270" cy="125" r="16" fill={SMOKE} opacity="0" />
          <circle id="smoke-3" cx="310" cy="150" r="12" fill={SMOKE} opacity="0" />
        </g>

        {/* "need input" sign, planted beside its right flank */}
        <g id="flag" opacity="0">
          <rect id="flag-pole" x="470" y="-175" width="14" height="345" rx="7" fill="#5D5B56" />
          <rect id="flag-sign" x="482" y="-185" width="218" height="145" rx="22" fill="#FBF7EF" stroke="#D9CFC0" strokeWidth="5" />
          <text x="591" y="-128" textAnchor="middle" fontFamily="ui-sans-serif, sans-serif" fontSize="50" fontWeight="700" fill="#3A3530">
            <tspan x="591" dy="0">Need</tspan>
            <tspan x="591" dy="58">input</tspan>
          </text>
        </g>

        {/* warning badge for the error state (triangle + "!"), pops above the dome */}
        <g id="alert" opacity="0">
          <path d="M270 -105 L318 -20 L222 -20 Z" fill="#E5484D" stroke="#FFFFFF" strokeWidth="6" strokeLinejoin="round" />
          <rect x="265" y="-80" width="10" height="36" rx="5" fill="#FFFFFF" />
          <rect x="265" y="-36" width="10" height="10" rx="5" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
};

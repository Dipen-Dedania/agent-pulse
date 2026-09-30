import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Rusty mascot ────────────────────────────────────────────────────────────
// An original, hand-drawn boxy tan compactor robot in the spirit of a certain
// lonely trash-compacting robot: a squat tan chassis on two tank treads, a
// thin retractable neck, and a binocular head with two dark lenses. No hands
// beyond simple 3-finger claws, so most of the acting comes from the whole
// chassis leaning, hopping and dashing. Each AgentState drives a pose:
//
//   idle         → neck retracted, lenses shut, slumped onto a pillow,
//                  drifting "zzz"
//   idle-active  → gentle head bob, plus a periodic tic: lenses track side to
//                  side, one lens squints, head tilts
//   working      → treads roll, the chassis dashes left/right in laps with
//                  the claws pumping and the head bobbing to the tempo, each
//                  lap ending in a little hop and a squash landing
//   waiting      → "need input" sign rises; a little potted sprout is raised
//                  in the left claw, head tilts toward the sign, body rocks
//                  at a foot-tap tempo
//   error        → lenses swap to X eyes, sparks flicker around the neck,
//                  the head droops, a dark strobe washes the chassis, glitch
//                  shudder, ⚠ badge
//
// The rig shares Kiro/Merc's coordinate space and prop geometry (pillow, zzz,
// sign, badge all sit where the ghost's do), so it drops into the same
// footprint in MASCOT_GEOMETRY without retuning. Every animated part has its
// pivot at its own local origin: the claws are wrapped in a static translate
// at their shoulder with an authored `rotate(0)` so they can be tweened with
// a bare `transformOrigin: '0px 0px'`, while the body/head/eyes use an
// explicit `svgOrigin` since they are already centred on a meaningful point.
//
// All animation lives in a `gsap.context` scoped to the component's root and
// reverted on every state change; `resetMascotRig` puts the authored
// transforms back first (see mascotRig.ts for why).

interface RustyMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Kiro/Merc: character spans x ≈ 90..450, y ≈ 40..590+
// (treads dip a little past the nominal base line). Headroom above (y
// -200..0) holds the sign, zzz and badge.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const HEAD_C = '270 380'; // where the neck meets the head (tilt / droop pivot)
const FOOT_C = '270 590'; // base of the chassis (squash / hop / rock pivot)
const EYE_L_C = '230 245';
const EYE_R_C = '310 245';

const TAN = '#c9a24a';
const RUST = '#8b5a2b';
const STEEL = '#3b3b3b';
const LENS = '#1a1d22';
const LENS_GLOW = '#8fd3ff';
const GREEN = '#4caf50';
const BLACK = '#111111';
const SPARK = '#ffd54a';
// Not in the named palette: a muted grey-tan for the binocular barrels so
// they read as a distinct part from the tan chassis, and a pale tan for the
// tread notch bars so they show up against the dark steel tread housing.
const GREY_TAN = '#9c8f70';
const NOTCH = '#e9d8a4';

// A simple 3-finger claw on a short forearm, drawn from the shoulder origin
// pointing down (+y). `mirror` splays the outer fingers the other way so the
// left/right claws read as a pair rather than stamped copies.
const Claw: React.FC<{ mirror?: boolean }> = ({ mirror }) => (
  <>
    <circle cx="0" cy="0" r="18" fill={TAN} stroke={RUST} strokeWidth="5" />
    <rect x="-14" y="0" width="28" height="66" rx="14" fill={TAN} stroke={RUST} strokeWidth="4" />
    <g transform="translate(0 66)" stroke={STEEL} strokeWidth="8" strokeLinecap="round">
      <line x1="-14" y1="0" x2={mirror ? -22 : -6} y2="22" />
      <line x1="0" y1="0" x2="0" y2="26" />
      <line x1="14" y1="0" x2={mirror ? 6 : 22} y2="22" />
    </g>
  </>
);

export const RustyMascot: React.FC<RustyMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);
  // Authored transforms, captured on mount so every pose can start from them.
  const rigRef = useRef<MascotRigSnapshot | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    // GSAP's revert() leaves SVG transform residue behind (see mascotRig.ts):
    // without this the character drifts a few user units on every state
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
          .to('#char', { rotation: -12, x: -10, y: 10, svgOrigin: '150 590', duration: 0.9, ease: 'power2.inOut' })
          .to('#head', { y: 50, svgOrigin: HEAD_C, duration: 0.5, ease: 'power2.out' }, '-=0.6')
          .to('#eyes', { scaleY: 0.12, svgOrigin: '270 245', duration: 0.4, ease: 'power2.out' }, '<')
          .to('#arm-l', { rotation: 40, ...LOCAL, duration: 0.4, ease: 'power2.out' }, '<')
          .to('#arm-r', { rotation: -40, ...LOCAL, duration: 0.4, ease: 'power2.out' }, '<')
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

      // ── idle-active → NEUTRAL: head bob + lens-track tic ────────────────
      const playNeutral = () => {
        gsap.to('#head', { y: -6, svgOrigin: HEAD_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        gsap.timeline({ repeat: -1, repeatDelay: 4.5, delay: 1.2 })
          .to('#eyes', { x: -16, duration: 0.2, ease: 'power2.out' })
          .to('#head', { rotation: 6, svgOrigin: HEAD_C, duration: 0.2, ease: 'power2.out' }, '<')
          .to('#eyes', { x: 16, duration: 0.3, ease: 'power2.inOut' })
          .to('#eye-l', { scaleY: 0.55, svgOrigin: EYE_L_C, duration: 0.15, ease: 'power1.inOut' })
          .to({}, { duration: 0.6 })
          .to('#eye-l', { scaleY: 1, svgOrigin: EYE_L_C, duration: 0.15, ease: 'power1.inOut' })
          .to('#eyes', { x: 0, duration: 0.2, ease: 'power2.in' })
          .to('#head', { rotation: 0, svgOrigin: HEAD_C, duration: 0.2, ease: 'power2.in' }, '<');
      };

      // ── working → treads roll, dash laps, claws pump, hop + squash ──────
      const playRun = () => {
        // treads roll continuously: shift the notch pattern down by exactly
        // one period every tick so the clipped loop reads as seamless.
        gsap.to('#tread-notches-l, #tread-notches-r', { y: '+=40', duration: 0.4, ease: 'none', repeat: -1 });

        const tl = gsap.timeline({ repeat: -1 });
        const lap = (dir: 1 | -1) => {
          tl.to('#char', { x: 85 * dir, rotation: 8 * dir, svgOrigin: FOOT_C, duration: 0.3, ease: 'power2.inOut' })
            .to('#arm-l', { rotation: -60, ...LOCAL, duration: 0.18, ease: 'power2.inOut' }, '<')
            .to('#arm-r', { rotation: 60, ...LOCAL, duration: 0.18, ease: 'power2.inOut' }, '<')
            .to('#head', { y: -8, svgOrigin: HEAD_C, duration: 0.18, ease: 'power2.inOut' }, '<')
            .to('#arm-l', { rotation: 60, ...LOCAL, duration: 0.18, ease: 'power2.inOut' })
            .to('#arm-r', { rotation: -60, ...LOCAL, duration: 0.18, ease: 'power2.inOut' }, '<')
            .to('#head', { y: 8, svgOrigin: HEAD_C, duration: 0.18, ease: 'power2.inOut' }, '<')
            .to('#char', { x: 0, rotation: 0, svgOrigin: FOOT_C, duration: 0.3, ease: 'power2.inOut' })
            .to('#arm-l, #arm-r', { rotation: 0, ...LOCAL, duration: 0.18, ease: 'power2.inOut' }, '<')
            .to('#head', { y: 0, svgOrigin: HEAD_C, duration: 0.18, ease: 'power2.inOut' }, '<')
            // little hop and squash landing at the end of the lap
            .to('#char', { y: -20, duration: 0.15, ease: 'power2.out' })
            .to('#char', { y: 0, duration: 0.15, ease: 'power2.in' })
            .to('#char', { scaleY: 0.9, scaleX: 1.08, svgOrigin: FOOT_C, duration: 0.1, ease: 'power1.out' })
            .to('#char', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.15 });
        };
        lap(-1);
        lap(1);
      };

      // ── waiting → NEED INPUT: sign rises, sprout raised, rock ───────────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.set('#sprout', { opacity: 0 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .to('#arm-l', { rotation: -70, ...LOCAL, duration: 0.4, ease: 'back.out(1.4)' }, '<')
          .to('#sprout', { opacity: 1, duration: 0.4 }, '-=0.2')
          .to('#head', { rotation: 8, svgOrigin: HEAD_C, duration: 0.3, ease: 'power2.out' }, '<')
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // impatient rock on the base, foot-tap tempo
            gsap.fromTo('#body', { rotation: -3, svgOrigin: FOOT_C }, { rotation: 3, svgOrigin: FOOT_C, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // eyes glance up toward the sign
            gsap.to('#eyes', { y: -8, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      // ── error → X eyes, sparks, droop, dark strobe, shudder, ⚠ ──────────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap lenses → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .to('#head', { rotation: 12, y: 18, svgOrigin: HEAD_C, duration: 0.3, ease: 'power2.out' }, '-=0.2')
          .add(() => {
            // dark strobe washes the chassis
            gsap.to('#dark-tint', { opacity: 0.6, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#char', { x: 7, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -5, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // badge throb
            gsap.to('#alert', { scale: 1.15, svgOrigin: '270 -60', duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // sparks around the neck, each flickering on its own random-ish stagger
            ['#spark-1', '#spark-2', '#spark-3', '#spark-4'].forEach((sel, i) => {
              gsap.fromTo(sel, { opacity: 0 }, { opacity: 1, duration: 0.08, delay: i * 0.055, ease: 'steps(1)', repeat: -1, yoyo: true });
            });
          }, 0);
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
        <clipPath id="rusty-tread-clip-l"><rect x="100" y="470" width="100" height="130" rx="20" /></clipPath>
        <clipPath id="rusty-tread-clip-r"><rect x="340" y="470" width="100" height="130" rx="20" /></clipPath>
      </defs>

      {/* floating "zzz" for sleep (above the head) */}
      <text id="zzz" x="290" y="-10" fontFamily="ui-sans-serif, sans-serif" fontSize="140" fontStyle="italic" fontWeight="700" fill="#cfd3da" opacity="0">z z z</text>

      {/* pillow for sleep (behind him, under the left flank) */}
      <rect id="pillow" x="0" y="500" width="230" height="95" rx="44" fill="#ECE6DA" opacity="0" />

      <g id="char">
        {/* tank treads, each with a clipped scrolling notch pattern */}
        <g id="tread-l">
          <rect x="100" y="470" width="100" height="130" rx="20" fill={STEEL} />
          <g clipPath="url(#rusty-tread-clip-l)">
            <g id="tread-notches-l">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <rect key={i} x="115" y={450 + i * 40} width="70" height="14" rx="6" fill={NOTCH} />
              ))}
            </g>
          </g>
        </g>
        <g id="tread-r">
          <rect x="340" y="470" width="100" height="130" rx="20" fill={STEEL} />
          <g clipPath="url(#rusty-tread-clip-r)">
            <g id="tread-notches-r">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <rect key={i} x="355" y={450 + i * 40} width="70" height="14" rx="6" fill={NOTCH} />
              ))}
            </g>
          </g>
        </g>

        <g id="body">
          {/* boxy tan chassis with a darker front panel and two vent slots */}
          <rect x="150" y="380" width="240" height="180" rx="18" fill={TAN} stroke={RUST} strokeWidth="4" />
          <rect x="175" y="400" width="190" height="140" rx="14" fill={RUST} />
          <rect x="210" y="460" width="40" height="14" rx="6" fill={STEEL} />
          <rect x="290" y="460" width="40" height="14" rx="6" fill={STEEL} />
        </g>

        {/* thin retractable neck stem */}
        <rect id="neck" x="260" y="300" width="20" height="80" fill={STEEL} />

        {/* sparks that flicker around the neck during the fault pose */}
        <g id="sparks" stroke={SPARK} strokeWidth="6" strokeLinecap="round">
          <line id="spark-1" x1="238" y1="310" x2="252" y2="326" opacity="0" />
          <line id="spark-2" x1="302" y1="310" x2="288" y2="326" opacity="0" />
          <line id="spark-3" x1="236" y1="358" x2="252" y2="346" opacity="0" />
          <line id="spark-4" x1="304" y1="358" x2="288" y2="346" opacity="0" />
        </g>

        {/* claws, wrapped in a static translate at the shoulder so the
            authored rotate(0) inner group can be tweened about its own
            local origin (the shoulder joint) */}
        <g transform="translate(150 430)">
          <g id="arm-l" transform="rotate(0)">
            <Claw />
            {/* tiny potted sprout, raised with the claw for the waiting pose */}
            <g id="sprout" opacity="0" transform="translate(0 90)">
              <rect x="-16" y="-10" width="32" height="22" rx="4" fill={RUST} />
              <path d="M-6 -10 Q-14 -34 -2 -40" stroke={GREEN} strokeWidth="7" strokeLinecap="round" fill="none" />
              <path d="M6 -10 Q14 -30 4 -38" stroke={GREEN} strokeWidth="7" strokeLinecap="round" fill="none" />
            </g>
          </g>
        </g>
        <g transform="translate(390 430)">
          <g id="arm-r" transform="rotate(0)">
            <Claw mirror />
          </g>
        </g>

        <g id="head">
          {/* two binocular barrels, side by side */}
          <rect x="195" y="200" width="70" height="90" rx="20" fill={GREY_TAN} stroke={STEEL} strokeWidth="4" />
          <rect x="275" y="200" width="70" height="90" rx="20" fill={GREY_TAN} stroke={STEEL} strokeWidth="4" />

          <g id="eyes">
            <g id="eye-l">
              <circle cx="230" cy="245" r="26" fill={LENS} />
              <circle cx="222" cy="236" r="6" fill={LENS_GLOW} opacity="0.85" />
            </g>
            <g id="eye-r">
              <circle cx="310" cy="245" r="26" fill={LENS} />
              <circle cx="302" cy="236" r="6" fill={LENS_GLOW} opacity="0.85" />
            </g>
          </g>
          {/* X eyes for the error state (shown while #eyes is hidden) */}
          <g id="eyes-x" opacity="0" stroke={LENS_GLOW} strokeWidth="10" strokeLinecap="round">
            <line x1="210" y1="225" x2="250" y2="265" />
            <line x1="250" y1="225" x2="210" y2="265" />
            <line x1="290" y1="225" x2="330" y2="265" />
            <line x1="330" y1="225" x2="290" y2="265" />
          </g>
        </g>

        {/* dark overlay for the error strobe (same silhouette) */}
        <g id="dark-tint" fill={BLACK} opacity="0">
          <rect x="100" y="470" width="100" height="130" rx="20" />
          <rect x="340" y="470" width="100" height="130" rx="20" />
          <rect x="150" y="380" width="240" height="180" rx="18" />
          <rect x="195" y="200" width="70" height="90" rx="20" />
          <rect x="275" y="200" width="70" height="90" rx="20" />
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

import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';

// ── Clawd mascot ────────────────────────────────────────────────────────────
// An animated stand-in for the Claude Code orb. Each AgentState drives a pose,
// ported (nearly verbatim) from the hand-tuned GSAP demo in
// `clawd-svgs/clawd-actions-demo.html`:
//
//   idle         → sleeping on a pillow, drifting "zzz"
//   idle-active  → neutral stance, gentle breathing ("on, but doing nothing")
//   waiting      → waving a "need input" flag with an urgent little hop
//   working      → jog in place, then jumping jacks with dumbbells
//   error        → red strobe + glitch shudder + X-eyes + alert badge
//
// The rig is the same SVG used by the demo, but the overhead props (flag, zzz,
// alert) were nudged inward and the flag shrunk into a compact pennant so the
// whole thing fits the bubble's viewBox without clipping (the original sign ran
// far off to the right — illegible at bubble scale anyway). Prop positions are
// easy to tweak right here in the markup.
//
// All animation lives in a `gsap.context` scoped to the component's root. The
// effect re-runs on every state change; the context's `revert()` kills the old
// timelines AND clears the inline styles they set, giving us the demo's
// `resetAll()` for free with no manual loop bookkeeping.

interface ClawdMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// viewBox bounds the full character (x 0..107, y 0..86). Above (y -50..0) is
// reserved headroom for the overhead props — the waiting flag reaches y -50.
// Below, the box is padded past the character (feet at y 86 → box bottom y 108)
// so the resting character isn't crammed against the usage bar; this balances
// the gap BELOW the mascot with the reserved prop headroom ABOVE, matching the
// orb bubbles' spacing. Keep extremes in sync with the prop geometry below. The
// mascot is shrunk on-screen by scaling the bubble window + SVG px width down
// together (see MASCOT_WIDTH in Bubble.tsx and MASCOT_DIMENSIONS in
// bubble-manager.ts) — a uniform zoom-out that keeps every prop inside the
// window, so nothing clips.
const VIEW = { x: -16, y: -50, w: 158, h: 158 };
const ASPECT = VIEW.h / VIEW.w;

const LEGS = ['#leg1', '#leg2', '#leg3', '#leg4'];
const LEG_CX: Record<string, number> = { '#leg1': 16.5, '#leg2': 37.5, '#leg3': 69.5, '#leg4': 90.5 };
const RED_PARTS = ['#bdy', '#left-hand', '#right-hand', ...LEGS];
const DUMBBELLS = ['#left-dumbbell', '#right-dumbbell'];

export const ClawdMascot: React.FC<ClawdMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    const ctx = gsap.context(() => {
      // Squash legs about their FOOT (planted) vs their TOP (so the foot lifts
      // off the ground for a real step) — same helpers as the demo.
      const setLegFeet = () => LEGS.forEach((l) => gsap.set(l, { svgOrigin: `${LEG_CX[l]} 86` }));
      const setLegTops = () => LEGS.forEach((l) => gsap.set(l, { svgOrigin: `${LEG_CX[l]} 60` }));
      const show = (sel: string) => gsap.to(sel, { opacity: 1, duration: 0.4 });

      // ── idle → SLEEP ────────────────────────────────────────────────────
      const playSleep = () => {
        show('#pillow');
        gsap.timeline()
          .to('#char', { rotation: -15, x: -4, y: 4, svgOrigin: '32 86', duration: 0.9, ease: 'power2.inOut' })
          .to('#eyes', { scaleY: 0.12, svgOrigin: '53 16.5', duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .to(['#left-hand', '#right-hand'], { y: 7, duration: 0.5, ease: 'power2.out' }, '<')
          .add(() => {
            // gentle breathing
            gsap.to('#body', { scaleY: 1.05, svgOrigin: '53 65', duration: 1.6, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '40 2' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 10, y: -18, scale: 1, duration: 1.8, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.35');
          });
      };

      // ── idle-active → NEUTRAL (on, idle, no task) ───────────────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.035, svgOrigin: '53 65', duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
      };

      // ── working → RUN + WORKOUT ─────────────────────────────────────────
      const playRun = () => {
        setLegTops();
        const tl = gsap.timeline({ repeat: -1 });
        const d = 0.13;

        tl.to('#char', { rotation: 4, svgOrigin: '53 86', duration: 0.25, ease: 'power2.out' });

        for (let s = 0; s < 5; s++) {
          tl.to('#char', { y: -7, duration: d, ease: 'power1.out' })
            .to(['#leg1', '#leg3'], { scaleY: 0.5, duration: d, ease: 'power1.out' }, '<')
            .to(['#leg2', '#leg4'], { scaleY: 1, duration: d }, '<')
            .to('#left-hand', { y: -9, x: 3, duration: d }, '<')
            .to('#right-hand', { y: 9, x: -3, duration: d }, '<')
            .to('#char', { y: 0, duration: d, ease: 'power1.in' })
            .to(['#leg1', '#leg3'], { scaleY: 1, duration: d }, '<')
            .to(['#leg2', '#leg4'], { scaleY: 0.5, duration: d }, '<')
            .to('#left-hand', { y: 9, x: -3, duration: d }, '<')
            .to('#right-hand', { y: -9, x: 3, duration: d }, '<');
        }

        tl.to(LEGS, { scaleY: 1, duration: 0.15 })
          .to(['#left-hand', '#right-hand'], { x: 0, y: 0, duration: 0.15 }, '<')
          .to('#char', { rotation: 0, duration: 0.2 }, '<')
          .to(DUMBBELLS, { opacity: 1, duration: 0.2 }, '<')
          .to({}, { duration: 0.25 });

        const j = 0.2;
        const leftArm = ['#left-hand', '#left-dumbbell'];
        const rightArm = ['#right-hand', '#right-dumbbell'];
        const bothArms = [...leftArm, ...rightArm];
        for (let r = 0; r < 4; r++) {
          tl.to('#char', { y: -10, duration: j, ease: 'power2.out' })
            .to(leftArm, { x: -11, y: -24, duration: j }, '<')
            .to(rightArm, { x: 11, y: -24, duration: j }, '<')
            .to('#leg1', { x: -9, duration: j }, '<')
            .to('#leg2', { x: -3, duration: j }, '<')
            .to('#leg3', { x: 3, duration: j }, '<')
            .to('#leg4', { x: 9, duration: j }, '<')
            .to('#char', { y: 0, duration: j, ease: 'power2.in' })
            .to(bothArms, { x: 0, y: 0, duration: j }, '<')
            .to(LEGS, { x: 0, duration: j }, '<');
        }
        tl.to(DUMBBELLS, { opacity: 0, duration: 0.2 }).to({}, { duration: 0.4 });
      };

      // ── waiting → NEED HELP (wave the flag) ─────────────────────────────
      const playHelp = () => {
        show('#flag');
        gsap.timeline()
          .to('#right-hand', { x: 6, y: -6, duration: 0.4, ease: 'power2.out' })
          .to('#char', { y: -2, duration: 0.25, ease: 'power2.out' }, '<')
          .add(() => {
            gsap.fromTo('#flag', { rotation: -7, svgOrigin: '100 26' }, { rotation: 7, svgOrigin: '100 26', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -6, duration: 0.45, ease: 'power1.inOut', repeat: -1, yoyo: true });
            gsap.to('#eyes', { scaleY: 0.2, svgOrigin: '53 16.5', duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true, repeatDelay: 1.3 });
          });
      };

      // ── error → ALERT + strobe + glitch + X-eyes ────────────────────────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 });
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '53 -22' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' })
          .add(() => {
            gsap.to(RED_PARTS, { fill: '#E5484D', duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            gsap.to('#char', { x: 2.5, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -1.5, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            gsap.fromTo('#body', { rotation: -5, svgOrigin: '53 65' }, { rotation: 5, svgOrigin: '53 65', duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true });
            gsap.to('#alert', { scale: 1.15, svgOrigin: '53 -22', duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      switch (state) {
        case 'idle': playSleep(); break;
        case 'idle-active': playNeutral(); break;
        case 'waiting': playHelp(); break;
        case 'working': playRun(); break;
        case 'error': playError(); break;
      }
      void setLegFeet; // reserved (foot-planted squash) — kept to mirror the demo helpers
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
      {/* floating "zzz" for sleep */}
      <text id="zzz" x="34" y="6" fontFamily="ui-sans-serif, sans-serif" fontSize="30" fontStyle="italic" fontWeight="700" fill="#cfd3da" opacity="0">z z z</text>

      {/* pillow for sleep (behind clawd) */}
      <rect id="pillow" x="-12" y="60" width="60" height="24" rx="11" fill="#ECE6DA" opacity="0" />

      <g id="char">
        <g clipPath="url(#clawd-ground-clip)">
          <rect id="leg4" x="85" y="60" width="11" height="26" fill="#DD775B" />
          <rect id="leg3" x="64" y="60" width="11" height="26" fill="#DD775B" />
          <rect id="leg2" x="32" y="60" width="11" height="26" fill="#DD775B" />
          <rect id="leg1" x="11" y="60" width="11" height="26" fill="#DD775B" />
        </g>
        <g id="body">
          <rect id="bdy" x="11" y="0" width="85" height="65" fill="#DD775B" />
          <rect id="right-hand" x="85" y="21" width="22" height="23" fill="#DD775B" />
          <rect id="left-hand" x="0" y="21" width="22" height="23" fill="#DD775B" />
          {/* dumbbells for the workout (hidden until the jumping-jacks phase) */}
          <g id="left-dumbbell" opacity="0">
            <rect x="1" y="31" width="20" height="4" rx="2" fill="#8A8A8A" />
            <rect x="-3" y="26" width="7" height="14" rx="2" fill="#454545" />
            <rect x="18" y="26" width="7" height="14" rx="2" fill="#454545" />
          </g>
          <g id="right-dumbbell" opacity="0">
            <rect x="86" y="31" width="20" height="4" rx="2" fill="#8A8A8A" />
            <rect x="82" y="26" width="7" height="14" rx="2" fill="#454545" />
            <rect x="103" y="26" width="7" height="14" rx="2" fill="#454545" />
          </g>
          <g id="eyes">
            <rect id="left-eyes" x="75" y="11" width="11" height="11" fill="black" />
            <rect id="right-eyes" x="21" y="11" width="11" height="11" fill="black" />
          </g>
          {/* X eyes for the error state (shown while #eyes is hidden) */}
          <g id="eyes-x" opacity="0" stroke="#1A1A1A" strokeWidth="3" strokeLinecap="round">
            <line x1="75" y1="11" x2="86" y2="22" />
            <line x1="86" y1="11" x2="75" y2="22" />
            <line x1="21" y1="11" x2="32" y2="22" />
            <line x1="32" y1="11" x2="21" y2="22" />
          </g>
        </g>

        {/* "need input" sign, held in the right hand */}
        <g id="flag" opacity="0">
          <rect id="flag-pole" x="99" y="-48" width="3" height="76" rx="1.5" fill="#5D5B56" />
          <rect id="flag-sign" x="101" y="-50" width="48" height="32" rx="5" fill="#FBF7EF" stroke="#D9CFC0" strokeWidth="1" />
          <text x="125" y="-38" textAnchor="middle" fontFamily="ui-sans-serif, sans-serif" fontSize="11" fontWeight="700" fill="#3A3530">
            <tspan x="125" dy="0">Need</tspan>
            <tspan x="125" dy="13">input</tspan>
          </text>
        </g>

        {/* warning badge for the error state (triangle + "!"), pops above the head */}
        <g id="alert" opacity="0">
          <path d="M53 -38 L68 -12 L38 -12 Z" fill="#E5484D" stroke="#FFFFFF" strokeWidth="2" strokeLinejoin="round" />
          <rect x="51.5" y="-31" width="3" height="11" rx="1.5" fill="#FFFFFF" />
          <rect x="51.5" y="-17" width="3" height="3" rx="1.5" fill="#FFFFFF" />
        </g>
      </g>

      <defs>
        <clipPath id="clawd-ground-clip"><rect x="-20" y="-50" width="160" height="146" /></clipPath>
      </defs>
    </svg>
  );
};

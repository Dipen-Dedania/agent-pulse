import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Byte mascot ─────────────────────────────────────────────────────────────
// An original, hand-drawn round yellow chomper in the spirit of a certain
// arcade dot-eater. The whole body is a single disc split into two half-disc
// "jaws" (#jaw-top, #jaw-bot) that rotate opposite ways about the disc's own
// centre to open a wedge mouth — no separate face parts, everything reads
// through the jaw angle. Each AgentState drives a pose:
//
//   idle         → jaws close shut, one eye shuts, tips onto a pillow, "zzz"
//   idle-active  → slow breathing, plus a periodic lazy chomp (a wide snap
//                  open and back) every few seconds
//   waiting      → "need input" sign rises, restless hop with the eye
//                  glancing up at the sign, mouth kept small
//   working      → the signature move: a fast continuous chomp while dashing
//                  right in steps, gobbling a row of pellets one at a time,
//                  then snapping back with a squash to loop
//   error        → the classic collapse: the jaws whirl almost all the way
//                  around and pop back, X eye, ⚠ badge, grey strobe tint,
//                  glitch shudder
//
// The rig shares Merc/Ghost's coordinate space and prop geometry (pillow, zzz,
// sign, badge all sit where theirs do), so it drops into the same window
// footprint without retuning. Every animated part pivots at its own local
// origin: the jaws and disc-based tweens always pass an explicit `svgOrigin`
// (rather than relying on an authored `transform` surviving a GSAP revert),
// and plain position nudges (eye slides, hops, shudder) need no origin at all.
//
// All animation lives in a `gsap.context` scoped to the component's root and
// reverted on every state change; `resetMascotRig` puts the authored
// transforms back first (see mascotRig.ts for why that matters here: the jaw
// groups carry an authored `rotate(...)` at rest, and GSAP's revert does not
// reliably unwind that SVG transform attribute on its own).

interface ByteMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Merc/Ghost: character spans x ≈ 90..450, y ≈ 40..590
// (base line y 590). Headroom above (y -200..0) holds the sign, zzz and
// badge; the pellet row runs off to the right during the working dash.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const BODY_C = '270 400'; // disc centre — every jaw rotation pivots here
const FOOT_C = '270 590'; // base of the disc (squash / hop / breathing pivot)
const EYE_C = '300 300'; // the single eye's own pivot

const YELLOW = '#f5c400';
const SHADE = '#d9a600';
const EYE_DARK = '#1f1f1f';
const PELLET = '#fbe7a3';

// Two half-disc paths sharing the same centre and radius (190). Each is drawn
// centre → rim point → arc over one side → rim point → back to centre, so it
// reads as a solid "D" shape. At rest jaw-top sits at rotate(-8) and jaw-bot
// at rotate(8): rotating them apart peels a wedge open on the right (where
// both meet at 0°) while the left (180°) overlaps harmlessly, exactly like a
// classic dot-eater's mouth.
const JAW_TOP_D = 'M270 400 L80 400 A190 190 0 0 1 460 400 Z';
const JAW_BOT_D = 'M270 400 L460 400 A190 190 0 0 1 80 400 Z';

export const ByteMascot: React.FC<ByteMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);
  // Authored transforms, captured on mount so every pose can start from them.
  const rigRef = useRef<MascotRigSnapshot | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    // See mascotRig.ts: GSAP's revert() doesn't reliably unwind the SVG
    // transform attribute, so the jaws' authored rest rotation (±8°) would
    // drift on every state change without this reset.
    if (!rigRef.current) rigRef.current = snapshotMascotRig(rootRef.current);
    resetMascotRig(rigRef.current);

    const ctx = gsap.context(() => {
      const show = (sel: string) => gsap.to(sel, { opacity: 1, duration: 0.4 });

      // ── idle → SLEEP ────────────────────────────────────────────────────
      const playSleep = () => {
        show('#pillow');
        gsap.timeline()
          .to('#char', { rotation: -12, x: -10, svgOrigin: '150 590', duration: 0.9, ease: 'power2.inOut' })
          .to('#eye-l', { scaleY: 0.12, svgOrigin: EYE_C, duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .to('#jaw-top', { rotation: 0, svgOrigin: BODY_C, duration: 0.4, ease: 'power2.out' }, '<')
          .to('#jaw-bot', { rotation: 0, svgOrigin: BODY_C, duration: 0.4, ease: 'power2.out' }, '<')
          .add(() => {
            // slow breathing from the base
            gsap.to('#body', { scaleY: 1.03, scaleX: 1.012, svgOrigin: FOOT_C, duration: 1.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop (copied from Merc)
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '350 -60' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 45, y: -80, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → NEUTRAL + lazy chomp tic ──────────────────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        // Every few seconds: the eye slides out, the jaws snap wide open for
        // a beat, then everything eases back to rest.
        gsap.timeline({ repeat: -1, repeatDelay: 4.5, delay: 1.2 })
          .to('#eye-l', { x: 14, duration: 0.25, ease: 'power2.out' })
          .to('#jaw-top', { rotation: -40, svgOrigin: BODY_C, duration: 0.2, ease: 'power2.out' }, '<')
          .to('#jaw-bot', { rotation: 40, svgOrigin: BODY_C, duration: 0.2, ease: 'power2.out' }, '<')
          .to({}, { duration: 0.55 })
          .to('#jaw-top', { rotation: -8, svgOrigin: BODY_C, duration: 0.2, ease: 'power2.in' })
          .to('#jaw-bot', { rotation: 8, svgOrigin: BODY_C, duration: 0.2, ease: 'power2.in' }, '<')
          .to('#eye-l', { x: 0, duration: 0.2, ease: 'power2.in' }, '<');
      };

      // ── working → CHOMP & DASH: gobble a row of pellets, loop ───────────
      const playChomp = () => {
        gsap.set(['#dot-1', '#dot-2', '#dot-3', '#dot-4', '#dot-5'], { opacity: 1 });

        // Fast continuous chomp, independent of the dash cycle below.
        gsap.fromTo('#jaw-top', { rotation: -38, svgOrigin: BODY_C }, { rotation: -6, svgOrigin: BODY_C, duration: 0.11, ease: 'power1.inOut', repeat: -1, yoyo: true });
        gsap.fromTo('#jaw-bot', { rotation: 38, svgOrigin: BODY_C }, { rotation: 6, svgOrigin: BODY_C, duration: 0.11, ease: 'power1.inOut', repeat: -1, yoyo: true });

        const dots = ['#dot-1', '#dot-2', '#dot-3', '#dot-4', '#dot-5'];
        const tl = gsap.timeline({ repeat: -1 });
        // Five dash steps of 60 units each; the pellet the mouth is passing
        // fades out exactly as that step lands.
        dots.forEach((dot, i) => {
          tl.to('#char', { x: (i + 1) * 60, duration: 0.22, ease: 'power2.inOut' })
            .to(dot, { opacity: 0, duration: 0.08 }, '<0.14');
        });
        // Snap back home with a quick squash, then the row refills.
        tl.to('#char', { x: 0, scaleY: 0.9, scaleX: 1.08, svgOrigin: FOOT_C, duration: 0.12, ease: 'power2.out' })
          .to('#char', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.16, ease: 'power1.out' })
          .to(dots, { opacity: 1, duration: 0.25 }, '-=0.1')
          .to({}, { duration: 0.3 });
      };

      // ── waiting → NEED INPUT (sign rises, restless hop, glance up) ──────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 3, svgOrigin: FOOT_C, duration: 0.3, ease: 'power2.out' })
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .add(() => {
            // gentle sway of the sign about the pole base — same pivot as Merc
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // restless hop in place, foot-tap tempo
            gsap.to('#char', { y: -18, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // eye glances up toward the sign on each hop
            gsap.to('#eye-l', { x: 10, y: -8, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // mouth kept small (barely open) instead of the resting ±8
            gsap.to('#jaw-top', { rotation: -4, svgOrigin: BODY_C, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
            gsap.to('#jaw-bot', { rotation: 4, svgOrigin: BODY_C, duration: 0.35, ease: 'sine.inOut', repeat: -1, yoyo: true });
          });
      };

      // ── error → the classic collapse + glitch + X-eye + ⚠ ───────────────
      const playFault = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap the lens → X eye
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.set('#dark-tint', { opacity: 0 });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .add(() => {
            // the jaws whirl almost all the way around so the disc seems to
            // vanish, then pop back to the rest angle with an overshoot
            gsap.timeline({ repeat: -1, repeatDelay: 0.6 })
              .to('#jaw-top', { rotation: -178, svgOrigin: BODY_C, duration: 0.7, ease: 'power2.in' })
              .to('#jaw-bot', { rotation: 178, svgOrigin: BODY_C, duration: 0.7, ease: 'power2.in' }, '<')
              .to('#jaw-top', { rotation: -8, svgOrigin: BODY_C, duration: 0.4, ease: 'back.out(2)' })
              .to('#jaw-bot', { rotation: 8, svgOrigin: BODY_C, duration: 0.4, ease: 'back.out(2)' }, '<');
            // grey strobe over the whole disc silhouette
            gsap.to('#dark-tint', { opacity: 0.55, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
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
        case 'working': playChomp(); break;
        case 'error': playFault(); break;
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

      {/* pillow for sleep (behind him, under the left flank) */}
      <rect id="pillow" x="0" y="500" width="230" height="95" rx="44" fill="#ECE6DA" opacity="0" />

      <g id="char">
        <g id="body">
          {/* empty wrapper: the two jaws below are the whole "head" */}
          <g id="head">
            {/* upper half-disc; rest angle -8° opens the mouth's top lip */}
            <g id="jaw-top" transform="rotate(-8 270 400)">
              <path d={JAW_TOP_D} fill={YELLOW} />
              {/* single dark eye, riding the jaw so it swings with the chomp */}
              <g id="eyes" fill={EYE_DARK}>
                <circle id="eye-l" cx="300" cy="300" r="20" />
              </g>
              {/* X eye for the error state (shown while #eyes is hidden) */}
              <g id="eyes-x" opacity="0" stroke={EYE_DARK} strokeWidth="8" strokeLinecap="round">
                <line x1="286" y1="286" x2="314" y2="314" />
                <line x1="314" y1="286" x2="286" y2="314" />
              </g>
            </g>
            {/* lower half-disc; rest angle +8° opens the mouth's bottom lip */}
            <g id="jaw-bot" transform="rotate(8 270 400)">
              <path d={JAW_BOT_D} fill={SHADE} />
            </g>
          </g>

          {/* grey overlay for the error strobe (same disc silhouette) */}
          <g id="dark-tint" fill="#5a5a5a" opacity="0">
            <circle cx="270" cy="400" r="190" />
          </g>
        </g>

        {/* pellet row gobbled during the working dash */}
        <g id="dots">
          <circle id="dot-1" cx="490" cy="400" r="14" fill={PELLET} opacity="0" />
          <circle id="dot-2" cx="550" cy="400" r="14" fill={PELLET} opacity="0" />
          <circle id="dot-3" cx="610" cy="400" r="14" fill={PELLET} opacity="0" />
          <circle id="dot-4" cx="670" cy="400" r="14" fill={PELLET} opacity="0" />
          <circle id="dot-5" cx="730" cy="400" r="14" fill={PELLET} opacity="0" />
        </g>

        {/* "need input" sign, planted beside his right flank — copied from Merc */}
        <g id="flag" opacity="0">
          <rect id="flag-pole" x="470" y="-175" width="14" height="345" rx="7" fill="#5D5B56" />
          <rect id="flag-sign" x="482" y="-185" width="218" height="145" rx="22" fill="#FBF7EF" stroke="#D9CFC0" strokeWidth="5" />
          <text x="591" y="-128" textAnchor="middle" fontFamily="ui-sans-serif, sans-serif" fontSize="50" fontWeight="700" fill="#3A3530">
            <tspan x="591" dy="0">Need</tspan>
            <tspan x="591" dy="58">input</tspan>
          </text>
        </g>

        {/* warning badge for the error state (triangle + "!"), pops above the head — copied from Merc */}
        <g id="alert" opacity="0">
          <path d="M270 -105 L318 -20 L222 -20 Z" fill="#E5484D" stroke="#FFFFFF" strokeWidth="6" strokeLinejoin="round" />
          <rect x="265" y="-80" width="10" height="36" rx="5" fill="#FFFFFF" />
          <rect x="265" y="-36" width="10" height="10" rx="5" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
};

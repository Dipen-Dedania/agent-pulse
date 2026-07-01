import React, { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';

// ── Codex frog mascot ─────────────────────────────────────────────────────────
// An animated stand-in for the OpenAI Codex orb. Each AgentState drives a pose,
// ported (nearly verbatim) from the hand-tuned GSAP demo in
// `clawd-svgs/openai-actions-demo.html`:
//
//   idle         → leaning on a pillow, eyes shut, drifting "zzz"
//   idle-active  → neutral stance, gentle breathing ("on, but doing nothing")
//   waiting      → raising a "need input" sign and waving it with an urgent hop
//   working      → hopping in place, then jumping jacks (frogs hop, so it reads)
//   error        → red strobe (multiply overlay) + glitch shudder + X-eyes + alert
//
// The rig is the same illustrative frog SVG used by the demo, but the overhead
// props (sign, zzz, alert) were nudged inward and the sign shrunk into a compact
// placard so the whole thing fits the bubble's viewBox without clipping (the
// original sign ran far off to the right). Prop positions are easy to tweak
// right here in the markup.
//
// All animation lives in a `gsap.context` scoped to the component's root. The
// effect re-runs on every state change; the context's `revert()` kills the old
// timelines AND clears the inline styles they set, giving us the demo's
// `resetAll()` for free with no manual loop bookkeeping.

interface CodexMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// viewBox bounds the full frog (x ~14..182, y ~36..222 incl. hind legs). Above
// (y -30..36) is reserved headroom for the alert badge (up to y -18) and side
// room for the held sign (out to x ~206). Below, the box is padded past the feet
// (y 222 → box bottom y 256) so the resting frog isn't crammed against the usage
// bar; this balances the gap BELOW the mascot with the reserved prop headroom
// ABOVE, matching the orb bubbles' spacing. Keep extremes in sync with the prop
// geometry below. The mascot is shrunk on-screen by scaling the bubble window +
// SVG px width down together (see MASCOT_WIDTH_CODEX in Bubble.tsx and
// MASCOT_DIMENSIONS_CODEX in bubble-manager.ts) — a uniform zoom-out that keeps
// every prop inside the window, so nothing clips.
const VIEW = { x: -16, y: -30, w: 224, h: 286 };
const ASPECT = VIEW.h / VIEW.w;

const LEGS = ['#leg-left', '#leg-right'];

export const CodexMascot: React.FC<CodexMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    const ctx = gsap.context(() => {
      // Shoulders the forelimbs rotate about, so each arm's root stays buried
      // in the body when it swings up (jumping jacks / raising the sign).
      const setArmPivots = () => {
        gsap.set('#left-hand', { svgOrigin: '50 102' });
        gsap.set('#right-hand', { svgOrigin: '150 102' });
      };
      const show = (sel: string) => gsap.to(sel, { opacity: 1, duration: 0.4 });

      // ── idle → SLEEP ────────────────────────────────────────────────────
      const playSleep = () => {
        show('#pillow');
        gsap.timeline()
          .to('#frog-char', { rotation: -13, x: -6, y: 6, svgOrigin: '70 196', duration: 0.9, ease: 'power2.inOut' })
          .to('#eyes', { scaleY: 0.1, svgOrigin: '84 58', duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .add(() => {
            // gentle breathing (whole body swells from the seated base)
            gsap.to('#body', { scaleY: 1.035, svgOrigin: '100 196', duration: 1.7, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '134 28' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 12, y: -22, scale: 1, duration: 1.9, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.4');
          });
      };

      // ── idle-active → NEUTRAL (on, idle, no task) ───────────────────────
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.03, svgOrigin: '100 196', duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
      };

      // ── working → HOP + WORKOUT ─────────────────────────────────────────
      const playRun = () => {
        setArmPivots();
        // squash each hind leg from its planted foot (bottom of its bbox)
        LEGS.forEach((l) => gsap.set(l, { transformOrigin: '50% 100%' }));
        const tl = gsap.timeline({ repeat: -1 });
        const d = 0.16;

        // Hops: crouch → leap → land. Frogs hop, so this reads better than a jog.
        for (let s = 0; s < 4; s++) {
          tl.to('#frog-char', { y: 8, duration: d * 0.7, ease: 'power1.in' })
            .to(LEGS, { scaleY: 0.66, duration: d * 0.7 }, '<')
            .to('#frog-char', { y: -28, duration: d, ease: 'power2.out' })
            .to(LEGS, { scaleY: 1.14, duration: d }, '<')
            .to('#frog-char', { y: 0, duration: d, ease: 'power2.in' })
            .to(LEGS, { scaleY: 1, duration: d }, '<');
        }
        tl.to({}, { duration: 0.2 });

        // Jumping jacks: hop, arms swing up & out (rotated about the shoulders),
        // legs spread.
        const j = 0.22;
        for (let r = 0; r < 4; r++) {
          tl.to('#frog-char', { y: -16, duration: j, ease: 'power2.out' })
            .to('#left-hand', { rotation: 140, duration: j }, '<')
            .to('#right-hand', { rotation: -140, duration: j }, '<')
            .to('#leg-left', { x: -10, duration: j }, '<')
            .to('#leg-right', { x: 10, duration: j }, '<')
            .to('#frog-char', { y: 0, duration: j, ease: 'power2.in' })
            .to(['#left-hand', '#right-hand'], { rotation: 0, duration: j }, '<')
            .to(LEGS, { x: 0, duration: j }, '<');
        }
        tl.to({}, { duration: 0.4 }); // brief beat before the loop repeats
      };

      // ── waiting → NEED HELP (raise a sign and wave it) ──────────────────
      const playHelp = () => {
        setArmPivots();
        gsap.timeline()
          .to('#right-hand', { rotation: -120, duration: 0.5, ease: 'power2.out' }) // swing the arm up
          .to('#frog-char', { y: -2, duration: 0.25, ease: 'power2.out' }, '<')
          .add(() => show('#flag'), '-=0.25')
          .add(() => {
            // gentle sway of the sign about the hand's grip (soft enough to keep text readable)
            gsap.fromTo('#flag', { rotation: -6, svgOrigin: '152 104' }, { rotation: 6, svgOrigin: '152 104', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // urgent hop
            gsap.to('#frog-char', { y: -7, duration: 0.45, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // occasional worried blink
            gsap.to('#eyes', { scaleY: 0.18, svgOrigin: '84 58', duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true, repeatDelay: 1.3 });
          });
      };

      // ── error → ALERT + red strobe + glitch + X-eyes ────────────────────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 });   // swap normal eyes → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '100 0' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' })  // badge pops in
          .add(() => {
            // red strobe over the whole body (multiply overlay fading in/out)
            gsap.to('#red-tint', { opacity: 0.7, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#frog-char', { x: 3, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#frog-char', { y: -2, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // sharp "no" head-shake
            gsap.fromTo('#body', { rotation: -4, svgOrigin: '100 130' }, { rotation: 4, svgOrigin: '100 130', duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // badge throb to keep drawing the eye
            gsap.to('#alert', { scale: 1.15, svgOrigin: '100 0', duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true });
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
        {/* body: dark olive back (upper-right) → warmer pale green toward the belly */}
        <linearGradient id="codex-bodyGrad" x1="172" y1="56" x2="40" y2="196" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3f4a30" />
          <stop offset=".45" stopColor="#5e6d44" />
          <stop offset="1" stopColor="#7e8a58" />
        </linearGradient>
        <radialGradient id="codex-headHi" cx="92" cy="50" r="78" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8a9760" stopOpacity=".55" />
          <stop offset="1" stopColor="#8a9760" stopOpacity="0" />
        </radialGradient>
        {/* pale throat / belly */}
        <radialGradient id="codex-bellyGrad" cx="60" cy="166" r="70" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#bcc296" />
          <stop offset=".55" stopColor="#a7ae80" />
          <stop offset="1" stopColor="#8a986a" />
        </radialGradient>
        {/* eye bulges */}
        <radialGradient id="codex-lidGrad" cx="0" cy="0" r="1"
          gradientTransform="translate(56 56) rotate(90) scale(24)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8c996090" />
          <stop offset=".6" stopColor="#76845a" />
          <stop offset="1" stopColor="#566445" />
        </radialGradient>
        {/* amber iris */}
        <radialGradient id="codex-irisGrad" cx="0" cy="0" r="1"
          gradientTransform="translate(63 60) rotate(90) scale(16)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d8cd76" />
          <stop offset=".55" stopColor="#bdab4c" />
          <stop offset="1" stopColor="#8a7a2c" />
        </radialGradient>
        <radialGradient id="codex-irisGrad2" cx="0" cy="0" r="1"
          gradientTransform="translate(114 52) rotate(90) scale(17)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#d8cd76" />
          <stop offset=".55" stopColor="#bdab4c" />
          <stop offset="1" stopColor="#8a7a2c" />
        </radialGradient>
      </defs>

      {/* floating "zzz" for sleep (near the head) */}
      <text id="zzz" x="128" y="30" fontFamily="ui-sans-serif, sans-serif" fontSize="30"
        fontStyle="italic" fontWeight="700" fill="#cfd3da" opacity="0">z z z</text>

      {/* pillow for sleep (behind the frog) */}
      <rect id="pillow" x="-12" y="170" width="96" height="34" rx="17" fill="#ECE6DA" opacity="0" />

      <g id="frog-char">
        {/* hind legs: thin, splayed, with small sideways webbed feet (behind the body) */}
        <g id="leg-left" fill="#677648">
          <path d="M 74 184 C 66 194, 58 204, 56 214 C 58 217, 64 217, 66 214 C 70 204, 78 194, 82 186 C 80 183, 76 182, 74 184 Z" />
          <path d="M 62 210 C 50 210, 40 214, 36 219 C 40 220, 44 222, 47 220 C 49 222, 53 222, 55 220 C 57 222, 61 221, 63 219 C 66 216, 66 211, 62 210 Z" />
        </g>
        <g id="leg-right" fill="#5e6c42">
          <path d="M 118 184 C 126 194, 134 204, 136 214 C 134 217, 128 217, 126 214 C 122 204, 114 194, 110 186 C 112 183, 116 182, 118 184 Z" />
          <path d="M 130 210 C 142 210, 152 214, 156 219 C 152 220, 148 222, 145 220 C 143 222, 139 222, 137 220 C 135 222, 131 221, 129 219 C 126 216, 126 211, 130 210 Z" />
        </g>

        <g id="body">
          {/* main body silhouette (head + torso in one organic mass) */}
          <path id="silhouette" fill="url(#codex-bodyGrad)"
            d="M 18 98
               C 14 82, 18 64, 34 52
               C 44 44, 56 44, 66 52
               C 76 44, 92 36, 112 38
               C 138 40, 158 52, 170 80
               C 182 104, 182 132, 174 156
               C 166 178, 148 190, 122 195
               C 96 200, 66 199, 44 190
               C 28 183, 20 166, 22 144
               C 23 128, 20 116, 18 104
               C 17 101, 17 100, 18 98 Z" />
          {/* soft dome highlight */}
          <path fill="url(#codex-headHi)"
            d="M 18 98 C 14 82, 18 64, 34 52 C 44 44, 56 44, 66 52 C 76 44, 92 36, 112 38
               C 138 40, 158 52, 170 80 C 178 96, 180 112, 178 126 C 150 150, 60 150, 30 120
               C 22 112, 18 104, 18 98 Z" />
          {/* painterly back mottling (subtle darker blots, upper-right) */}
          <ellipse cx="150" cy="92" rx="20" ry="26" fill="#3a4530" opacity=".35" />
          <ellipse cx="128" cy="68" rx="16" ry="14" fill="#3a4530" opacity=".25" />

          {/* pale throat / belly */}
          <path id="belly" fill="url(#codex-bellyGrad)"
            d="M 30 150
               C 26 130, 30 114, 44 106
               C 60 98, 84 102, 96 120
               C 105 133, 106 162, 97 182
               C 87 196, 52 196, 40 184
               C 32 176, 31 162, 30 150 Z" />

          {/* folded forelimbs resting on the belly (slender, 3-fingered). Each arm is rooted at a
               shoulder buried in the body; animations ROTATE the arm about that shoulder so the root
               stays attached (origins: left ≈ 50,102 · right ≈ 150,102). */}
          <g id="left-hand" fill="#6a784c">
            <path d="M 44 100 C 40 122, 50 144, 66 154 C 70 157, 76 156, 76 150
                     C 64 142, 58 122, 56 102 C 55 97, 46 96, 44 100 Z" />
            <g stroke="#6a784c" strokeWidth="6" strokeLinecap="round">
              <path d="M 70 153 L 66 164" />
              <path d="M 73 152 L 74 165" />
              <path d="M 76 151 L 82 161" />
            </g>
          </g>
          <g id="right-hand" fill="#62714a">
            <path d="M 156 100 C 160 122, 150 144, 134 154 C 130 157, 124 156, 124 150
                     C 136 142, 142 122, 144 102 C 145 97, 154 96, 156 100 Z" />
            <g stroke="#62714a" strokeWidth="6" strokeLinecap="round">
              <path d="M 130 153 L 134 164" />
              <path d="M 127 152 L 126 165" />
              <path d="M 124 151 L 118 161" />
            </g>
          </g>

          {/* nostril + neutral frog mouth (slight downturn at the corner) */}
          <g id="face">
            <ellipse cx="33" cy="80" rx="2.4" ry="1.8" fill="#2f3722" />
            <path id="mouth" d="M 64 96 C 48 99, 33 99, 24 95" stroke="#2f3722" strokeWidth="3"
              fill="none" strokeLinecap="round" />
            <path d="M 24 95 C 21 97, 21 100, 24 101" stroke="#2f3722" strokeWidth="3"
              fill="none" strokeLinecap="round" />
          </g>

          {/* eye bulges (raised mounds on top of the head) */}
          <ellipse cx="58" cy="60" rx="25" ry="23" fill="url(#codex-lidGrad)" />
          <ellipse cx="112" cy="52" rx="27" ry="25" fill="url(#codex-lidGrad)" />
          {/* heavy-lid / brow shadow crescents on the upper-back of each bulge */}
          <path d="M 44 56 C 47 46, 73 46, 77 56 C 69 51, 51 51, 44 56 Z" fill="#3a4530" opacity=".55" />
          <path d="M 96 49 C 100 38, 128 38, 132 49 C 122 44, 106 44, 96 49 Z" fill="#34402b" opacity=".55" />

          {/* eyeballs (pupils high & forward → looking up to the right) */}
          <g id="eyes">
            <g>
              <circle cx="60" cy="62" r="15.5" fill="url(#codex-irisGrad)" />
              <circle cx="63" cy="59" r="7" fill="#191c10" />
              <circle cx="66" cy="55" r="2.5" fill="#fdfdf0" />
            </g>
            <g>
              <circle cx="113" cy="54" r="17" fill="url(#codex-irisGrad2)" />
              <circle cx="117" cy="51" r="7.5" fill="#191c10" />
              <circle cx="121" cy="47" r="2.7" fill="#fdfdf0" />
            </g>
          </g>

          {/* X eyes for the error state (shown while #eyes is hidden) */}
          <g id="eyes-x" opacity="0" stroke="#191c10" strokeWidth="4" strokeLinecap="round">
            <line x1="49" y1="51" x2="71" y2="73" />
            <line x1="71" y1="51" x2="49" y2="73" />
            <line x1="101" y1="43" x2="125" y2="65" />
            <line x1="125" y1="43" x2="101" y2="65" />
          </g>

          {/* red overlay for the error strobe (matches the silhouette, multiply blend) */}
          <path id="red-tint" opacity="0" fill="#E5484D" style={{ mixBlendMode: 'multiply' }}
            d="M 18 98
               C 14 82, 18 64, 34 52
               C 44 44, 56 44, 66 52
               C 76 44, 92 36, 112 38
               C 138 40, 158 52, 170 80
               C 182 104, 182 132, 174 156
               C 166 178, 148 190, 122 195
               C 96 200, 66 199, 44 190
               C 28 183, 20 166, 22 144
               C 23 128, 20 116, 18 104
               C 17 101, 17 100, 18 98 Z" />
        </g>

        {/* "waiting for your input" sign (pole + placard), raised by the right hand.
            Nudged inward from the demo so it fits the bubble viewBox. */}
        <g id="flag" opacity="0">
          <rect id="flag-pole" x="150" y="20" width="3.5" height="86" rx="1.75" fill="#5D5B56" />
          <rect id="flag-sign" x="148" y="14" width="58" height="30" rx="4"
            fill="#FBF7EF" stroke="#D9CFC0" strokeWidth="1" />
          <text x="177" y="27" textAnchor="middle"
            fontFamily="ui-sans-serif, sans-serif" fontSize="8" fontWeight="700" fill="#3A3530">
            <tspan x="177" dy="0">Waiting for</tspan>
            <tspan x="177" dy="10">your input</tspan>
          </text>
        </g>

        {/* warning badge for the error state (triangle + "!"), pops above the head */}
        <g id="alert" opacity="0">
          <path d="M100 -18 L118 14 L82 14 Z" fill="#E5484D" stroke="#FFFFFF" strokeWidth="2.5" strokeLinejoin="round" />
          <rect x="98" y="-8" width="4" height="14" rx="2" fill="#FFFFFF" />
          <rect x="98" y="9" width="4" height="4" rx="2" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
};

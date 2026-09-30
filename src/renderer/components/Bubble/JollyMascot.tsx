import React, { useEffect, useId, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';
import { MascotRigSnapshot, resetMascotRig, snapshotMascotRig } from './mascotRig';

// ── Jolly mascot ────────────────────────────────────────────────────────────
// An original, hand-drawn take on Muse Code's fluffy plush companion: one
// continuous cream silhouette (no neck, no ears — the head dome flows straight
// into a wide belly), a smooth inset face patch with tiny beady eyes, pink
// cheeks and a small smile, thick mitten arms, two stumpy legs, a blue
// scribbled "M" on the belly, and a pair of cat-eye sunglasses it puts on when
// it gets down to work. Each AgentState drives a pose:
//
//   idle         → slumped onto a pillow, eyes shut, cheeks fade, drifting "zzz"
//   idle-active  → breathing, a blink now and then, one paw lifts to adjust the
//                  (absent) shades — the signature hand-to-face gesture
//   waiting      → arms spread wide in appeal, "need input" sign beside it,
//                  urgent hop, worried blink
//   working      → SUNGLASSES ON: the shades slide down, a keyboard slides up
//                  under the paws, which swing in and tap alternately while the
//                  body bobs; every few bars a happy squash-stretch hop
//   error        → red strobe over the silhouette, glitch shudder, X-eyes,
//                  ⚠ badge, sharp shake
//
// The rig shares Kiro's coordinate space and prop geometry (pillow, zzz, sign
// and badge sit where the ghost's do), so it drops into Ghost's footprint in
// MASCOT_GEOMETRY without retuning. Arms pivot at their own local origin
// (each is wrapped in a static translate to the shoulder), so poses rotate
// them with a plain `transformOrigin: '0 0'`; everything else uses an explicit
// svgOrigin. resetMascotRig restores the authored transforms before each pose
// (see mascotRig.ts for why).
//
// The fur is baked into geometry — a ring of round tufts along every outline,
// drawn behind the smooth fill — rather than an SVG filter: filters on parts
// GSAP transforms every frame are re-rasterised continuously, which crawled
// with five instances mounted in the Settings cards. Gradient ids are made
// unique per instance (useId) for the same reason those cards exist.

interface JollyMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// Same square box as Kiro: the character spans x ≈ 100..440, y ≈ 45..590 (feet
// on y 590). Headroom above (y -200..0) holds the sign, zzz and badge; the
// arms swing out to roughly x 0 / 540 in the waiting pose.
const VIEW = { x: -120, y: -200, w: 860, h: 860 };
const ASPECT = VIEW.h / VIEW.w;

const EYES_C = '270 205'; // centre between the two eyes
const FOOT_C = '270 590'; // base of the body (squash / hop pivot)
const FACE_C = '270 215'; // face patch centre (tilt / shake pivot)

const CREAM = '#E2CDAE';
const CREAM_DARK = '#C9AF88';
const CREAM_LIGHT = '#EEDFC6';
const FACE = '#F5EAD8';
const INK = '#1B1B1B';
const CHEEK = '#F2A8B0';
const SCRIBBLE = '#2F6BFF';
const KEY_BASE = '#3B3F47';
const KEY_CAP = '#6B7280';

// One fluffy silhouette, chunky like the plush: a wide head dome (top y 45)
// flowing without a neck into a big belly that is widest about 60% of the way
// down, then a flat-ish base the legs poke out from.
const BODY_D = 'M100 235 C100 130 175 45 270 45 C365 45 440 130 440 235 C440 270 462 330 470 400 C478 462 462 512 424 534 C386 548 322 552 270 552 C218 552 154 548 116 534 C78 512 62 462 70 400 C78 330 100 270 100 235 Z';
// The same outline as cubic segments, so tufts can be laid along it.
const BODY_SEGS: [number, number][][] = [
  [[100, 235], [100, 130], [175, 45], [270, 45]],
  [[270, 45], [365, 45], [440, 130], [440, 235]],
  [[440, 235], [440, 270], [462, 330], [470, 400]],
  [[470, 400], [478, 462], [462, 512], [424, 534]],
  [[424, 534], [386, 548], [322, 552], [270, 552]],
  [[270, 552], [218, 552], [154, 548], [116, 534]],
  [[116, 534], [78, 512], [62, 462], [70, 400]],
  [[70, 400], [78, 330], [100, 270], [100, 235]],
];

type Pt = { x: number; y: number };
function cubic(seg: [number, number][], t: number): Pt {
  const [a, b, c, d] = seg; const u = 1 - t;
  return {
    x: u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    y: u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  };
}
// Deterministic pseudo-random so the tufts look hand-placed but never change
// between renders (the rig snapshot relies on stable markup).
const jitter = (i: number, k: number) => ((Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1 + 1) % 1;

// Tufts along the body outline: alternating sizes, nudged in and out.
const BODY_TUFTS: (Pt & { r: number })[] = [];
for (let si = 0; si < BODY_SEGS.length; si++) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const idx = si * n + i;
    const q = cubic(BODY_SEGS[si], (i + 0.5) / n);
    const r = 13 + jitter(idx, 1) * 9;
    BODY_TUFTS.push({ x: q.x + (jitter(idx, 2) - 0.5) * 6, y: q.y + (jitter(idx, 3) - 0.5) * 6, r });
  }
}

// Tufts around a capsule (used for the arms), in the capsule's local space:
// rect x -46..46, straight sides y 12..148, semicircular caps of radius 46.
const ARM_TUFTS: (Pt & { r: number })[] = [];
{
  const R = 46;
  let idx = 0;
  const push = (x: number, y: number) => {
    ARM_TUFTS.push({ x: x + (jitter(idx, 4) - 0.5) * 5, y: y + (jitter(idx, 5) - 0.5) * 5, r: 10 + jitter(idx, 6) * 7 });
    idx++;
  };
  for (let i = 0; i < 6; i++) { const a = Math.PI + (i + 0.5) / 6 * Math.PI; push(R * Math.cos(a), 12 + R * Math.sin(a)); }
  for (let i = 0; i < 5; i++) push(R, 12 + (i + 0.5) / 5 * 136);
  for (let i = 0; i < 6; i++) { const a = (i + 0.5) / 6 * Math.PI; push(R * Math.cos(a), 148 + R * Math.sin(a)); }
  for (let i = 0; i < 5; i++) push(-R, 148 - (i + 0.5) / 5 * 136);
}

const Tufts: React.FC<{ pts: (Pt & { r: number })[]; fill: string }> = ({ pts, fill }) => (
  <g fill={fill}>
    {pts.map((t, i) => <circle key={i} cx={t.x.toFixed(1)} cy={t.y.toFixed(1)} r={t.r.toFixed(1)} />)}
  </g>
);

// A mitten arm hanging from its shoulder at the local origin.
const Arm: React.FC = () => (
  <g>
    <Tufts pts={ARM_TUFTS} fill={CREAM} />
    <rect x="-46" y="-34" width="92" height="228" rx="46" fill={CREAM} />
    {/* mitten: a slightly darker rounded tip */}
    <ellipse cx="0" cy="168" rx="42" ry="30" fill={CREAM_DARK} opacity="0.32" />
  </g>
);

export const JollyMascot: React.FC<JollyMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);
  // Authored transforms, captured on mount so every pose can start from them.
  const rigRef = useRef<MascotRigSnapshot | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const shadeId = `jolly-shade-${uid}`;

  useEffect(() => {
    if (!rootRef.current) return;

    // GSAP's revert() leaves SVG transform residue behind (see mascotRig.ts):
    // without this the character drifts a few user units lower on every state
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
          .to('#char', { rotation: -14, x: -14, y: 14, svgOrigin: '150 590', duration: 0.9, ease: 'power2.inOut' })
          .to('#eyes', { scaleY: 0.1, svgOrigin: EYES_C, duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .to('#cheeks', { opacity: 0.35, duration: 0.4 }, '<')
          .to('#smile', { scaleX: 0.8, svgOrigin: '270 240', duration: 0.4 }, '<')
          // arms go limp, hanging a little further out
          .to('#arm-l', { rotation: 42, ...LOCAL, duration: 0.6, ease: 'power2.out' }, '<')
          .to('#arm-r', { rotation: -42, ...LOCAL, duration: 0.6, ease: 'power2.out' }, '<')
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

      // ── idle-active → NEUTRAL (breathing, blink, paw-to-face gesture) ──
      const playNeutral = () => {
        gsap.to('#body', { scaleY: 1.02, scaleX: 1.008, svgOrigin: FOOT_C, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        // a blink every few seconds
        gsap.to('#eyes', { scaleY: 0.1, svgOrigin: EYES_C, duration: 0.09, ease: 'power1.inOut', repeat: -1, yoyo: true, repeatDelay: 3.2 });
        // now and then the right paw comes up beside the face (the classic
        // "adjusting my shades" beat), the face tips toward it, then it drops.
        gsap.timeline({ repeat: -1, repeatDelay: 4.5, delay: 1.5 })
          .to('#arm-r', { rotation: 154, ...LOCAL, duration: 0.45, ease: 'back.out(1.4)' })
          .to('#face', { rotation: -4, x: -6, svgOrigin: FACE_C, duration: 0.3, ease: 'power2.out' }, '<')
          .to({}, { duration: 0.9 })
          .to('#arm-r', { rotation: -28, ...LOCAL, duration: 0.5, ease: 'power2.inOut' })
          .to('#face', { rotation: 0, x: 0, svgOrigin: FACE_C, duration: 0.4, ease: 'power2.inOut' }, '<');
      };

      // ── working → SHADES ON + TYPING ────────────────────────────────────
      const playRun = () => {
        gsap.set('#keyboard', { opacity: 0, y: 40 });
        gsap.set('#shades', { opacity: 0, y: -60 });
        const tl = gsap.timeline({ repeat: -1 });

        // The shades drop onto the face, the keyboard slides up, the arms swing
        // in so the paws hover over the keys.
        tl.to('#shades', { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(1.6)' })
          .to('#keyboard', { opacity: 1, y: 0, duration: 0.35, ease: 'back.out(1.4)' }, '-=0.1')
          .to('#arm-l', { rotation: -35, ...LOCAL, duration: 0.35, ease: 'power2.out' }, '<')
          .to('#arm-r', { rotation: 35, ...LOCAL, duration: 0.35, ease: 'power2.out' }, '<');

        // Typing bars: paws alternate taps (a small extra swing) while the whole
        // body bobs to the rhythm and the pressed keys flash.
        const tap = 0.11;
        for (let bar = 0; bar < 3; bar++) {
          for (let i = 0; i < 6; i++) {
            const left = i % 2 === 0;
            const arm = left ? '#arm-l' : '#arm-r';
            const key = left ? '#key-glow-l' : '#key-glow-r';
            tl.to(arm, { rotation: left ? -41 : 41, ...LOCAL, duration: tap, ease: 'power2.in' })
              .to(key, { opacity: 0.9, duration: tap * 0.5 }, '<')
              .to(arm, { rotation: left ? -35 : 35, ...LOCAL, duration: tap, ease: 'power2.out' })
              .to(key, { opacity: 0, duration: tap }, '<')
              .to('#body', { y: left ? 4 : -2, duration: tap * 2, ease: 'sine.inOut' }, `<-=${tap}`);
          }
          // end of a bar: a satisfied little bounce
          tl.to('#char', { scaleY: 0.94, scaleX: 1.04, svgOrigin: FOOT_C, duration: 0.1, ease: 'power1.out' })
            .to('#char', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.15, ease: 'power1.in' });
        }

        // Happy squash-stretch hop over the keyboard, arms flung up, land.
        tl.to('#body', { y: 0, duration: 0.15 })
          .to('#char', { scaleY: 0.86, scaleX: 1.08, svgOrigin: FOOT_C, duration: 0.14, ease: 'power1.in' })
          .to('#char', { scaleY: 1.1, scaleX: 0.94, y: -70, svgOrigin: FOOT_C, duration: 0.22, ease: 'power2.out' })
          .to('#arm-l', { rotation: 150, ...LOCAL, duration: 0.22, ease: 'power2.out' }, '<')
          .to('#arm-r', { rotation: -150, ...LOCAL, duration: 0.22, ease: 'power2.out' }, '<')
          .to('#char', { scaleY: 1, scaleX: 1, y: 0, svgOrigin: FOOT_C, duration: 0.22, ease: 'power2.in' })
          .to('#arm-l', { rotation: -35, ...LOCAL, duration: 0.22, ease: 'power2.in' }, '<')
          .to('#arm-r', { rotation: 35, ...LOCAL, duration: 0.22, ease: 'power2.in' }, '<')
          .to('#char', { scaleY: 0.93, scaleX: 1.05, svgOrigin: FOOT_C, duration: 0.08, ease: 'power1.out' })
          .to('#char', { scaleY: 1, scaleX: 1, svgOrigin: FOOT_C, duration: 0.14 })
          .to({}, { duration: 0.3 }); // beat before the loop repeats
      };

      // ── waiting → NEED INPUT (arms spread, sign rises, urgent hop) ─────
      const playHelp = () => {
        gsap.set('#flag', { opacity: 0, y: 60 });
        gsap.timeline()
          .to('#char', { rotation: 4, svgOrigin: FOOT_C, duration: 0.35, ease: 'power2.out' }) // lean toward the sign
          // arms fling wide in appeal (the "well?!" shrug)
          .to('#arm-l', { rotation: 100, ...LOCAL, duration: 0.4, ease: 'back.out(1.5)' }, '<')
          .to('#arm-r', { rotation: -100, ...LOCAL, duration: 0.4, ease: 'back.out(1.5)' }, '<')
          .to('#smile', { scaleY: -0.6, svgOrigin: '270 240', duration: 0.3 }, '<') // smile flips to a worried line
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(1.6)' }, '-=0.15')
          .add(() => {
            // gentle sway of the sign about the pole base
            gsap.fromTo('#flag', { rotation: -5, svgOrigin: '477 170' }, { rotation: 5, svgOrigin: '477 170', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // urgent hop
            gsap.to('#char', { y: -18, duration: 0.45, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // the spread arms bob against the hop
            gsap.to('#arm-l', { rotation: 110, ...LOCAL, duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true });
            gsap.to('#arm-r', { rotation: -110, ...LOCAL, duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // occasional worried blink
            gsap.to('#eyes', { scaleY: 0.15, svgOrigin: EYES_C, duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true, repeatDelay: 1.3 });
          });
      };

      // ── error → red strobe + glitch + X-eyes + ⚠ ────────────────────────
      const playError = () => {
        gsap.set('#eyes', { opacity: 0 }); // swap beady eyes → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#smile', { scaleY: -1, svgOrigin: '270 240' }); // frown
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '270 -60' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .add(() => {
            // red strobe over the whole silhouette (multiply overlay)
            gsap.to('#red-tint', { opacity: 0.75, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#char', { x: 7, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -5, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // sharp "no" shake of the face
            gsap.fromTo('#face', { rotation: -4, svgOrigin: FACE_C }, { rotation: 4, svgOrigin: FACE_C, duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true });
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
        {/* soft shading so the plush reads as round */}
        <radialGradient id={shadeId} cx="42%" cy="30%" r="75%">
          <stop offset="0" stopColor={CREAM_LIGHT} />
          <stop offset="0.65" stopColor={CREAM} />
          <stop offset="1" stopColor={CREAM_DARK} />
        </radialGradient>
      </defs>

      {/* floating "zzz" for sleep (above the head) */}
      <text id="zzz" x="290" y="-10" fontFamily="ui-sans-serif, sans-serif" fontSize="140" fontStyle="italic" fontWeight="700" fill="#cfd3da" opacity="0">z z z</text>

      {/* pillow for sleep (behind it, under the left shoulder) */}
      <rect id="pillow" x="0" y="500" width="230" height="95" rx="44" fill="#ECE6DA" opacity="0" />

      <g id="char">
        <g id="body">
          {/* stumpy legs, tucked under the belly */}
          <g id="legs" fill={CREAM}>
            <rect x="128" y="478" width="108" height="112" rx="50" />
            <rect x="304" y="478" width="108" height="112" rx="50" />
            <ellipse cx="182" cy="582" rx="54" ry="16" fill={CREAM_DARK} opacity="0.42" />
            <ellipse cx="358" cy="582" rx="54" ry="16" fill={CREAM_DARK} opacity="0.42" />
          </g>

          {/* the one fluffy silhouette: a ring of tufts peeking out behind the smooth fill */}
          <Tufts pts={BODY_TUFTS} fill={CREAM} />
          <path d={BODY_D} fill={`url(#${shadeId})`} />

          {/* blue scribbled "M" on the belly */}
          <path id="scribble" d="M174 466 C186 426 200 390 214 362 C230 398 246 434 262 460 C272 424 288 390 306 362 C320 398 336 434 354 466" fill="none" stroke={SCRIBBLE} strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" opacity="0.92" />

          {/* keyboard for the working pose, resting in front of the belly */}
          <g id="keyboard" opacity="0">
            <rect x="150" y="462" width="240" height="60" rx="14" fill={KEY_BASE} />
            <g fill={KEY_CAP}>
              <rect x="166" y="473" width="22" height="13" rx="4" /><rect x="194" y="473" width="22" height="13" rx="4" /><rect x="222" y="473" width="22" height="13" rx="4" /><rect x="250" y="473" width="22" height="13" rx="4" /><rect x="278" y="473" width="22" height="13" rx="4" /><rect x="306" y="473" width="22" height="13" rx="4" /><rect x="334" y="473" width="22" height="13" rx="4" /><rect x="362" y="473" width="12" height="13" rx="4" />
              <rect x="166" y="493" width="60" height="13" rx="4" /><rect x="232" y="493" width="22" height="13" rx="4" /><rect x="260" y="493" width="22" height="13" rx="4" /><rect x="288" y="493" width="22" height="13" rx="4" /><rect x="316" y="493" width="58" height="13" rx="4" />
            </g>
            {/* key highlights that flash under each paw tap */}
            <rect id="key-glow-l" x="192" y="473" width="56" height="33" rx="6" fill="#9DE5FF" opacity="0" />
            <rect id="key-glow-r" x="292" y="473" width="56" height="33" rx="6" fill="#9DE5FF" opacity="0" />
          </g>

          {/* mitten arms, each pivoting at its shoulder (local origin) */}
          <g id="arms">
            <g transform="translate(112 335)"><g id="arm-l" transform="rotate(28)"><Arm /></g></g>
            <g transform="translate(428 335)"><g id="arm-r" transform="rotate(-28)"><Arm /></g></g>
          </g>

          {/* smooth face patch inset in the head dome */}
          <g id="face">
            {/* the fur hood: a soft, fuzzy darker ridge where the plush meets the face */}
            <ellipse cx="270" cy="215" rx="142" ry="126" fill="none" stroke={CREAM_DARK} strokeWidth="22" opacity="0.32" />
            <ellipse cx="270" cy="215" rx="130" ry="114" fill={FACE} />
            {/* soft pink cheeks */}
            <g id="cheeks" fill={CHEEK} opacity="0.7">
              <ellipse cx="196" cy="240" rx="24" ry="18" />
              <ellipse cx="344" cy="240" rx="24" ry="18" />
            </g>
            {/* tiny beady eyes, set wide (centres ≈ 225,205 and 315,205) */}
            <g id="eyes" fill={INK}>
              <circle cx="225" cy="205" r="10" />
              <circle cx="315" cy="205" r="10" />
              <circle cx="228" cy="201" r="3" fill="#FFFFFF" />
              <circle cx="318" cy="201" r="3" fill="#FFFFFF" />
            </g>
            {/* small upward smile */}
            <path id="smile" d="M254 236 Q270 252 286 236" fill="none" stroke={INK} strokeWidth="7" strokeLinecap="round" />
            {/* X eyes for the error state (shown while #eyes is hidden) */}
            <g id="eyes-x" opacity="0" stroke={INK} strokeWidth="9" strokeLinecap="round">
              <line x1="211" y1="191" x2="239" y2="219" />
              <line x1="239" y1="191" x2="211" y2="219" />
              <line x1="301" y1="191" x2="329" y2="219" />
              <line x1="329" y1="191" x2="301" y2="219" />
            </g>
            {/* cat-eye sunglasses for the working pose (over the eyes) */}
            <g id="shades" opacity="0">
              <ellipse cx="224" cy="204" rx="46" ry="27" transform="rotate(-8 224 204)" fill={INK} />
              <ellipse cx="316" cy="204" rx="46" ry="27" transform="rotate(8 316 204)" fill={INK} />
              <rect x="258" y="196" width="24" height="9" rx="4" fill={INK} />
              <path d="M180 200 L142 190" stroke={INK} strokeWidth="10" strokeLinecap="round" />
              <path d="M360 200 L398 190" stroke={INK} strokeWidth="10" strokeLinecap="round" />
              {/* lens glints */}
              <ellipse cx="214" cy="194" rx="12" ry="6" fill="#FFFFFF" opacity="0.3" />
              <ellipse cx="306" cy="194" rx="12" ry="6" fill="#FFFFFF" opacity="0.3" />
            </g>
          </g>

          {/* red overlay for the error strobe (same silhouette, multiply blend) */}
          <g id="red-tint" fill="#E5484D" opacity="0" style={{ mixBlendMode: 'multiply' }}>
            <path d={BODY_D} />
            <rect x="128" y="478" width="108" height="112" rx="50" />
            <rect x="304" y="478" width="108" height="112" rx="50" />
            <g transform="translate(112 335) rotate(28)"><rect x="-46" y="-34" width="92" height="228" rx="46" /></g>
            <g transform="translate(428 335) rotate(-28)"><rect x="-46" y="-34" width="92" height="228" rx="46" /></g>
          </g>
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

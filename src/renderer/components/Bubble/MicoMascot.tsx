import React, { useEffect, useId, useRef } from 'react';
import gsap from 'gsap';
import { AgentState } from '../../../common/types';

// ── Mico mascot ──────────────────────────────────────────────────────────────
// An animated stand-in for the Microsoft/VS Code Copilot orb — the soft
// pink→gold blob "Mico". Each AgentState drives a pose, ported (nearly verbatim)
// from the hand-tuned GSAP demo in `clawd-svgs/mico-actions-demo.html`:
//
//   idle         → slumped on a pillow, closed eyes, brows relaxed, drifting "zzz"
//   idle-active  → gentle hover + breathing ("on, but doing nothing")
//   waiting      → a "need input" sign rises beside the blob with an urgent hop
//   working      → squash-stretch hops, then floating-dumbbell reps
//   error        → red strobe + glitch shudder + X-eyes + angry brows + alert badge
//
// Mico has no legs or hands, so locomotion is squash-and-stretch and the props
// (dumbbells / flag) float beside the body rather than being held. The rig is
// the same traced artwork as the demo, but — like Clawd and Kiro — the zzz and
// the flag were scaled UP relative to the character so they stay legible at
// bubble scale (the demo's props were sized for a 462px stage and would be
// unreadable this small). The body gradient <defs> are given per-instance ids
// (useId) so the five Settings state cards — five mounted Micos in one document
// — can't collide on a global gradient id. Prop positions are easy to tweak
// right here in the markup.
//
// All animation lives in a `gsap.context` scoped to the component's root. The
// effect re-runs on every state change; the context's `revert()` kills the old
// timelines AND clears the inline styles they set, giving us the demo's
// `resetAll()` for free with no manual loop bookkeeping.

interface MicoMascotProps {
  state: AgentState;
  // Rendered width in px; height follows the viewBox aspect ratio.
  width: number;
}

// viewBox bounds the blob (artwork coords: char ≈ x 80..382, y 112..432, base
// at y 432, centre x ≈ 231) plus reserved headroom above (y -160..112) for the
// enlarged overhead props — the flag sign and drifting zzz reach up there — and
// a little breathing room below the foot (432 → box bottom 480). The box is
// SQUARE and centred on the character's x so, at the same rendered width as
// Clawd, the Mico bubble has exactly Clawd's footprint — it shares the same
// MASCOT_WIDTH-style sizing (see MASCOT_WIDTH_COPILOT in Bubble.tsx and
// MASCOT_DIMENSIONS_COPILOT in bubble-manager.ts): a uniform zoom-out that keeps
// every prop inside the window, so nothing clips. Keep extremes in sync with
// the prop geometry below.
const VIEW = { x: -89, y: -160, w: 640, h: 640 };
const ASPECT = VIEW.h / VIEW.w;

// The blob silhouette (traced from the Lottie), reused for the base gradient,
// the volume vignette, the glossy sheen, and the red error tint.
const BLOB_PATH =
  'M179.020905,150.100571 C179.020905,150.100571 179.074738,150.242676 178.642105,150.320770 C178.359100,150.480942 178.216583,150.723648 177.581787,151.253571 C177.033157,151.622452 176.484528,151.991348 175.530746,152.279846 C175.234375,152.428268 175.134888,152.660965 175.006104,153.031815 C175.006104,153.031815 174.940628,153.254944 174.521240,153.252457 C174.245651,153.403625 174.114273,153.636322 173.488708,154.225082 C171.326736,155.905029 169.164764,157.584976 166.511566,159.180496 C166.164612,159.354172 166.024338,159.632141 165.480789,160.327850 C159.192932,165.297577 152.720474,170.054932 146.678009,175.306976 C142.174911,179.220978 138.228012,183.774887 133.467529,188.290604 C132.662964,189.209015 131.858398,190.127441 130.404526,191.232208 C127.623634,194.502472 124.842728,197.772751 122.002213,201.000839 C122.002213,201.000839 122.045235,201.059753 121.397163,201.243698 C118.287933,205.178726 115.178711,209.113754 112.001419,213.003662 C112.001419,213.003662 112.052368,213.067612 111.402641,213.256241 C105.657082,221.466064 99.180763,229.266663 94.309006,237.965836 C81.882858,260.154419 77.587334,284.159882 81.155525,309.355377 C82.782639,320.844604 86.098373,331.935181 92.110306,342.478119 C92.110306,342.478119 92.269814,342.859467 92.130859,343.557617 C93.100029,345.041534 94.069206,346.525452 95.125618,348.452545 C95.125618,348.452545 95.285484,348.874969 95.114914,349.571045 C96.095848,351.077850 97.076782,352.584625 98.140503,354.690399 C98.745468,355.441345 99.350426,356.192291 100.058891,357.559357 C100.143036,357.749847 100.227188,357.940338 100.400749,358.645874 C100.694283,359.070892 100.987823,359.495880 101.169266,360.441284 C101.452255,360.622833 101.735245,360.804382 102.233688,361.512177 C102.588058,361.950195 102.942436,362.388245 103.189819,363.441437 C103.798531,363.976532 104.407242,364.511658 105.131981,365.696350 C105.853691,366.771942 106.575394,367.847504 107.185165,369.437988 C107.468857,369.607391 107.752548,369.776825 108.254463,370.477936 C108.826797,370.967804 109.399132,371.457672 110.039360,372.663361 C117.955933,381.840240 125.628677,391.242249 133.846329,400.141083 C146.104416,413.415161 161.038559,422.706482 178.022980,428.945984 C201.509094,437.573944 223.513474,434.353027 244.945496,421.177155 C245.268890,420.994659 245.592270,420.812134 246.412689,420.760284 C246.560684,420.480133 246.708679,420.199982 246.962143,419.927002 C246.962143,419.927002 246.931992,419.825684 247.448456,419.832855 C247.603378,419.546600 247.758301,419.260315 248.420837,418.817474 C248.584274,418.749329 248.747696,418.681152 249.557007,418.676971 C250.697433,417.756317 251.837875,416.835693 253.466049,415.787048 C253.623566,415.728363 253.781067,415.669647 254.422974,415.757050 C254.545441,415.476837 254.667908,415.196625 254.935638,414.925812 C254.935638,414.925812 254.915833,414.781586 255.420670,414.785736 C255.543518,414.499939 255.666367,414.214111 255.928848,413.946564 C255.928848,413.946564 255.918488,413.806122 256.598755,413.703644 C260.006104,411.117157 263.413452,408.530701 267.334412,405.777191 C267.553925,405.501007 267.773438,405.224823 268.641266,404.897980 C269.776062,403.948700 270.910828,402.999420 272.703827,401.871338 C274.822998,400.270081 276.942169,398.668793 279.756836,396.940338 C284.838226,393.623718 289.919586,390.307068 295.569550,386.833557 C296.033600,386.532593 296.497620,386.231628 297.696136,385.909973 C308.289764,380.876007 318.945648,375.967499 329.450958,370.755493 C334.767517,368.117798 339.811981,364.931702 345.000610,362.001648 C345.000610,362.001648 344.994965,361.980164 345.691559,361.957977 C347.432556,360.619202 349.173523,359.280426 351.371490,357.730835 C351.565216,357.462738 351.758911,357.194611 352.640869,356.874725 C355.765137,353.583435 358.889404,350.292114 362.522186,346.720215 C362.995514,346.118134 363.468842,345.516052 364.567596,344.766937 C365.024445,343.830627 365.481323,342.894318 366.000397,341.996735 C366.000397,341.996735 365.954834,341.938904 366.610138,341.749756 C367.400391,340.163971 368.190674,338.578217 369.000885,337.000214 C369.000885,337.000214 368.990967,336.980682 369.651398,336.753845 C374.775848,328.101044 378.186188,318.834259 379.756287,308.152679 C379.772369,307.429016 379.788452,306.705383 380.401337,305.528015 C380.503876,304.314484 380.606415,303.100983 380.819061,301.263641 C380.853546,300.842926 380.888031,300.422211 381.660065,299.549103 C381.669830,293.678253 381.679596,287.807434 381.775970,281.167786 C381.743073,280.137421 381.710175,279.107086 381.934570,277.174225 C381.252075,271.123322 380.569550,265.072418 379.816956,258.299377 C379.747406,257.579010 379.677887,256.858673 379.868988,255.322922 C379.879456,254.989975 379.949249,254.646408 379.891907,254.325577 C375.264008,228.438187 364.897858,204.690033 352.720856,181.625214 C352.373535,180.967377 351.534332,180.569214 350.779633,179.579346 C350.779633,179.579346 350.593750,179.123367 350.752838,178.618729 C350.481873,178.423477 350.210907,178.228241 349.806885,177.574234 C349.806885,177.574234 349.611664,177.138260 349.730255,176.631592 C349.449097,176.479218 349.167969,176.326859 348.705597,175.704819 C348.451843,175.493256 348.198090,175.281693 347.928284,174.342453 C345.163635,170.374313 342.398987,166.406158 339.225464,161.891541 C335.676758,157.608963 332.128052,153.326401 328.457001,148.428146 C328.325378,148.265472 328.193787,148.102814 328.417725,147.787750 C328.417725,147.787750 328.152985,147.508606 328.152985,147.508606 C328.152985,147.508606 327.956421,147.841858 327.481476,147.237579 C327.124512,146.871796 326.767548,146.506012 326.581848,145.728821 C326.581848,145.728821 326.266418,145.415100 326.266418,145.415100 C326.266418,145.415100 325.862610,145.601913 325.555542,145.012802 C324.675140,144.039825 323.794739,143.066864 322.910522,141.376877 C317.714539,136.929398 312.757294,132.159836 307.276428,128.096634 C292.583191,117.203941 276.311523,110.237137 257.657349,112.358261 C236.368103,114.779007 217.650635,124.110039 199.566116,136.128082 C199.387985,136.184372 199.209854,136.240646 198.465179,136.218506 C198.023148,136.815353 197.581100,137.412186 196.476852,138.271454 C193.339630,140.332794 190.202408,142.394135 186.518417,144.450516 C186.030807,144.968063 185.543182,145.485611 184.437195,146.279922 C182.958633,147.290390 181.480057,148.300842 179.510071,149.189423 C179.395065,149.477081 179.280045,149.764740 179.020905,150.100571 z';

export const MicoMascot: React.FC<MicoMascotProps> = ({ state, width }) => {
  const rootRef = useRef<SVGSVGElement>(null);
  // Per-instance gradient ids so multiple mounted Micos don't collide.
  const uid = useId().replace(/:/g, '');
  const baseId = `mico-base-${uid}`;
  const vignetteId = `mico-vignette-${uid}`;
  const sheenId = `mico-sheen-${uid}`;

  useEffect(() => {
    if (!rootRef.current) return;

    const ctx = gsap.context(() => {
      const show = (sel: string) => gsap.to(sel, { opacity: 1, duration: 0.4 });
      const dumbbells = ['#left-dumbbell', '#right-dumbbell'];

      // Brow poses — rotate about the INNER ends so the outer tips swing.
      const browsWorried = () => {
        gsap.to('#brow-l', { rotation: 14, svgOrigin: '206 228', duration: 0.3 });
        gsap.to('#brow-r', { rotation: -14, svgOrigin: '286 230', duration: 0.3 });
      };
      const browsAngry = () => {
        gsap.to('#brow-l', { rotation: -16, svgOrigin: '206 228', y: 12, duration: 0.2 });
        gsap.to('#brow-r', { rotation: 16, svgOrigin: '286 230', y: 12, duration: 0.2 });
      };

      // ── idle → SLEEP ────────────────────────────────────────────────────
      const playSleep = () => {
        show('#pillow');
        gsap.timeline()
          .to('#char', { rotation: -16, x: -22, y: 30, svgOrigin: '105 432', duration: 0.9, ease: 'power2.inOut' })
          .to('#eyes', { scaleY: 0.1, svgOrigin: '242 268', duration: 0.4, ease: 'power2.out' }, '-=0.55')
          .to('#brows', { y: 15, duration: 0.4, ease: 'power2.out' }, '<') // brows relax down
          .add(() => {
            // gentle breathing about the blob's base
            gsap.to('#body', { scaleY: 1.045, svgOrigin: '230 432', duration: 1.6, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // zzz drifting up and fading, on a loop
            gsap.set('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6, svgOrigin: '310 40' });
            gsap.timeline({ repeat: -1 })
              .fromTo('#zzz', { opacity: 0, x: 0, y: 0, scale: 0.6 }, { opacity: 0.9, x: 55, y: -95, scale: 1, duration: 1.8, ease: 'sine.out' })
              .to('#zzz', { opacity: 0, duration: 0.5 }, '-=0.35');
          });
      };

      // ── idle-active → NEUTRAL (on, idle, no task) ───────────────────────
      const playNeutral = () => {
        gsap.to('#char', { y: -12, duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
        gsap.to('#body', { scaleY: 1.02, svgOrigin: '230 432', duration: 2.4, ease: 'sine.inOut', repeat: -1, yoyo: true });
      };

      // ── working → BOUNCE + WORKOUT (all body english — no limbs) ────────
      const playRun = () => {
        const tl = gsap.timeline({ repeat: -1 });
        const d = 0.16;

        // Energetic hops: stretch tall on the way up, squash flat on landing.
        for (let s = 0; s < 5; s++) {
          tl.to('#char', { y: -54, duration: d, ease: 'power1.out' })
            .to('#body', { scaleY: 1.1, scaleX: 0.93, svgOrigin: '230 432', duration: d, ease: 'power1.out' }, '<')
            .to('#char', { y: 0, duration: d, ease: 'power1.in' })
            .to('#body', { scaleY: 0.88, scaleX: 1.1, svgOrigin: '230 432', duration: d, ease: 'power1.in' }, '<')
            .to('#body', { scaleY: 1, scaleX: 1, duration: d * 0.7, ease: 'power1.out' });
        }

        // Catch a breath, then the floating dumbbells fade in at his sides.
        tl.to('#body', { scaleY: 1, scaleX: 1, duration: 0.15 })
          .to(dumbbells, { opacity: 1, duration: 0.25 }, '<')
          .to({}, { duration: 0.25 });

        // Reps: the dumbbells lift while Mico stretches with the effort, then lower.
        const j = 0.3;
        for (let r = 0; r < 4; r++) {
          tl.to(dumbbells, { y: -100, duration: j, ease: 'power2.out' })
            .to('#body', { scaleY: 1.07, scaleX: 0.95, svgOrigin: '230 432', duration: j, ease: 'power2.out' }, '<')
            .to('#brows', { y: -12, duration: j }, '<') // brows lift with the strain
            .to(dumbbells, { y: 0, duration: j, ease: 'power2.in' })
            .to('#body', { scaleY: 0.95, scaleX: 1.05, svgOrigin: '230 432', duration: j, ease: 'power2.in' }, '<')
            .to('#brows', { y: 0, duration: j }, '<');
        }
        tl.to('#body', { scaleY: 1, scaleX: 1, duration: 0.2 })
          .to(dumbbells, { opacity: 0, duration: 0.2 }, '<') // set the weights down
          .to({}, { duration: 0.4 }); // brief beat before the loop repeats
      };

      // ── waiting → NEED HELP (sign rises beside the blob) ────────────────
      const playHelp = () => {
        browsWorried();
        gsap.set('#flag', { opacity: 0, y: 90 });
        gsap.timeline()
          .to('#flag', { opacity: 1, y: 0, duration: 0.5, ease: 'power2.out' })
          .to('#char', { y: -8, duration: 0.25, ease: 'power2.out' }, '<')
          .add(() => {
            // gentle sway of the sign about the pole base (soft enough to keep text readable)
            gsap.fromTo('#flag', { rotation: -7, svgOrigin: '396 165' }, { rotation: 7, svgOrigin: '396 165', duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
            // urgent hop
            gsap.to('#char', { y: -27, duration: 0.45, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // occasional worried blink
            gsap.to('#eyes', { scaleY: 0.15, svgOrigin: '242 268', duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true, repeatDelay: 1.3 });
          });
      };

      // ── error → ALERT + red strobe + glitch + X-eyes ────────────────────
      const playError = () => {
        browsAngry();
        gsap.set('#eyes', { opacity: 0 }); // swap normal eyes → X eyes
        gsap.set('#eyes-x', { opacity: 1 });
        gsap.set('#alert', { opacity: 1, scale: 0, svgOrigin: '231 -80' });
        gsap.timeline()
          .to('#alert', { scale: 1, duration: 0.4, ease: 'back.out(2.2)' }) // badge pops in
          .add(() => {
            // red strobe across the blob (opacity of the silhouette tint overlay)
            gsap.to('#blob-tint', { opacity: 0.5, duration: 0.18, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // fast glitch shudder (whole character)
            gsap.to('#char', { x: 10, duration: 0.045, ease: 'none', repeat: -1, yoyo: true });
            gsap.to('#char', { y: -6, duration: 0.07, ease: 'none', repeat: -1, yoyo: true });
            // sharp "no" head-shake
            gsap.fromTo('#body', { rotation: -4, svgOrigin: '230 432' }, { rotation: 4, svgOrigin: '230 432', duration: 0.12, ease: 'power1.inOut', repeat: -1, yoyo: true });
            // badge throb to keep drawing the eye
            gsap.to('#alert', { scale: 1.15, svgOrigin: '231 -80', duration: 0.45, ease: 'sine.inOut', repeat: -1, yoyo: true });
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
        {/* Smooth body gradient: warm pink at the lower-left cheek → golden at the upper-right. */}
        <linearGradient id={baseId} x1="0.12" y1="0.92" x2="0.9" y2="0.08">
          <stop offset="0" stopColor="#F6A0A8" />
          <stop offset="0.42" stopColor="#F8B29B" />
          <stop offset="0.72" stopColor="#FAC88C" />
          <stop offset="1" stopColor="#FBDC88" />
        </linearGradient>
        {/* Rounded volume: transparent centre darkening to a soft pink rim. */}
        <radialGradient id={vignetteId} cx="0.45" cy="0.42" r="0.62">
          <stop offset="0.55" stopColor="#E0888E" stopOpacity="0" />
          <stop offset="1" stopColor="#E0888E" stopOpacity="0.32" />
        </radialGradient>
        {/* Glossy sheen in the upper-middle. */}
        <radialGradient id={sheenId} cx="0.44" cy="0.28" r="0.42">
          <stop offset="0" stopColor="#FFF6E6" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FFF6E6" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* floating "zzz" for sleep (enlarged like Clawd, near the head) */}
      <text id="zzz" x="300" y="45" fontFamily="ui-sans-serif, sans-serif" fontSize="104" fontStyle="italic" fontWeight="700" fill="#cfd3da" opacity="0">z z z</text>

      {/* pillow for sleep (behind mico) */}
      <rect id="pillow" x="-55" y="330" width="245" height="100" rx="48" fill="#ECE6DA" opacity="0" />

      <g id="char">
        {/* floating dumbbells for the workout (Mico has no hands — they hover at his sides) */}
        <g id="left-dumbbell" opacity="0">
          <rect x="-55" y="245" width="85" height="15" rx="7" fill="#8A8A8A" />
          <rect x="-70" y="226" width="27" height="54" rx="8" fill="#454545" />
          <rect x="18" y="226" width="27" height="54" rx="8" fill="#454545" />
        </g>
        <g id="right-dumbbell" opacity="0">
          <rect x="432" y="245" width="85" height="15" rx="7" fill="#8A8A8A" />
          <rect x="417" y="226" width="27" height="54" rx="8" fill="#454545" />
          <rect x="505" y="226" width="27" height="54" rx="8" fill="#454545" />
        </g>

        <g id="body">
          <g id="blob-art">
            <path fill={`url(#${baseId})`} d={BLOB_PATH} />
            <path fill={`url(#${vignetteId})`} d={BLOB_PATH} />
            <path fill={`url(#${sheenId})`} d={BLOB_PATH} />
          </g>
          {/* red overlay for the error strobe (exact silhouette, opacity-tweened) */}
          <path id="blob-tint" fill="#E5484D" opacity="0" d={BLOB_PATH} />

          <g id="face">
            <g id="brows">
              <g id="brow-l">
                <path fill="#593D34" d="M171.802734,222.306488 C173.963150,222.594437 175.918762,223.190430 178.175827,223.902298 C177.296692,224.875687 176.227936,226.007278 174.915894,226.542603 C169.603104,228.710251 164.215439,230.694443 158.520142,232.831406 C158.347275,228.655609 161.684799,225.390778 167.065140,224.099396 C168.606110,223.729523 170.088638,223.116226 171.802734,222.306488 z" />
              </g>
              <g id="brow-r">
                <path fill="#593D34" d="M283.807068,225.875473 C284.184967,221.152985 287.791626,223.628632 290.582397,223.017029 C295.997681,225.126678 301.824829,226.126495 303.712189,233.160141 C297.190887,230.760330 290.669617,228.360519 283.807068,225.875473 z" />
              </g>
            </g>
            <g id="eyes">
              <path fill="#1B1211" d="M178.887421,252.269836 C183.465378,260.029266 183.821075,268.473480 183.024750,277.523987 C183.028275,278.089020 182.925003,278.251862 182.634521,278.963440 C179.964920,282.553772 177.482513,285.595459 174.648407,288.449799 C171.653488,286.945282 169.010284,285.628082 166.367065,284.310913 C165.599960,281.762909 164.832840,279.214935 164.012695,276.042969 C163.700439,274.594055 163.441223,273.769073 163.295288,272.554901 C163.252625,271.111908 163.096680,270.058136 163.120178,268.660339 C163.238770,267.559479 163.177933,266.802612 163.344269,265.772827 C163.653168,264.329926 163.734879,263.159882 164.062164,261.726440 C164.595413,260.322327 164.883072,259.181671 165.456482,257.868347 C170.033630,250.376450 172.769196,249.247299 178.887421,252.269836 z" />
              <path fill="#120A09" d="M283.076477,286.233765 C280.125061,279.197601 278.946655,272.122070 280.057098,264.721954 C281.216553,256.994995 284.445221,252.975983 291.034607,251.938690 C292.006897,252.026947 292.355865,252.165604 292.780365,252.614807 C293.833618,253.686646 294.811371,254.447952 295.900269,255.390076 C296.160614,255.850739 296.393768,255.990097 296.653320,256.234009 C296.642914,256.639984 296.690155,256.800934 296.463928,257.063660 C294.318756,257.235168 292.447021,257.304993 290.575287,257.374786 C290.896606,259.058990 290.671417,261.495331 291.682617,262.230103 C292.850464,263.078644 295.108063,262.427429 297.216492,262.427429 C297.394257,262.736359 297.876587,263.574585 298.369812,264.729858 C298.463806,265.674866 298.546936,266.302856 298.429810,267.283386 C297.990631,272.171509 297.751648,276.707031 297.512665,281.242554 C297.035736,282.234406 296.558807,283.226288 295.629486,284.583679 C294.833954,285.665527 294.490814,286.381775 294.147675,287.098053 C294.147675,287.098053 294.086914,287.086487 293.734711,287.102295 C290.220367,287.125702 287.058258,287.133331 283.896118,287.140930 C283.711517,286.869293 283.499908,286.620667 283.076477,286.233765 z" />
            </g>
            {/* X eyes for the error state (shown while #eyes is hidden) */}
            <g id="eyes-x" opacity="0" stroke="#1B1211" strokeWidth="11" strokeLinecap="round">
              <line x1="178" y1="255" x2="204" y2="281" />
              <line x1="204" y1="255" x2="178" y2="281" />
              <line x1="282" y1="255" x2="308" y2="281" />
              <line x1="308" y1="255" x2="282" y2="281" />
            </g>
            <g id="mouth">
              <path fill="#593D34" d="M245.776443,297.441345 C247.705902,297.012085 249.239456,296.678284 251.057114,296.282623 C249.993271,300.675354 246.198761,302.838013 238.015030,303.246735 C228.973831,303.698303 219.580704,305.166565 210.736069,298.796692 C223.133545,298.345856 234.257034,297.941345 245.776443,297.441345 z" />
            </g>
          </g>
        </g>

        {/* "need input" sign, floating at Mico's right (enlarged like Clawd) */}
        <g id="flag" opacity="0">
          <rect id="flag-pole" x="390" y="-150" width="13" height="315" rx="6" fill="#5D5B56" />
          <rect id="flag-sign" x="398" y="-158" width="150" height="112" rx="18" fill="#FBF7EF" stroke="#D9CFC0" strokeWidth="5" />
          <text x="473" y="-112" textAnchor="middle" fontFamily="ui-sans-serif, sans-serif" fontSize="40" fontWeight="700" fill="#3A3530">
            <tspan x="473" dy="0">Need</tspan>
            <tspan x="473" dy="46">input</tspan>
          </text>
        </g>

        {/* warning badge for the error state (triangle + "!"), pops above the head */}
        <g id="alert" opacity="0">
          <path d="M231 -131 L289 -31 L173 -31 Z" fill="#E5484D" stroke="#FFFFFF" strokeWidth="8" strokeLinejoin="round" />
          <rect x="225" y="-104" width="12" height="42" rx="6" fill="#FFFFFF" />
          <rect x="225" y="-50" width="12" height="12" rx="6" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
};

# Hyperframes Composition Brief: Agent Pulse — mascot cut (run 2)

## Objective
Re-tell run 1's problem → solution story with Agent Pulse's **animated mascots** as the recurring on-screen character instead of the plain status bubble. The mascots are real product UI; their POSE encodes the agent state.

## Output
- Composition directory: `brag-output-mascot/composition/`
- Rendered video: `brag-output-mascot/brag.mp4`
- Format: landscape — 1920x1080
- Duration: ~22 seconds

## Source Material
- Project root: `E:\DDrive\Github\agent-pulse`
- Mascot rigs (geometry + choreography ported verbatim, ids prefixed per instance):
  - `src/renderer/components/Bubble/ClawdMascot.tsx` — Clawd (`#DD775B`, black square eyes); waiting pose (pennant + hop) in Scene 1, working pose (jog → dumbbell jumping jacks) in Scene 2
  - `src/renderer/components/Bubble/CodexMascot.tsx` — Codex frog; idle pose (asleep on pillow, zzz) in Scene 2
  - `src/renderer/components/Bubble/KiroMascot.tsx` — Kiro ghost; error pose (red strobe, glitch shudder, X-eyes, ⚠ alert) in Scene 2
- Real state palette: `src/common/stateColors.ts` — working `#16a34a`, waiting `#2563eb`, idle-active `#d97706`, error `#dc2626`.
- Assets: identical to run 1, pulled from `brag-output/composition/assets` by `copy-assets.mjs` (this run was authored without shell access, so binaries aren't duplicated in-repo).
- Copy that must appear verbatim (unchanged from run 1 except the Scene 2 headline/subline, which replace the traffic-light metaphor):
  - "You stepped into a meeting. Claude kept building…"
  - "Allow Claude to edit files in this session?" / Deny / Allow once / Allow for session
  - "Claude is waiting for you" / "Agent Pulse pinged you instantly."
  - "Every agent acts out its state."
  - "Blocked · rm-rf-root" / "Destructive commands get blocked before they run."
  - "Ambient, glanceable awareness of AI coding agents." / "100% local. No telemetry."
  - Stats: "6 tools", "0 bytes sent", "1 glance"

## Creative Direction
- Tone preset: cinematic — character-led; the mascots' body language carries the tension and the release.
- Scene 1: quiet dread. Clawd frantically but silently waves its "Need input" pennant beside the frozen prompt — no alarm, just a little guy who needs you.
- Scene 2: the reveal. Three mascots in the dark housing, each DOING its state — jumping jacks (working), napping (idle), strobing red with an alert badge (error).
- Scenes 3–4: unchanged from run 1 (guardrail block, calm logo/stats outro).
- Avoid: inventing new characters or poses not in the rigs; alarm-y audio; redesigning the glassmorphism brand.

## Determinism note (important for fidelity)
The product components run their pose loops with `repeat: -1` on gsap's global ticker. Hyperframes renders by seeking the paused master timeline, so every loop is ported as a **finite repeat placed at an absolute time** on `window.__timelines["main"]` (e.g. the pennant wave is `repeat: 6`, the error strobe `repeat: 11`). Pose keyframe values, durations, eases, and `svgOrigin` pivots are unchanged from the components.

## Audio
Identical plan to run 1 (same music, same cue locks 10.93 / 13.11 / 17.47 / 19.66, same sparse SFX). The mascot lineup rows land on the 7.1 / 8.2 / 9.3 every-other-beat drops that the traffic lights used.

## Hyperframes Instructions
Same as run 1: `npx hyperframes@0.7.10` lint / validate / inspect / render (wrapped in package.json scripts; `copy-assets.mjs` pre-hook materializes assets first). Keep text to the reading floor; soft crossfades only; 1080p landscape; 22s.

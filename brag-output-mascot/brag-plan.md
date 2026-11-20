# Brag Plan: Agent Pulse — mascot cut (run 2)

## What is this run?
A second brag video with the **same story spine** as `brag-output/brag-plan.md` (silent stall → notify → read the fleet → guardrail block → calm outro), but the recurring on-screen character is no longer the plain status bubble — it's Agent Pulse's **animated mascot**, recreated faithfully from the real product components:

- `src/renderer/components/Bubble/ClawdMascot.tsx` — Clawd, the boxy terracotta (`#DD775B`) Claude Code hero with black square eyes
- `src/renderer/components/Bubble/CodexMascot.tsx` — the olive Codex frog
- `src/renderer/components/Bubble/KiroMascot.tsx` — the white Kiro ghost

The whole point of the mascots is that the **pose encodes the agent state**:
- waiting → holds up a "Need input" pennant and hops urgently
- working → jogs in place, then jumping jacks with dumbbells
- idle → sleeps on a pillow with drifting "zzz"
- error → red strobe + glitch shudder + X-eyes + a ⚠ alert badge above the head

Rig geometry (every rect/path/gradient) and the GSAP pose choreography are ported verbatim from the components; the only change is that infinite loops become finite repeats on the composition's master timeline so the render is deterministic.

## The angle
Same problem → solution story as run 1:
1. **The silent stall.** You step into a meeting; Claude stops at the first permission check. Clawd stands beside the frozen prompt frantically waving its "Need input" pennant — the state, acted out. Agent Pulse pings you instantly.
2. **The destructive command.** Auto mode fires `rm -rf /`; guardrails block it before it runs.
Unifying idea in the middle: **every agent's mascot acts out its state** — you read the whole fleet at a glance by what each character is DOING.

## Hook (first 2-3 seconds)
Open mid-stall: the recreated Claude Code permission prompt — "Allow Claude to edit files in this session?" — frozen, unanswered, context line "You stepped into a meeting. Claude kept building…". Clawd hops beside it waving the pennant, standing in a pool of the real waiting blue (`#2563eb`).

## Key moments (the middle)
- **The notification turn (~4.5s).** The blue pool pulses, an orange "1" badge pops on Clawd, the toast slides in — "Claude is waiting for you" — punch: **"Agent Pulse pinged you instantly."**
- **The mascot lineup (was: traffic light).** Three mascots in the dark housing, each acting out its state:
  - 🟢 **Claude Code — Working**: Clawd jogs in place, then jumping jacks with dumbbells
  - 🟠 **OpenAI Codex — Idle**: the frog is asleep on its pillow, "zzz" drifting up
  - 🔴 **Kiro — Error**: the ghost strobes red, glitch-shudders, X-eyes, ⚠ alert badge throbbing overhead
  Line: **"Every agent acts out its state."**
- **The guardrail block** (unchanged from run 1): recreated terminal runs `rm -rf /`; red banner slams in — **"Blocked · rm-rf-root."**

## Outro / punchline
Unchanged: logo, wordmark **"Agent Pulse"**, tagline verbatim **"Ambient, glanceable awareness of AI coding agents."**, stats **6 tools · 0 bytes sent · 1 glance**, "100% local. No telemetry.", URL.

## Tone
- Preset: cinematic
- Interpretation: same premium glassmorphism identity, but character-led — the tension and the release are carried by what the mascots are physically doing (frantic pennant-waving dread → a fleet calmly acting out its states → one decisive block). Soft crossfades, quiet dread in Scene 1, no alarms.

## Format: landscape — 1920x1080
## Duration: ~22s

## Visual identity (from the project)
- Same as run 1: mist→fog background, magenta/violet blob, `#006bff` accent, navy/slate/steel text, Manrope.
- Real state palette (`src/common/stateColors.ts`): working `#16a34a`, waiting `#2563eb`, idle-active `#d97706`, error `#dc2626`.
- Mascot colors are the real rig colors: Clawd `#DD775B`, error red `#E5484D`, pillow `#ECE6DA`, pennant `#FBF7EF`/`#5D5B56`.

## Storyboard

### Scene 1 — Claude is waiting (the silent stall) — 6.8s
Context line top. Center: **Clawd** in the WAITING pose — right hand raised, "Need input" pennant waving (±7° about the grip), urgent 0.45s hop loop, occasional worried blink — standing in a waiting-blue pool with a radar ring. Below: the frozen permission prompt card (unchanged copy). At ~4.5s the turn: pool pulses, orange "1" badge pops, toast slides in, punch lands. Soft crossfade out at 6.5.

### Scene 2 — Every agent acts out its state — 5.4s
Left: eyebrow "THE FIX", headline **"Every agent acts out its state."**, subline **"Jumping jacks means working. A nap means idle. A red strobe means something broke. One glance reads the whole fleet."** Right: the dark housing rail with three mascot rows arriving on the every-other-beat grid (7.1 / 8.2 / 9.3):
1. Clawd — jog (3 steps), picks up dumbbells, 7 jumping-jack reps — label Claude Code · Working (green)
2. Codex frog — already asleep on the pillow, breathing, two zzz drift cycles — label OpenAI Codex · Idle (amber)
3. Kiro ghost — alert badge pops (back.out), red strobe (0.18s), glitch shudder, head-shake — label Kiro · Error (red)
All three cells pulse once together at the strong cue 10.93s. Crossfade at 11.5.

### Scene 3 — Guardrails — 5.8s (unchanged from run 1)
"Running unattended on Auto mode?" → terminal → `rm -rf /` → **"⛔ Blocked · rm-rf-root"** slams at 13.11 → punch line.

### Scene 4 — The calm, named — 4.7s (unchanged from run 1)
Logo (17.47), wordmark, tagline, stats (19.66), trust line, URL, music fades 20→22s.

## Audio (identical bed + cue plan to run 1)
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`, low/tense (~0.17) under the stall → lifts to ~0.30 at the 4.5s turn → fades 20→22s.
- SFX: soft drop on prompt (1.5), pop on notify (4.5), drops per lineup row (7.1/8.2/9.3), glass on unified pulse (10.93), decisive clink on the block (13.11), glass on logo (17.473), bell on stats (19.656). No alarms — the Kiro strobe is silent, read not heard.

## How to render (not run in this environment — no shell access)
```
cd brag-output-mascot/composition
npm run assets    # pulls the binary assets from ../../brag-output/composition/assets
npm run check     # hyperframes lint + validate + inspect
npm run render    # then place the mp4 at brag-output-mascot/brag.mp4
```
`copy-assets.mjs` runs automatically before dev/check/render, so `npm run render` alone is enough.

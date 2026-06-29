# Brag Plan: Agent Pulse

## What is this app?
A cross-platform Electron desktop app that floats a small frosted-glass status bubble for every AI coding agent you run (Claude Code, Cursor, Copilot, Codex, Kiro, Antigravity) — so you know at a glance whether each agent is working, waiting for you, idle, or crashed, without tab-hopping. Fully local, no telemetry.

## The angle
This is a calm, premium product film. The whole point of Agent Pulse is *ambient awareness* — you shouldn't have to think about it. So the video shouldn't shout. It opens on the exact anxiety every agent user knows ("is it still working… or did it die?"), answers it with one beautiful glass bubble breathing on the desktop, then quietly reveals that the same calm surface covers six tools plus usage meters, local analytics, and command guardrails. Restraint *is* the pitch.

## Hook (first 2-3 seconds)
A single frosted-glass bubble floats onto a soft light desktop, the Claude logo inside it, wrapped in a soft green pulsing glow with three particles orbiting it — the real "Working" animation. The line settles beneath it: **"Your AI agents, at a glance."** The motion alone says what the product is.

## Key moments (the middle)
- Two more glass bubbles arrive down the edge, each in a *different real state*: Cursor with the orange "1" badge (**Waiting** for you), Codex breathing amber (**Idle**). The status reads itself — green / blue / amber.
- The quiet footer line "localhost:4242 · 3 agents connected" — the unified bridge, stated plainly.
- Three clean feature cards using the actual app screenshots: **Usage meters** (99% available · resets in 3h 18m), **Pulse Timeline** (activity heatmap + estimated cost), **Command guardrails** (Block `rm -rf` root). Real UI, not mockups.

## Outro / punchline
Everything calms back to the logo. Tagline verbatim: **"Ambient, glanceable awareness of AI coding agents."** The three honest stats land — **6 tools · 0 bytes sent · 1 click** — then the trust line "100% local. No telemetry." and the URL.

## User flow worth showing
The "flow" here is passive monitoring, so the centerpiece is the live bubble surface: bubbles arriving and sitting in their true states (Working → Waiting → Idle), which is exactly what a user sees all day. The feature screenshots frame it — at most one card-row, used as a frame around the bubbles, not as a substitute.

## Tone
- Preset: polished
- Creative direction: calm premium product film for a developer's desktop — glassmorphism, soft motion, confidence through restraint.
- Interpretation: fewer scenes, longer holds, soft crossfades. Motion is slow and deliberate (float, breathe, pulse). Nothing snaps or flashes. The glass aesthetic carries the polish.

## Format: landscape — 1920x1080
## Duration: ~20s

## Visual identity (from the project)
- Background: `#f8f9fb` (mist) → `#e7edf6` (fog) soft gradient, mirroring the website hero
- Accent: `#006bff` (signal blue); hero gradient blob `#e55cff` → `#8247f5` (magenta → violet)
- Text: `#0b3558` (midnight navy) headings, `#476788` (slate blue) body
- State palette: working `#16a34a`, waiting `#2563eb`, idle-active `#d97706`, error `#dc2626`
- Display font: Manrope (Variable) — bundled; fall back to system sans
- Body font: Manrope
- Strongest visual element: the frosted-glass bubble with its state animation — pulse-glow + 3 orbiting particles (Working), orange "1" badge (Waiting), breathe (Idle). Recreated in CSS so the motion is crisp. Glass = `backdrop-filter: blur(12px)` over a radial state-color gradient.

## Share copy (draft)
Your AI coding agents, at a glance. Agent Pulse floats a glass bubble on your desktop for Claude Code, Cursor, Copilot, Codex, Kiro & Antigravity — working, waiting, idle, or crashed. 100% local, no telemetry.

## Audio direction
- Role: warm, restrained bed — present but never busy.
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady, clean — the polished pick).
- Music treatment: start at 0.0 at volume ~0.30; gentle fade-in over the first 0.8s; fade out under the final logo from ~18s → 20s. Let the bubble reveals breathe over it.
- Music cue guidance: bundled preset `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`, ~110 BPM. Strong cues at 8.74s, 13.11s, 17.47s, 22.93s. Target the feature-card row to land near 8.74s; lock the logo/payoff near 17.47s. Beat grid (~0.55s spacing) available for the bubble + card sequences, but hold readable text past the grid (snap every other beat).
- Audio-reactive treatment: subtle; use music RMS/bass to make the working-bubble glow and the hero gradient blob breathe slightly. No waveform/equalizer visuals.
- SFX posture: sparse, polished (2-3 cues total). Soft drops for bubble/card arrivals; one gentle bell for the logo payoff. Nothing aggressive.
- Audio-coupled moments: bubble arrivals (soft drop), feature-card arrivals (soft drop), logo land (soft bell).
- Restraint rule: no glitches, no punches, no strobing. Sound supports the calm, never interrupts it.

## Storyboard

### Scene 1 — The glance (Working bubble) — 4.5s
Soft mist→fog gradient backdrop with a faint magenta/violet blob (website hero feel). One frosted-glass bubble floats up into center-frame, Claude logo inside, green pulse-glow ring + 3 particles orbiting (the real Working animation). Status: green dot + "Working". Hook line crossfades up below: **"Your AI agents, at a glance."** and holds.
Sequential/interaction: none — single hero reveal.
Audio intent: warm bed fades in; one soft drop as the bubble settles.
Audio-coupled idea: soft drop on bubble settle (~0.6s).
Music: steady bed begins, low.
Transition mood: soft crossfade → Scene 2

### Scene 2 — All your agents, one surface — 5.5s
The first bubble shifts to a vertical stack on the right (like the real "Agent Status" card). Two more glass bubbles arrive one by one: Cursor with orange "1" badge = **Waiting**; Codex breathing amber = **Idle (active)**. Each row shows logo + tool name + colored dot + state label. Quiet footer fades in: "localhost:4242 · 3 agents connected". Left side holds a calm line: **"Working. Waiting. Idle. Crashed. You just know."**
Sequential/interaction: yes — 3 bubble rows arrive one by one (~0.7s apart), then the full set holds ~2.5s. Soft drop per arrival.
Audio intent: gentle rhythmic arrivals over the bed.
Audio-coupled idea: soft drop on each bubble row (beat-grid, every other beat).
Music: bed continues.
Transition mood: soft crossfade → Scene 3

### Scene 3 — More than bubbles — 6s
Three clean feature cards slide/fade in using the real app screenshots, one by one, each with a short label that holds:
1. **Usage meters** — "Know your limit before you hit it." (usage.png — 99% available · resets 3h 18m)
2. **Pulse Timeline** — "Local analytics. Estimated cost. Zero telemetry." (timeline.png — heatmap + cost)
3. **Command guardrails** — "Block `rm -rf /` before it runs." (guardrails.png)
Cards reveal ~1.4s apart then the trio holds ~2s. First card targets the 8.74s strong cue.
Sequential/interaction: yes — 3 cards one by one; soft drop each; labels hold to the reading floor.
Audio intent: light, confident sequence.
Audio-coupled idea: soft drop per card (beat-grid).
Music: bed lifts slightly toward the strong cue.
Transition mood: soft crossfade → Scene 4

### Scene 4 — The calm, named — 4s
Everything fades to the mist backdrop. The Agent Pulse logo settles in center (beat-locked near 17.47s) with a soft bell. Wordmark "Agent Pulse" + tagline verbatim: **"Ambient, glanceable awareness of AI coding agents."** Three stats fade in on one line: **6 tools · 0 bytes sent · 1 click**. Trust line: "100% local. No telemetry." URL: dipen-dedania.github.io/agent-pulse. Music fades under.
Sequential/interaction: stats fade in together as a single calm line.
Audio intent: soft bell payoff; music gently fades to end.
Audio-coupled idea: soft bell on logo land (beat-locked ~17.47s).
Music: fade out 18s → 20s.
Transition mood: final hold.

**Music mood for this video:** polished / steady / premium
**Audio summary:** A steady, low business-clean bed fades in under the first bubble, carries soft drops as bubbles and feature cards arrive on the beat grid, lifts gently into a soft bell on the logo, then fades out — calm from first frame to last.

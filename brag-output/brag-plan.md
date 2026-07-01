# Brag Plan: Agent Pulse

## What is this app?
A cross-platform Electron desktop app that floats a small frosted-glass status bubble for every AI coding agent you run (Claude Code, Cursor, Copilot, Codex, Kiro, Antigravity). The bubble's color tells you, at a glance, whether that agent is working, waiting, idle, or stopped — and its guardrails block destructive commands before they run. Fully local, no telemetry.

## The angle
A **problem → solution story**, told through two concrete disasters Agent Pulse prevents:
1. **The silent stall.** You step into a meeting trusting Claude to ship the feature — but it stops at the first permission check and just sits there. You come back to nothing done. Agent Pulse pings you the instant it goes blue (waiting), so you never lose those minutes.
2. **The destructive command.** Your agent is on Auto mode and fires `rm -rf /`. Agent Pulse's guardrails block it before it ever runs.
The unifying idea in the middle: **the bubble color is a traffic light** — green working, amber idle, red stopped — so you read your whole fleet in a glance.

## Hook (first 2-3 seconds)
Open mid-stall: a recreated Claude Code permission prompt — "Allow Claude to edit files in this session?" — frozen, unanswered, while a context line reads "You stepped into a meeting. Claude kept building…". The Claude bubble pulses **blue** (waiting). The tension: it's been sitting there, doing nothing.

## Key moments (the middle)
- **The blue-bubble notification.** The waiting bubble does a strong radar pulse, an orange "1" badge pops, a toast slides in — "Claude is waiting for you" — and the punch lands: **"Agent Pulse pinged you instantly."**
- **The traffic light.** Three real agent bubbles stack in a dark housing — 🟢 Claude Code · Working, 🟠 Cursor · Idle, 🔴 Codex · Stopped — lighting up one by one. Line: **"Read it like a traffic light."**
- **The guardrail block.** A recreated terminal runs `rm -rf /`; a red banner slams in — **"Blocked · rm-rf-root — this would wipe the root filesystem."** Line: **"Destructive commands get blocked before they run."**

## Outro / punchline
Calm to the logo. Wordmark **"Agent Pulse"** + tagline verbatim: **"Ambient, glanceable awareness of AI coding agents."** Stats: **6 tools · 0 bytes sent · 1 glance.** Trust line "100% local. No telemetry." then the URL.

## User flow worth showing
Passive monitoring → noticing → acting, plus a safety intercept. Centerpieces: the recreated permission prompt + blue waiting bubble (Scene 1), the traffic-light bubble stack (Scene 2), and the recreated terminal guardrail block (Scene 3) — all grounded in real product UI and copy (`rm-rf-root` rule from the real Guardrails screen).

## Tone
- Preset: polished
- Creative direction: calm premium product film that opens on quiet tension (the frozen prompt) and resolves into clarity and safety. Glassmorphism throughout.
- Interpretation: soft crossfades; Scene 1 carries a relatable, low-grade dread (the stall) that releases when Agent Pulse notifies; Scene 3 has one decisive "block" beat. Anxiety → calm → safety.

## Format: landscape — 1920x1080
## Duration: ~22s

## Visual identity (from the project)
- Background: `#f8f9fb` (mist) → `#e7edf6` (fog) soft gradient; faint magenta/violet blob (`#e55cff`→`#8247f5`).
- Accent: `#006bff` (signal blue).
- Text: `#0b3558` (navy) headings, `#476788` (slate) body, `#a6bbd1` (steel) micro-captions.
- State palette (real, `src/common/stateColors.ts`): working `#16a34a`, waiting `#2563eb`, idle-active `#d97706`, error `#dc2626`.
- Scene 1 uses the **real waiting blue** `#2563eb` (matches the app). Traffic light uses green Working / amber **Idle** (`#d97706`) / red Stopped (`#dc2626`) — all real palette colors.
- Display + body font: Manrope (bundled), fall back to system sans.
- Strongest visual elements: the recreated permission prompt + blue waiting bubble; the vertical traffic light; the recreated terminal guardrail block.

## Share copy (draft)
You step into a meeting trusting your agent to ship — and come back to find it stalled on a permission prompt, or worse, about to run `rm -rf /`. Agent Pulse pings you the second an agent needs you (a blue bubble you read like a traffic light) and blocks destructive commands before they run. 100% local, no telemetry.

## Audio direction
- Role: warm, restrained bed that lifts at the problem→solution turn (the blue-bubble notification ~4.5s).
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`.
- Music treatment: low/tense layer (~0.17) under the stall, lifting to ~0.30 the moment Agent Pulse notifies; fade out under the final logo (20s → 22s).
- Music cue guidance: ~110 BPM. Strong cues 8.74 / 10.93 / 13.11 / 15.84 / 17.47 / 18.56 / 19.66s. Land the unified traffic-light pulse near 10.93; slam the guardrail block on 13.11; beat-lock the logo near 17.47 and the stats near 19.66. Beat grid ~0.55s — hold readable labels to every-other-beat.
- Audio-reactive treatment: subtle/deterministic — blue waiting ring and background blob breathe (real RMS extraction documented as skipped). No waveform/equalizer visuals.
- SFX posture: sparse, polished. Soft drop on the prompt; a gentle notification pop on the blue-bubble turn; soft drops per traffic light; a clean, decisive clink on the guardrail block; glass clink on the logo; soft bell on the stats. No alarms/buzzers.
- Audio-coupled moments: prompt appear (drop), blue-bubble notify (pop, ~4.5), each traffic light (drop, every-other-beat), guardrail block (clink, beat-locked 13.11), logo (clink, 17.47), stats (bell, 19.66).
- Restraint rule: the stall is quiet dread, not an alarm; the block is decisive but clean, not a harsh buzzer.

## Storyboard

### Scene 1 — Claude is waiting (the silent stall) — 6.8s
Mist→fog backdrop. Top context line: **"You stepped into a meeting. Claude kept building…"**. Center: the Claude bubble pulses **blue** (waiting) with a radar ring. Below it, a recreated Claude Code permission prompt card — header "Claude Code · Waiting", title **"Allow Claude to edit files in this session?"**, buttons [Deny] [Allow once] [Allow for session] — frozen, unanswered. At ~4.5s the turn: the bubble does a strong pulse, an orange "1" badge pops, a toast slides in — **"Claude is waiting for you"** — and the punch line lands: **"Agent Pulse pinged you instantly."**
Sequential/interaction: context line → prompt → (stall holds) → turn: badge + toast + punch. Labels hold to the reading floor.
Audio intent: low, slightly uneasy bed; soft drop on the prompt; a warm notification pop at the turn as music lifts.
Audio-coupled idea: soft drop on prompt (~1.5s); notification pop on the blue-bubble turn (~4.5s).
Music: low/tense (~0.17) → lifts to main (~0.30) at the turn.
Transition mood: soft crossfade → Scene 2

### Scene 2 — Read it like a traffic light — 5.4s
Left: eyebrow "THE FIX", headline **"Read it like a traffic light."**, subline **"Green, amber, red — you always know which agent needs you."** Right: three real agent bubbles stacked in a dark traffic-light housing, lighting up one by one:
- 🟢 **Claude Code — Working** (green)
- 🟠 **Cursor — Idle** (amber)
- 🔴 **Codex — Stopped** (red)
Then all three glow once together near 10.93s.
Sequential/interaction: 3 lights one by one (~every-other-beat, 7.1 / 8.2 / 9.3), labels hold; unified glow-pulse near 10.93s.
Audio intent: warm; soft drop per light; gentle swell into the unified pulse.
Music: main bed (~0.30).
Transition mood: soft crossfade → Scene 3

### Scene 3 — Guardrails (the command that never ran) — 5.8s
Headline top: **"Running unattended on Auto mode?"**. A recreated terminal card center: a window bar, then `agent ▸ applying changes…` and the command **`$ rm -rf /`** in danger red. At 13.11s a red banner slams in inside the terminal — **"⛔ Blocked · rm-rf-root"** / "This would wipe the root filesystem." Punch line below: **"Destructive commands get blocked before they run."**
Sequential/interaction: head → terminal → command → BLOCK banner slam (beat-locked 13.11) → punch line.
Audio intent: forward, then one decisive, clean clink on the block.
Audio-coupled idea: clean clink on the block (beat-locked 13.11).
Music: main bed continues.
Transition mood: soft crossfade → Scene 4

### Scene 4 — The calm, named — 4.7s
Fade to mist. Logo settles (beat-locked ~17.47) with a glass clink. Wordmark **"Agent Pulse"** + tagline verbatim: **"Ambient, glanceable awareness of AI coding agents."** Stats land near 19.66 with a soft bell: **6 tools · 0 bytes sent · 1 glance.** Trust line "100% local. No telemetry." then URL: dipen-dedania.github.io/agent-pulse. Music fades under.
Sequential/interaction: stats fade in as one calm line, beat-locked near 19.66.
Audio intent: glass clink on logo, soft bell on stats; music fades to end.
Music: fade out 20s → 22s.
Transition mood: final hold.

**Music mood for this video:** polished / steady / premium, with a quiet→warm lift at the blue-bubble notification turn
**Audio summary:** A low, uneasy bed holds under the silent stall, then lifts into a warm steady bed the moment Agent Pulse notifies; soft drops mark each traffic light, a clean clink slams the guardrail block, a glass clink lands the logo and a soft bell lands the stats, then the bed fades out under the wordmark.

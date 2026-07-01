# Hyperframes Composition Brief: Agent Pulse

## Objective
Create a short, polished launch-style brag video for Agent Pulse, told as a **problem → solution story**: open on the disaster of an unnoticed crash, resolve with the traffic-light bubble metaphor, pay off with token utilization.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: ~20 seconds

## Source Material
- Project root: `E:\DDrive\Github\agent-pulse`
- Primary files read: README.md, github-pages/index.html + components, `src/common/stateColors.ts` (real state palette), `src/common/types.ts` (AgentState).
- Product name: Agent Pulse
- Tagline / strongest claim: "Ambient, glanceable awareness of AI coding agents."
- Key UI / visual to recreate: the frosted-glass status bubble and its state color. New hero treatment = a **vertical traffic light made of three real agent bubbles** (green Working / amber Waiting-for-you / red Stopped) in a subtle dark housing/rail. Glass = `backdrop-filter: blur(12px)` over a radial state-color gradient, `border: 1px solid #d4e0ed`, rounded-full.
- Real screenshots to use (already in `assets/screenshots/`): `usage.png`, `timeline.png`, plus `claude.png` / `claude-row.png` / `cursor.png` / `codex.png` for bubble logos, `logo.png` for outro.
- Copy that must appear verbatim:
  - "It crashed 14 minutes ago." / "You didn't notice."
  - "Read it like a traffic light."
  - "Every idle minute is wasted tokens."
  - "Ambient, glanceable awareness of AI coding agents."
  - "100% local. No telemetry."
  - Stats: "6 tools", "0 bytes sent", "1 glance"

## Creative Direction
- Tone preset: polished
- Creative direction: calm premium product film that opens on quiet tension (lonely red crash) and releases into effortless clarity (the traffic light). Glassmorphism throughout.
- Interpretation: soft crossfades; Scene 1 carries unease (slow heavy red pulse, single bubble); the tension releases the instant the traffic light reveals and the music lifts. Anxiety → calm is the story.
- Angle: agents run unseen → one crashes and you keep waiting, wasting tokens → the bubble color is a traffic light (green work / amber your turn / red stopped) → you always know → no agent sits idle → every token counts.
- Hook: a single red bubble pulsing alone, "Stopped · 14 min ago", line "It crashed 14 minutes ago." → "You didn't notice."
- Outro / punchline: calm to logo + verbatim tagline + stats (6 tools · 0 bytes sent · 1 glance) + "100% local. No telemetry." + URL.
- Avoid:
  - Generic SaaS language ("streamline your workflow")
  - Abstract filler visuals / particle storms / equalizer bars
  - Making Scene 1 a blaring ALARM — it's quiet dread, not a buzzer
  - Any redesign that fights the glassmorphism brand

## Visual Identity
- Background: `#f8f9fb` (mist) → `#e7edf6` (fog) soft gradient; faint magenta→violet blob (`#e55cff`→`#8247f5`) behind content, low opacity.
- Text: `#0b3558` (midnight navy) headings; `#476788` (slate blue) body; `#a6bbd1` (steel) micro-captions.
- Accent: `#006bff` (signal blue).
- Real state colors: working `#16a34a`, waiting `#2563eb`, idle-active `#d97706`, error `#dc2626`.
- Traffic-light mapping (story device, all from the real palette): green = Working (`#16a34a`), amber = Waiting for you (`#d97706`), red = Stopped (`#dc2626`).
- Display + body font: Manrope — bundled `assets/fonts/manrope-latin.woff2`, else system sans.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. The disaster — 4.0s — lonely red bubble, slow heavy pulse, "Stopped · 14 min ago"; "It crashed 14 minutes ago." → "You didn't notice."
2. Read it like a traffic light — 6.4s — left: "Read it like a traffic light." + subline; right: 3 real agent bubbles stacked in a dark traffic-light housing, lighting up one by one (green Working / amber Waiting for you / red Stopped), unified glow pulse near 8.74s.
3. Every idle minute is wasted tokens — 5.6s — headline + subline; 2 real-screenshot cards (usage / timeline) arrive one by one near the strong cues.
4. The calm, named — 4.0s — logo + "Agent Pulse" + tagline + stats (6 tools · 0 bytes sent · 1 glance) + "100% local. No telemetry." + URL.

## Audio
- Audio role: warm, restrained bed that swells into the solution.
- Audio arc: low/uneasy bed under Scene 1 (the crash) → lifts to a warm steady bed the instant the traffic light reveals → soft drops mark each light and card on the beat grid → glass clink on the logo, soft bell on the stats → fade out under the wordmark.
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (in `assets/music/`).
- Music treatment: two-part bed — low layer (~0.16) for Scene 1, main bed (~0.30) from the Scene 2 reveal (~3.7s); fade out 18s→20s. Never above 0.34. The volume lift is the problem→solution turn.
- Music cue guidance: bundled preset, ~110 BPM. Strong cues 8.74 / 10.93 / 13.11 / 15.84 / 17.47s. Unified traffic-light glow near 8.74; screenshot cards near 10.93 / 13.11; beat-lock logo near 15.84; beat-lock stats on 17.47. Beat grid ~0.55s — hold readable labels to every-other-beat.
- Audio-reactive treatment: subtle/deterministic — hero red glow + background blob breathe via deterministic GSAP yoyo (real RMS extraction documented as skipped: no helper/ffmpeg guaranteed; do not block the render). No waveform/equalizer/notes.
- Audio-coupled moments:
  - Scene 1 red bubble settle — soft low drop
  - Scene 2 each traffic-light arrival — soft drop (every-other-beat: ~4.9 / 5.9 / 6.9)
  - Scene 3 each card — soft drop (beat-locked ~10.93 / 13.11)
  - Scene 4 logo land — glass clink (beat-locked 15.84); stats — soft bell (beat-locked 17.47)
- SFX selection guidance: polished + sparse. `interface/drop_001.ogg` / `drop_002.ogg` for arrivals; `impact/impactGlass_light_001.ogg` for the logo; `impact/impactBell_heavy_000.ogg` (soft) for stats. All ~0.45–0.6 volume. Scene 1 drop should be low/soft — no alarm character. Read `sfx-analysis.md` and prefer low high-frequency-risk files.
- SFX analysis guidance: `C:/Users/ZTI Tech Lead/.claude/plugins/cache/brag/brag/0.1.0/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: Hyperframes picks final filenames/timestamps/volume based on the implemented animation.
- Audio files: chosen music + SFX already copied into `assets/`.

## Hyperframes Instructions
Use the current `hyperframes` skill and CLI workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI/copy/visual element (the recreated bubbles + the real screenshots both satisfy this).
- Keep all text readable (reading floor: short label ~0.8s settled, sentence ~0.3s/word). The hook lines and headlines get the most hold.
- Keep the video 15–25s (~20s target).
- Music bed + sparse SFX; treat audio notes as guidance, pick exact SFX after the animation exists.
- 1–3 strong-cue locks only (logo 15.84, stats 17.47 are the primary ones; unified light-pulse 8.74; cards 10.93/13.11).
- Soft crossfades only — polished transition vocabulary. No hard cuts, flashes, or zooms.
- Run `npx hyperframes lint`, `validate`, and `inspect` before render; fix contrast below 3:1 (large) / 4.5:1 (body) and any overflow.

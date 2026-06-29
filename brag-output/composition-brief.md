# Hyperframes Composition Brief: Agent Pulse

## Objective
Create a short, calm, premium launch-style brag video for Agent Pulse.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: ~20 seconds

## Source Material
- Project root: `E:\DDrive\Github\agent-pulse`
- Primary files read: README.md, github-pages/index.html, github-pages/src/theme.css, github-pages/src/components/Hero.tsx, StatsBar.tsx, BubbleMockup.tsx
- Product name: Agent Pulse
- Tagline / strongest claim: "Ambient, glanceable awareness of AI coding agents." / "Your AI agents, at a glance."
- Key UI or visual moment to recreate: the frosted-glass status bubble with its real state animations (Working = green pulse-glow + 3 orbiting particles; Waiting = orange "1" badge; Idle-active = amber breathe). Recreate in CSS for crisp motion. Glass = `backdrop-filter: blur(12px)` over a radial state-color gradient, `border: 1px solid #d4e0ed`, rounded-full.
- Real screenshots to use as feature-card imagery (copied into `assets/screenshots/`): `usage.png`, `timeline.png`, `guardrails.png`.
- Copy that must appear verbatim:
  - "Your AI agents, at a glance."
  - "Ambient, glanceable awareness of AI coding agents."
  - "100% local. No telemetry."
  - "localhost:4242 · 3 agents connected"
  - Stats: "6 tools", "0 bytes sent", "1 click"

## Creative Direction
- Tone preset: polished
- Creative direction: calm premium product film for a developer's desktop — glassmorphism, soft motion, confidence through restraint.
- Interpretation: fewer scenes, longer holds, soft crossfades only. Motion is slow/deliberate (float, breathe, pulse). Nothing snaps, flashes, or strobes. The glass aesthetic carries the polish.
- Angle: Open on the universal agent anxiety ("is it still working… or did it die?"), answer it with one beautiful glass bubble breathing on the desktop, then quietly reveal the same calm surface covers six tools + usage meters + local analytics + guardrails. Restraint is the pitch.
- Hook: a single frosted-glass bubble floats in with the Claude logo, green pulse-glow + 3 orbiting particles; line settles "Your AI agents, at a glance."
- Outro / punchline: calm back to the logo + verbatim tagline + the three honest stats (6 tools · 0 bytes sent · 1 click) + "100% local. No telemetry." + URL.
- Avoid:
  - Generic SaaS language ("streamline your workflow")
  - Abstract filler visuals / particle storms / equalizer bars
  - Any visual redesign that fights the glassmorphism brand

## Visual Identity
- Background: `#f8f9fb` (mist) → `#e7edf6` (fog) soft gradient; faint magenta→violet blob (`#e55cff`→`#8247f5`) behind the bubbles, low opacity, like the website hero
- Text: `#0b3558` (midnight navy) headings; `#476788` (slate blue) body; `#a6bbd1` (steel) micro-captions
- Accent: `#006bff` (signal blue)
- State colors: working `#16a34a`, waiting `#2563eb` (+ badge `#ea580c`), idle-active `#d97706`
- Display font: Manrope — use the bundled `@fontsource-variable/manrope` if available, else system sans (ui-sans-serif, system-ui, "Segoe UI")
- Body font: Manrope
- Visual references: BubbleMockup.tsx (exact bubble + state markup), Hero.tsx (gradient blob + float), StatsBar.tsx (the 3 stats and their labels)

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. The glance (Working bubble) — 4.5s — one glass bubble floats in, green pulse + orbiting particles; "Your AI agents, at a glance." holds.
2. All your agents, one surface — 5.5s — 3 bubble rows arrive one by one (Working/Waiting/Idle) in the Agent Status card; footer "localhost:4242 · 3 agents connected"; line "Working. Waiting. Idle. Crashed. You just know."
3. More than bubbles — 6s — 3 feature cards (usage / timeline / guardrails screenshots) reveal one by one with short labels that hold.
4. The calm, named — 4s — logo + "Agent Pulse" + tagline + stats (6 tools · 0 bytes sent · 1 click) + "100% local. No telemetry." + URL.

## Audio
- Audio role: warm, restrained bed — present but never busy.
- Audio arc: bed fades in under the first bubble → soft drops as bubbles/cards arrive on the beat grid → gentle lift + soft bell on the logo → fade out under the wordmark.
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (copy into `assets/music/`).
- Music treatment: start 0.0, volume ~0.30, fade-in ~0.8s, fade out 18s→20s under the logo. Never above 0.4.
- Music cue guidance: bundled preset `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`, ~110 BPM. Strong cues 8.74s / 13.11s / 17.47s / 22.93s. Target feature-card row near 8.74s; beat-lock the logo/payoff near 17.47s. Beat grid ~0.55s for sequential arrivals — but hold readable text past the grid (snap every other beat).
- Audio-reactive treatment: subtle; follow the current Hyperframes audio-reactive workflow (its `references/audio-reactive.md`) to extract per-frame data and make the Working-bubble glow + hero gradient blob breathe with RMS/bass. No waveform/equalizer/notes. If extraction is unavailable (no helper / no ffmpeg), document it and skip — do not block the render.
- Audio-coupled moments:
  - Scene 1 bubble settle — soft drop
  - Scene 2 each bubble row — soft drop (beat-grid, every other beat)
  - Scene 3 each feature card — soft drop (beat-grid)
  - Scene 4 logo land — soft bell (beat-locked ~17.47s)
- SFX selection guidance: polished + sparse (2-3 cues total). `interface/drop_001.ogg` or `drop_002.ogg` for arrivals; `impact/impactBell_heavy_000.ogg` (or a soft glass clink) for the logo. All ~0.55-0.7 volume. Read `sfx-analysis.md` and prefer low high-frequency-risk files for the repeated drops.
- SFX analysis guidance: `C:/Users/ZTI Tech Lead/.claude/plugins/cache/brag/brag/0.1.0/skills/brag/assets/sfx/sfx-analysis.md`
- Exact SFX choice: Hyperframes picks filenames, timestamps, density, volume based on the implemented animation.
- Audio files: copy the chosen music + any selected SFX into `brag-output/composition/assets/`.

## Hyperframes Instructions
Use the current `hyperframes` skill and CLI workflow. Prefer native Hyperframes conventions over anything in `/brag`.

Requirements:
- Show at least one real UI/copy/visual element from the source (the recreated bubbles + the three real screenshots both satisfy this).
- Keep all text readable in the final render (reading-floor: short label ~0.8s settled, sentence ~0.3s/word).
- Keep the video within 15-25 seconds (~20s target).
- Include the music bed + sparse SFX unless audio assets are missing.
- Treat audio notes as guidance; choose exact SFX after the animation exists.
- Use only 1-3 strong cue locks (logo payoff near 17.47s is the primary one).
- Soft crossfades only — match the polished transition vocabulary. No hard cuts, flashes, or zooms.
- Run `npx hyperframes lint` and `validate` before render; fix contrast below 3:1 (large) / 4.5:1 (body).

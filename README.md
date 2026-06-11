<p align="center">
  <img src="public/assets/logo-transparent.png" alt="Agent Pulse" width="160" />
</p>

<h1 align="center">Agent Pulse</h1>

<p align="center"><em>Ambient, glanceable awareness of AI coding agents.</em></p>

Agent Pulse is a cross-platform Electron desktop app that surfaces the state of every AI coding agent on your machine through floating, always-on-top status bubbles. Instead of tab-hopping between Claude Code, Cursor, Codex, Copilot, Kiro, and Antigravity to check whether an agent is still working, idle, or has crashed, you see it at a glance in a frosted-glass bubble — anywhere on your desktop.

It also bundles a unified status bridge, subscription usage meters for Claude / Codex / Cursor / Antigravity, a local Pulse Timeline with estimated-cost analytics, a configurable Claude Code status line, Discord/Slack attention webhooks, a cowork session scheduler, and a configurable shell-command guardrail engine.

---

## Download

Grab the latest signed installer from the **[Releases page](https://github.com/Dipen-Dedania/agent-pulse/releases/latest)**:

| Platform | File |
| --- | --- |
| Windows | `Agent-Pulse-Setup-<version>.exe` (NSIS) |
| macOS   | `Agent-Pulse-<version>.dmg` (arm64 + x64) |

Stable per-version URLs follow the GitHub pattern, e.g.:
```
https://github.com/Dipen-Dedania/agent-pulse/releases/latest/download/Agent-Pulse-Setup.exe
```
*The repo is private, so downloads require sign-in with access. In-progress builds for any commit on `main` are also available as workflow artifacts on the [Actions tab](https://github.com/Dipen-Dedania/agent-pulse/actions/workflows/release.yml) (30-day retention).*

---

## Highlights

### Ambient status bubbles
- Always-on-top, draggable, per-tool bubbles with an Apple Glass (glassmorphism) look.
- Animated state indicators powered by Framer Motion:
  - **Working** — soft pulsing glow with orbiting particles.
  - **Waiting** — agent is awaiting your input.
  - **Idle / Idle-active** — calm breathing effect.
  - **Error / Dead** — red glow plus a shake.
- Toggle each bubble independently from Settings; the layout persists across restarts.

### Unified status bridge
- Local HTTP server on `http://localhost:4242/event` that ingests lifecycle events from every supported tool.
- Normalizes vendor-specific event names (`PreToolUse`, `Stop`, `agentSpawn`, etc.) into a single `AgentState` schema (`src/common/types.ts`).
- One-click hook install/uninstall per tool from the Settings panel.

### Supported tools
| Tool | Surface | Hook mechanism |
| --- | --- | --- |
| Claude Code | CLI | HTTP hook (`~/.claude/settings.json`) |
| Cursor | IDE | Shell hook (`~/.cursor/hooks.json`) |
| GitHub Copilot (VS Code) | IDE | Shell hook (`.github/hooks/agent-pulse-hooks.json`) |
| OpenAI Codex | CLI | Shell hook (`~/.codex/hooks.json`) |
| Kiro | IDE | Shell hook (`.kiro/hooks/agent-pulse.kiro.hook`) |
| Antigravity | **CLI + IDE** | Shell hook (`~/.gemini/config/hooks.json`) — one install covers both surfaces |

### Subscription usage tracking
- **Claude Code** — polls Anthropic's OAuth usage endpoint for the 5-hour and 7-day windows.
- **OpenAI Codex** — polls ChatGPT's `/backend-api/wham/usage` for primary (and optional secondary) windows.
- **Cursor** — polls `cursor.com/api/usage-summary` for the billing-cycle window (utilization %, reset time, plan), authenticated via a session cookie built from Cursor's local `state.vscdb`.
- **Antigravity** — polls the IDE's local gRPC-Web endpoint for per-model quotas while the IDE is running.
- Configurable cap-warning ("you're about to hit your limit") and nudge ("use it or lose it before reset") notifications.

### Command guardrails
- Block or warn on risky shell commands before they reach an agent (e.g. `rm -rf /`, `git push --force` to protected branches).
- Built-in core rule set plus user-defined custom rules with validated regex.
- Live event log of triggered guardrails in the Settings panel.

### Pulse Timeline (Analytics tab)
- Local SQLite database (`<userData>/pulse-timeline.db`) persists every normalized event, derived session, and quota snapshot.
- **Daily digest** — today + yesterday active time, sessions, top tasks, tokens, and quota burned per tool.
- **Activity heatmap** — GitHub-contrib-style grid over 30 or 90 days, grouped by tool, project, or combined. Project tracking walks up to the nearest `.git` root from each hook's `cwd`.
- **Hour-of-day rhythm** — 24-bucket histogram of when you actually pair with agents.
- **Tool mix** — share of active time per tool over 7 or 30 days.
- **Model usage** — token + session breakdown per model. v1 captures Claude Code via transcript tailing; other tools' coverage depends on whether their hooks expose a model field.
- **Estimated cost** — digest, model-usage, tool-mix, and token-timeline cards can switch to a cost view. These are **estimated API list prices only** (input / output / cache-write / cache-read), never real subscription billing. Prices come from a live LiteLLM table cached locally and refreshed daily (offline-safe; falls back to a bundled table). Models without a known price are flagged "unpriced".
- **Project breakdown** — ranked list of `.git` roots by total active time, with the agents that touched each.
- Fully local; no telemetry. Privacy toggle redacts task summaries from storage. Idle-gap is configurable. 60-day retention on events and quota samples; sessions kept forever (~300 KB / 30 days).
- Requires the native module `better-sqlite3`. Run `npm run rebuild:native` after install. If the rebuild fails, the rest of the app keeps working — the timeline simply records nothing until you rebuild.

### Claude Code status line
- Configurable status line rendered by Claude Code at the bottom of each turn, installed into `~/.claude/settings.json` with one click.
- Segment-based: pick from model name, context-usage bar, cwd, project dir, git branch, repo, session cost, duration, lines changed, 5-hour / 7-day rate-limit windows, output style, effort level, vim mode, and PR number.
- A single reference renderer (`src/common/statusline-render.ts`) is exported to a Node/Python/PowerShell script so the line stays consistent across shells; layout, separators, colors, and per-line wrapping are configurable in Settings.
- Detects and backs up an existing status line before replacing it.

### Attention webhooks (Discord / Slack)
- An attention engine watches each tool; when an agent sits in the **Waiting** state past a configurable threshold, it escalates once per waiting episode.
- Escalation can intensify the bubble badge, raise an OS notification, and POST to one or more **Discord** and/or **Slack** webhooks (Discord embeds / Slack mrkdwn) with the tool name, task summary, and idle duration.
- Per-webhook enable toggles and a "send test" button to validate a URL before relying on it.

### Cowork scheduler
- Optionally keeps Claude Code's 5-hour windows warm by firing minimal `claude -p` opener pings on a schedule, so a fresh window is ready when you start work.
- **Fixed** mode (explicit time + weekday slots) or **adaptive** mode (one opener per window reset inside your work hours), with a per-day opener cap.
- Optional token-refresh nudge fires shortly before the OAuth token expires when no opener is otherwise due. Openers are tiny (~a fraction of a cent each).

### Desktop integration
- **Single-instance** — launching the app a second time focuses the running instance instead of spawning a duplicate (which would also collide on the bridge port).
- **Launch on startup** — toggle in Settings; works on Windows (login items), macOS (login items, launched hidden), and Linux (`~/.config/autostart/agent-pulse.desktop`).
- **Tray-resident** — the app keeps living after the last window closes; quit from the tray menu.

---

## Quick start

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- npm (ships with Node.js)

### Install & run in dev
```bash
git clone https://github.com/Dipen-Dedania/agent-pulse.git
cd agent-pulse
npm install
npm start
```
This launches the Vite renderer and the Electron main process together.

### Package a production build
```bash
npm run dist:win     # NSIS installer for Windows x64
npm run dist:mac     # DMG for macOS (arm64 + x64)
npm run dist:linux   # AppImage for Linux
npm run dist:all     # All three (use sparingly — slow)
```
Output lands in `release/`.

### Cutting a release
The `Build Distribution` workflow publishes a GitHub Release whenever a `v*` tag is pushed:
```bash
# bump version in package.json first
git tag v1.0.1
git push origin v1.0.1
```
The workflow builds Windows and macOS installers, attaches them (plus `latest.yml` / `latest-mac.yml` for auto-update), and generates release notes from commits since the previous tag.

---

## Auto-updates

Agent Pulse ships with an in-app updater that quietly keeps every installed copy on the latest signed build.

### How it works
- **Engine**: `electron-updater` runs inside the main process (`src/main/updater/manager.ts`). The renderer's *Settings → Updates* tab is purely a view onto that state, broadcast via IPC.
- **Feed**: Each installer is permanently tied to one update feed, baked into `app-update.yml` at build time. The default — and what production ships — is **Firebase Storage** (a GCS-backed bucket). The `electron-builder.config.cjs` `publish` block points at `https://storage.googleapis.com/bitsy-cc3f6.firebasestorage.app/agent-pulse/releases/`. Flipping `UPDATE_PROVIDER` to `'github'` is supported for emergency fallback but isn't the default.
- **Check cadence**: One jittered check **30–120 s after launch** (so a corporate-NAT fleet doesn't stampede the feed), then every **6 hours** while the app stays open. The "Check now" button is throttled to once per 10 min.
- **User control**: downloads are *never* automatic — the user clicks **Download**, then **Restart & install** when ready. Auto-install-on-quit is disabled because the tray keeps the app alive past window-close, and silently swapping the binary under the user wouldn't be clean UX.
- **Platforms**: Windows (NSIS) auto-updates end-to-end. macOS surfaces an `unsupported` status with a manual-install banner — code signing + notarization aren't wired yet. Dev / unpackaged runs report `disabled` instead of silently failing.
- **Soft failures**: `403` / `429` responses are treated as soft failures (no user-visible error); the next periodic check retries.

### Releasing a new build

The CI workflow (`.github/workflows/release.yml`) handles building, signing-free packaging, and uploading. You just bump and tag.

1. **Bump `package.json`** to the new version (e.g. `1.1.5`) and commit it on `main`.
2. **Tag and push** — this is the trigger:
   ```bash
   git tag v1.1.5
   git push origin v1.1.5
   ```
   Alternatively, use **Actions → Build Distribution → Run workflow** and type the version. The workflow refuses to run if the typed version doesn't match `package.json` — cheap insurance against typos.
3. **The workflow then** (matrix: `windows-latest` and `macos-latest`):
   - Installs deps with `npm ci`, runs `npm test`.
   - Builds installers via `npm run dist:win` / `npm run dist:mac`.
   - Authenticates to GCP using the `GCP_SA_KEY` service-account credential.
   - **Uploads installers first**, then `latest.yml` / `latest-mac.yml` last with `Cache-Control: no-cache`. Ordering matters: if clients see `latest.yml` before the binary lands, they'll 404 on download. The no-cache header bypasses the default 1 h GCS edge cache so users see the new release immediately.
   - Publishes a GitHub Release with the same artifacts for changelog visibility (auto-update *does not* read from GitHub — the Firebase feed is canonical).
4. **What landing in Firebase looks like**: under `gs://bitsy-cc3f6.firebasestorage.app/agent-pulse/releases/` you'll see `Agent-Pulse-Setup-<version>.exe`, its `.blockmap`, `Agent-Pulse-<version>.dmg` (arm64 + x64), and the manifest files. Installed clients poll `latest.yml` from there.

### Required secrets / setup (one-time)
- **`GCP_SA_KEY`** — repo secret. JSON key for a GCP service account with `roles/storage.objectAdmin` on the `bitsy-cc3f6.firebasestorage.app` bucket (or at least on the `agent-pulse/releases/` prefix).
- **Bucket read access** — the `agent-pulse/releases/` prefix must grant `roles/storage.objectViewer` to `allUsers` so `electron-updater` can fetch `latest.yml` and binaries without auth. Without this, installed clients silently fail every check.
- **`GITHUB_TOKEN`** — provided automatically by GitHub Actions for the parallel GitHub Release publish.

### Verifying / debugging an update
- Local check: install a stale build, launch it, watch the `[UpdaterManager]` and `[electron-updater]` lines in the main-process log. The launch check fires 30–120 s in.
- Force a check from the UI: *Settings → Updates → Check now* (respects the 10-min throttle).
- Confirm what feed a given build is using: open `<install-dir>/resources/app-update.yml` — it shows the baked-in provider URL.

---

## npm scripts

| Script | What it does | When to use |
| --- | --- | --- |
| `npm start` | Runs Vite + Electron concurrently via `concurrently` and `wait-on`. | Day-to-day development. |
| `npm run start:info` | `npm start` with `AGENT_PULSE_LOG_LEVEL=info`. | More verbose main-process logs. |
| `npm run start:warn` | `npm start` with `AGENT_PULSE_LOG_LEVEL=warn`. | Quieter logs. |
| `npm run start:error` | `npm start` with `AGENT_PULSE_LOG_LEVEL=error`. | Errors only. |
| `npm run dev:renderer` | Vite dev server only (port 5173). | Pure UI iteration without the Electron main process. |
| `npm run dev:main` | Builds the main process and launches Electron against the running Vite server. | When the renderer is already running elsewhere. |
| `npm run build:main` | Compiles the Electron main process (`tsc -p tsconfig.main.json`). | Pre-flight for packaging or main-process type checks. |
| `npm run build:renderer` | Builds the React renderer with Vite. | Production renderer bundle. |
| `npm run build` | Runs `build:main` then `build:renderer`. | Full production build before packaging. |
| `npm run test:bridge` | Sends simulated hook events through the bridge without the GUI. | Smoke-test bridge normalization. |
| `npm test` | Runs the Vitest suite once. | CI and pre-commit. |
| `npm run test:watch` | Vitest in watch mode. | TDD loop. |
| `npm run test:coverage` | Vitest with V8 coverage. | Coverage reports under `coverage/`. |
| `npm run pack` | `npm run build` + `electron-builder --dir` (unpacked). | Fast local sanity-check of the packaged app. |
| `npm run dist` | `npm run build` + `electron-builder`. | Build installers for the current platform. |
| `npm run dist:win` / `dist:mac` / `dist:linux` | Targeted installer builds with `--publish never`. | Cut a single-platform artifact. |
| `npm run dist:all` | All three platforms (`-mwl`). | Multi-OS release. |
| `npm run rebuild:native` | Rebuild `better-sqlite3` against the current Electron ABI. | After `npm install`, or whenever Pulse Timeline logs `better-sqlite3 not loadable`. |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  Agent Pulse (Electron app)                 │
│                                                             │
│   ┌──────────────┐                  ┌──────────────────┐    │
│   │  Main proc   │  ── IPC ──▶      │   Renderer       │    │
│   │              │                  │  (React + Vite)  │    │
│   │  • Bridge    │ ◀── IPC ──       │                  │    │
│   │  • Installer │                  │  • Bubbles       │    │
│   │  • Pollers   │                  │  • Settings      │    │
│   │  • Tray      │                  │                  │    │
│   └──────┬───────┘                  └──────────────────┘    │
└──────────┼──────────────────────────────────────────────────┘
           │ HTTP POST  (localhost:4242/event)
           │
┌──────────┴───────────────────────────────────────────────────┐
│   Tool hooks: Claude Code · Cursor · Copilot · Codex ·       │
│               Kiro · Antigravity (CLI + IDE)                 │
└──────────────────────────────────────────────────────────────┘
```

- **Main process** (`src/main/`) owns the HTTP bridge, tool detection, hook writing, usage pollers, guardrail engine, and window/tray management.
- **Renderer** (`src/renderer/`) is a React 19 + Tailwind CSS 4 SPA. It renders both bubbles and the Settings window using URL params (`?view=settings`, `?toolId=<id>`).
- **Bridge** (`src/main/bridge/`) listens on port `4242`, normalizes events, and pushes the resulting state to all renderer windows via IPC.
- **Common** (`src/common/`) holds the shared event schema, tool metadata, logger, and guardrail types used by both processes.

## Project structure

```
src/
├── common/            # Shared types, logger, tool metadata, guardrails schema
├── main/
│   ├── bridge/        # HTTP server + state manager
│   ├── installer/     # Tool detection + hook config writers
│   ├── usage/         # Claude usage poller
│   ├── codex-usage/   # Codex usage poller
│   ├── cursor-usage/  # Cursor usage poller
│   ├── antigravity-usage/  # Antigravity IDE usage poller
│   ├── llm-pricing/   # LiteLLM price-table poller (estimated-cost analytics)
│   ├── timeline/      # SQLite Pulse Timeline store + writers
│   ├── attention/     # Waiting-state escalation engine
│   ├── notifications/ # Discord/Slack webhook senders
│   ├── scheduler/     # Cowork session opener scheduler
│   ├── guardrails/    # Core rules + regex safety engine
│   ├── windows/       # Bubble/Settings BrowserWindow + tray + preload
│   ├── auto-launch.ts # Cross-OS login-item / autostart integration
│   ├── user-config.ts # Persisted UserConfig in ~/.claude/agent-pulse-config.json
│   └── index.ts       # App entry: single-instance lock, IPC wiring
└── renderer/
    ├── components/Bubble/    # Animated status bubbles
    ├── components/Settings/  # Hooks, Usage, Guardrails tabs
    ├── hooks/                # React hooks
    └── store/                # Zustand store
```

## Testing

Run the full Vitest suite:
```bash
npm test
```

What's covered:
- **Bridge event normalization** — all supported tools × every hook event → correct `AgentState`.
- **Bubble animations** — every tool × every state renders the right Framer Motion variant.
- **Zustand status store** — state updates, multi-tool independence, initial hydration.
- **Hook installer** — `installHook` / `uninstallHook` round-trip for each tool.
- **Guardrail engine** — pattern matching and regex safety validation.

For a quick end-to-end check without launching the GUI:
```bash
npm run test:bridge
```

---

## Config files Agent Pulse touches

| Path | Purpose |
| --- | --- |
| `~/.claude/agent-pulse-config.json` | Persisted user settings (enabled bubbles, usage, guardrails, status line, attention webhooks, scheduler, auto-launch). |
| `~/.claude/settings.json` | Claude Code HTTP hooks + status line registration. |
| `~/.claude/` status-line script (`.js` / `.py` / `.ps1`) | Status line renderer invoked by Claude Code. |
| `~/.claude/llm-pricing-cache.json` | Cached LiteLLM price table for estimated-cost analytics. |
| `~/.cursor/.../state.vscdb` *(read-only)* | Source of the Cursor session token used for usage polling. |
| `~/.cursor/hooks.json` (+ script) | Cursor shell hooks. |
| `.github/hooks/agent-pulse-hooks.json` (+ script) | GitHub Copilot per-workspace hooks. |
| `~/.codex/hooks.json` + `~/.codex/config.toml` | Codex hooks + `codex_hooks` feature flag. |
| `.kiro/hooks/agent-pulse.kiro.hook` (+ script) | Kiro hooks. |
| `~/.gemini/config/hooks.json` (+ script) | Antigravity CLI **and** IDE hooks. |
| `~/.config/autostart/agent-pulse.desktop` *(Linux only)* | Launch-on-startup entry. |

All hook files can be uninstalled from the Settings panel with one click.

---

## License

Agent Pulse is open source under AGPLv3. For commercial use without AGPL obligations, a paid license is available. Contact dipen27891@gmail.com for details.

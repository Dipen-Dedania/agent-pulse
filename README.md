<p align="center">
  <img src="public/assets/logo-transparent.png" alt="Agent Pulse" width="160" />
</p>

<h1 align="center">Agent Pulse</h1>

<p align="center"><em>Ambient, glanceable awareness of AI coding agents.</em></p>

Agent Pulse is a cross-platform Electron desktop app that surfaces the state of every AI coding agent on your machine through floating, always-on-top status bubbles. Instead of tab-hopping between Claude Code, Cursor, Codex, Copilot, Kiro, and Antigravity to check whether an agent is still working, idle, or has crashed, you see it at a glance in a frosted-glass bubble — anywhere on your desktop.

It also bundles a unified status bridge, subscription usage meters for Claude / Codex / Antigravity, and a configurable shell-command guardrail engine.

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
- **Antigravity** — polls the IDE's local gRPC-Web endpoint for per-model quotas while the IDE is running.
- Configurable cap-warning ("you're about to hit your limit") and nudge ("use it or lose it before reset") notifications.

### Command guardrails
- Block or warn on risky shell commands before they reach an agent (e.g. `rm -rf /`, `git push --force` to protected branches).
- Built-in core rule set plus user-defined custom rules with validated regex.
- Live event log of triggered guardrails in the Settings panel.

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
│   ├── antigravity-usage/  # Antigravity IDE usage poller
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
| `~/.claude/agent-pulse-config.json` | Persisted user settings (enabled bubbles, usage, guardrails, auto-launch). |
| `~/.claude/settings.json` | Claude Code HTTP hooks. |
| `~/.cursor/hooks.json` (+ script) | Cursor shell hooks. |
| `.github/hooks/agent-pulse-hooks.json` (+ script) | GitHub Copilot per-workspace hooks. |
| `~/.codex/hooks.json` + `~/.codex/config.toml` | Codex hooks + `codex_hooks` feature flag. |
| `.kiro/hooks/agent-pulse.kiro.hook` (+ script) | Kiro hooks. |
| `~/.gemini/config/hooks.json` (+ script) | Antigravity CLI **and** IDE hooks. |
| `~/.config/autostart/agent-pulse.desktop` *(Linux only)* | Launch-on-startup entry. |

All hook files can be uninstalled from the Settings panel with one click.

---

## License

ISC

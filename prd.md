# Product Requirements Document (PRD)

**Product Name**
**Agent Pulse**

**Version**
1.1.6 (as-built)

**Overview**
Agent Pulse is a lightweight, beautiful Electron desktop app that provides **ambient, glanceable awareness** of AI coding agents running across multiple tools — and, beyond awareness, a unified control and analytics layer for them.

At its core it displays one or more animated bubbles on the desktop (one per enabled platform/tool). Each bubble shows the platform's icon and clearly indicates whether agents for that platform are actively working, waiting on the user, idle, or in error. Bubbles also surface live usage/quota bars and can be clicked to jump straight to the relevant tool window.

Around that core, the app has grown into a full local observability stack: a normalized status bridge, a SQLite-backed timeline, a rich analytics dashboard (cost, tokens, heatmaps, project/model breakdowns), policy guardrails for risky agent commands, usage/quota tracking with cost estimation, off-machine notifications (Discord/Slack), a quota scheduler, and a self-updater.

A clean Settings screen lets users detect installed tools and configure/install the necessary hooks with a few clicks — no manual JSON editing required — and tune every subsystem above.

The app turns existing hooks systems into a unified, cross-tool status, control, and analytics layer so developers can treat their AI agents like a manageable team instead of constantly checking windows and terminals.

## 1. Problem Statement

Developers using agentic AI coding tools often run multiple agents or long background sessions. They lose context when switching tasks and frequently check chat views, terminals, or logs to see if agents are still working, waiting for input, or have become idle. They also have little visibility into how much these agents cost, how much usage quota remains, when agents run risky commands, or how their own AI usage trends over time.

Existing hooks systems are powerful but under-utilized: there is no delightful, unified, software-only way to consume them across tools for status, cost, and policy purposes.

## 2. Goal / Vision

Deliver a **zero-friction, delightful awareness + control layer** for AI coding agents, powered by a standardized hooks installation and a shared local status bridge. Everything runs locally — no internet or external servers required for core functionality.

The Electron app serves as the single control point to:

- Discover and configure hooks for supported AI coding tools.
- Visualize real-time per-platform agent activity (working / waiting / idle / error).
- Track usage quotas and estimate API-equivalent costs.
- Analyze historical activity (time, tokens, cost, projects, models).
- Enforce safety guardrails on agent commands.
- Notify the user off-machine when an agent needs attention.
- Keep itself up to date.

End state: Developers glance at their desktop bubbles and instantly know the activity status of agents from Claude Code, Cursor, VS Code + GitHub Copilot, OpenAI Codex, Kiro, and Antigravity — then open the dashboard for cost, quota, and historical insight whenever they want to manage agents like a team.

## 3. Target Users

- Heavy users of Claude Code, Cursor, VS Code with GitHub Copilot, OpenAI Codex, Kiro, and Google Antigravity.
- Developers running multiple agents or long-running sessions across different tools.
- Anyone who wants lightweight ambient awareness plus cost/usage insight without complex setup.

## 4. Supported Tools (v1.1)

Six AI coding tools are detected and supported. The architecture uses a normalized event schema so new tools can be added with minimal effort.

| Tool | Type | Hook config location | Token/cost data |
|------|------|----------------------|-----------------|
| **Claude Code** | CLI | `~/.claude/settings.json` (direct HTTP POST, no shell script) | Yes |
| **Cursor** | IDE | `~/.cursor/hooks.json` + shell hook (`.sh`/`.ps1`) | No |
| **VS Code + GitHub Copilot** | Extension/IDE | `.github/hooks/agent-pulse-hooks.json` + shell hook | No |
| **OpenAI Codex** | CLI | `~/.codex/hooks.json` + shell hook (requires `codex_hooks = true` feature flag in `config.toml`) | Yes |
| **Kiro** | IDE | `.kiro/hooks/agent-pulse.kiro.hook` (project) or `~/.kiro/hooks/` (global) + shell hook | No |
| **Antigravity (CLI + IDE)** | CLI/IDE | `~/.gemini/config/hooks.json` + shell hook; single install lights up both CLI (`agy`) and IDE | Yes |

- **Claude Code** is the most fully integrated, leveraging its complete lifecycle event set and transcript files for accurate token counts.
- Tools without token telemetry (Cursor, Copilot, Kiro) report status only; cost UI shows "no data" rather than a misleading "$0".

## 5. Key Features (Functional)

### 5.1 Core UI – Multiple Animated Bubbles

- One floating, always-on-top, draggable bubble per enabled platform/tool.
- Each bubble displays the platform's official icon and follows an **Apple Glass (Glassmorphism)** design language: semi-transparent backgrounds with backdrop blur, thin light-catching borders, and soft shadows.
- **Five clear visual states** (see legend in Settings → States Reference):
  - **Working**: green fill with a fast-dashing orbiting ring (360° in 3s).
  - **Waiting** (agent is blocked on a permission/elicitation prompt): blue fill with a slow-dotted orbiting ring (360° in 4s).
  - **Idle-active** (session alive but momentarily quiet): calm amber fill, no ring.
  - **Idle** (no active session): low-opacity gray, no ring.
  - **Error**: red fill signaling a crash or failed tool call.
- **Usage/quota bars** rendered directly on the bubble: Claude 5h + 7d windows, Codex primary (+ optional secondary) window, Antigravity per-model windows — colored green/amber/red by remaining headroom.
- **Attention pulse**: when an agent has been waiting beyond a threshold, the bubble pulses to draw the eye.
- Three configurable **bubble sizes** (small/medium/large) and four **stack positions** (bottom-right, bottom-left, top-right, top-left); bubbles grow toward screen center from the chosen corner.
- **Hover tooltip** (reusable click-through overlay window) shows active agent count, current task summary, last activity time, and quota detail.
- **Click to focus**: clicking a bubble brings the corresponding tool window to the foreground (Windows uses Z-order/thread-input attach to defeat foreground lock; macOS uses `open -a`; Linux execs the binary), falling back to launching the tool if not running.
- **Per-state sounds**: bundled `pop` chime plus synthesized `chime`/`ding`/`marimba` (Web Audio); default off, configurable.

### 5.2 Settings Screen – Installer, Configuration & Dashboard

Clean, guided, sectioned interface:

- **Hooks installer**: automatic detection of installed tools; per-tool enable/disable, install scope (global vs per-project where applicable), and one-click **Install / Update Hooks** (writes config + bundles shell hook scripts, merging with existing hooks and preserving non-Agent-Pulse entries). Hook-installed status is verified per tool.
- **Bubble settings**: size, stack position, sound, auto-hide delay.
- **States Reference**: visual legend of all five agent states.
- **Usage sections** (Claude, Codex, Antigravity): enable polling, interval, and cap/nudge thresholds; manual refresh.
- **Analytics tab**: timeline/privacy config plus the full analytics card set (below).
- **Guardrails tab**: master switch, toggle individual built-in rules, and full CRUD for custom rules (validated, ReDoS-guarded).
- **Attention section**: escalation threshold, bubble intensify toggle, OS notification toggle, and webhook (Discord/Slack) CRUD + test.
- **Scheduler section**: mode (off/fixed/adaptive), timing, and a test-opener button.
- **Updates tab**: auto-check toggle, last-checked timestamp, check-now, and download progress.

### 5.3 Status Bridge (Shared Backend)

- Lightweight always-running HTTP server bundled with the app, bound to **127.0.0.1:4242** (port overridable via `AGENT_PULSE_PORT`).
- Endpoints: `POST /event` (hook events from all tools) and `GET`/`POST /mcp` (MCP manifest + tool calls for Cursor's `agent_working`/`agent_idle` signals).
- **Normalizes 8+ payload formats** into a unified `NormalizedEvent` and maps each tool's lifecycle events to one of the five states above via a per-tool state machine.
- **State manager** tracks per-tool status (state, last updated, active agent count, current task, agent PID/PID chain) and broadcasts updates to all windows via IPC; an event stream feeds the timeline and transcript readers.
- **Security**: host allowlist (rejects non-local Host headers before parsing), DNS-rebind protection, PID-chain clamping (ReDoS guard), transcript-path redaction in logs, and max body size enforcement.
- Fully local — no internet or external servers required.

### 5.4 Usage & Cost Tracking

Three independent, fail-safe pollers (never crash the app):

- **Claude Code** — polls Anthropic's OAuth usage endpoint; tracks 5-hour and 7-day windows (utilization % + reset time). Handles 401 (token expired → pause until refresh) and 429 (exponential backoff up to 1h).
- **OpenAI Codex** — polls the ChatGPT backend usage endpoint (auth via local cookies); tracks primary + optional secondary weekly windows.
- **Antigravity** — polls the IDE's local gRPC-Web endpoint (self-signed, port re-read from IDE logs each poll); tracks per-model quota windows.

Each window independently evaluates **cap warnings** (remaining ≤ threshold) and **nudges** (plenty remaining but reset imminent — use-it-or-lose-it).

**Cost estimation** (`src/common/pricing.ts`): per-1M-token rates (input / output / cache-write / cache-read) per model, bundled as a baseline and **refreshed daily from LiteLLM's public price table** (cached to disk, falls back to bundled when offline). Multi-model sessions split tokens evenly across models. Costs are **estimated API-equivalent list prices only — never real subscription billing** (see cost-framing decision).

### 5.5 Timeline & Analytics

- **Storage**: local SQLite (`better-sqlite3`) with `events` and derived `sessions` tables, indexed by time/tool/project/session.
- **Sessions deriver** groups events into sessions (by session id or tool + idle-gap), computing peak state, turn count, models used, and per-session token/cost totals.
- **Transcript reader** parses Claude Code transcripts for accurate per-turn token/model data.
- **Quota writer** records 5h/7d window deltas over time.
- **Project resolver** maps working directories to projects for per-project rollups.
- **Prune policy** trims events beyond the retention window on startup and periodically.
- **Analytics cards** (Settings → Analytics): **Digest** (today/yesterday summary), **Heatmap** (calendar grid by tool/project), **Hour Rhythm** (active hours histogram), **Tool Mix** (time/cost share per tool), **Model Usage** (per-model tokens/sessions/cost), **Project Breakdown**, **Tokens Timeline** (daily tokens + cost), **Guardrails Analytics** (rule hit counts), and **Window Value** (quota snapshots).
- **Privacy controls**: `redactTaskText` (drop task summaries for screen-share safety) and `idleGapMinutes` (session-close threshold).

### 5.6 Guardrails

- A pure-function policy **engine** evaluates agent commands extracted from hook payloads against built-in and user-defined rules.
- **Two tiers**: `mustBlock` (blocks execution on tools that support blocking — Claude Code, Antigravity — and downgrades to a warning on tools that don't) and `warn` (always advisory).
- Rules are regex-based, per-OS scoped (`win`/`mac`/`linux`/`all`), and toggleable; users can add custom rules (length-limited, ReDoS-guarded) via the Guardrails tab.
- On a match, the bridge returns the tool's native block response (e.g., Claude's `permissionDecision: "deny"`, Antigravity's `decision: "block"`) and emits a `GuardrailEvent` to the timeline for the analytics card.

### 5.7 Notifications & Attention

- **Attention engine** watches for agents stuck in the `waiting` state beyond a configurable threshold and escalates: pulses the bubble, fires an OS notification, and sends webhooks.
- **Webhooks** to **Discord** and **Slack** (per-target enable, label, URL; test button); also used for usage cap/nudge alerts. Network failures are swallowed with a short timeout — never crashes the app.

### 5.8 Scheduler / Cowork

- Optionally opens fresh Claude 5-hour usage windows on a schedule so headroom is ready when you start work.
- Modes: **off**, **fixed** (wall-clock times), **adaptive** (opens as the live window resets). Uses a `claude -p` ping as the opener and a separate token-refresh nudge; exposes next-fire time, openers-used-today, and last-run result.

### 5.9 App Lifecycle

- **Auto-updater** via GitHub Releases (`electron-updater`): launch check (randomized 30–120s delay), 6-hour background checks, throttled manual check; user-initiated download, no silent install. Windows and Linux supported; macOS currently `unsupported` (signing pending); disabled in dev.
- **Auto-launch** at login (hidden) on Windows/macOS via login items, Linux via XDG autostart entry.
- **Tray** presence keeps the app alive when the Settings window is closed.
- **Feature flags** (`ENABLE_APP_MENU`, `ENABLE_UPDATER`) and log level are env-overridable.

## 6. Non-Goals (current)

- Cloud syncing or multi-machine coordination.
- Replacing the native notifications or security features of the AI tools.
- Real subscription/billing reconciliation (cost figures are estimated API-equivalent list prices only).
- Team configuration sharing (roadmap item).

## 7. Technical Considerations & Risks

- **Permissions**: Electron requests necessary filesystem access (e.g., Full Disk Access on macOS) with clear onboarding explanations.
- **Cross-tool normalization**: the bridge handles differing event names/payloads; some tools (Codex, Antigravity) share event names, so hook scripts tag the originating tool.
- **Performance**: hook scripts are minimal; bubble animations use GPU-accelerated rendering (Framer Motion).
- **Security**: hooks point only to the user-approved local bridge; the bridge enforces a local-host allowlist and DNS-rebind protection; configs are user-owned and reversible.
- **Native module**: `better-sqlite3` must be rebuilt for Electron (`npm run rebuild:native`).
- **Usage endpoints** are undocumented/unofficial and may change; pollers degrade gracefully.
- **Platforms**: Windows (full), macOS (full except auto-update signing), Linux (full).

## 8. Tech Stack

- **Runtime**: Electron 41, Node 20+ (Main process + bridge).
- **Frontend**: React 19, Vite 8, Tailwind CSS 4, Framer Motion, Zustand.
- **Storage**: SQLite via `better-sqlite3`.
- **Updates**: `electron-updater` (GitHub Releases).
- **Build**: TypeScript (strict), electron-builder (Windows/macOS/Linux targets).
- **Testing**: Vitest + Testing Library; bridge smoke test via `npm run test:bridge`.

## 9. Success Metrics

- Average setup time for connecting the first two tools: under 60 seconds.
- Percentage of users who enable bubbles for 2+ platforms.
- Daily usage of the bubbles (time visible and not muted).
- Engagement with the analytics dashboard and guardrails.
- Positive qualitative feedback on reduced context-switching and improved "team management" feeling.

## 10. Roadmap Sketch

- **Delivered (v1.x)**: Multi-bubble UI with five states + usage bars; hooks installer for six tools; status bridge; usage/quota tracking with live pricing and cost estimation; SQLite timeline + analytics dashboard; guardrails; attention + Discord/Slack webhooks; quota scheduler; auto-updater; auto-launch.
- **Next**: Custom animation themes; per-bubble quick actions; broader macOS auto-update support.
- **Future**: Plugin system for additional tools; team configuration sharing; deeper integrations (e.g., Raycast).

## Hooks doc

VS Copilot: https://code.visualstudio.com/docs/copilot/customization/hooks
Codex: https://developers.openai.com/codex/hooks
Cursor: https://cursor.com/docs/hooks
Claude Code: https://code.claude.com/docs/en/hooks
Kiro: https://kiro.dev/docs/hooks/
Antigravity CLI: https://www.antigravity.google/docs/hooks

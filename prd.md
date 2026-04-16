# Product Requirements Document (PRD)

**Product Name**  
**Agent Pulse**

**Version**  
1.0 (MVP)

**Overview**  
Agent Pulse is a lightweight, beautiful Electron desktop app that provides **ambient, glanceable awareness** of AI coding agents running across multiple tools.

It displays one or more animated bubbles on the desktop (one per enabled platform/tool). Each bubble shows the platform’s icon and clearly indicates whether agents for that platform are actively working or idle.

A clean Settings screen allows users to detect installed tools and configure/install the necessary hooks with a few clicks — no manual JSON editing required.

The app turns existing hooks systems into a unified, cross-tool status layer so developers can treat their AI agents like a manageable team instead of constantly checking windows and terminals.

## 1. Problem Statement

Developers using agentic AI coding tools often run multiple agents or long background sessions. They lose context when switching tasks and frequently check chat views, terminals, or logs to see if agents are still working or have become idle.

Existing hooks systems are powerful but under-utilized for simple status observation because there is no delightful, unified, software-only way to consume them across tools.

## 2. Goal / Vision

Deliver a **zero-friction, delightful status indicator** consisting of animated bubbles (one per enabled platform) powered by a standardized hooks installation and a shared local status bridge.

The Electron app serves as the single control point to:

- Discover and configure hooks for supported AI coding tools.
- Visualize real-time per-platform agent activity.
- Provide simple settings and customization.

End state: Developers can glance at their desktop bubbles and instantly know the activity status of agents from Cursor, Claude Code, VS Code + GitHub Copilot, Codex, and others — enabling them to manage agents efficiently.

## 3. Target Users

- Heavy users of Cursor, Claude Code, VS Code with GitHub Copilot, and OpenAI Codex.
- Developers running multiple agents or long-running sessions across different tools.
- Anyone who wants lightweight ambient awareness without complex setup.

## 4. Key Features (Functional)

### 4.1 Core UI – Multiple Animated Bubbles

- One floating, always-on-top bubble per enabled platform/tool.
- Each bubble displays the platform’s official icon (e.g., Cursor logo, Claude icon, VS Code/Copilot icon, Codex icon).
- The UI follows an **Apple Glass (Glassmorphism)** design language: semi-transparent backgrounds with background-blur (frosted glass) effects, thin light-catching borders, and soft shadows.
- Three clear visual states per bubble:
  - **Working**: Gentle, continuous animation (soft pulsing glow, subtle orbiting particles, or calming “thinking” ripple effect).
  - **Idle**: Static, calm appearance with lower opacity and minimal movement (optional subtle “ready” breathing effect).
  - **Dead/Error**: Visual indicator of failure (e.g., subtle red glow, "shake" animation, or distinct static state) to signal the agent has crashed or hit a critical error.
- Bubbles are independently movable and can be arranged by the user (e.g., grouped in a corner or spread out).
- Hover tooltip on each bubble shows brief status: active agent count, last activity time, or current task summary (when available from hook payload).
- Click on a bubble opens a quick panel with more details for that platform (list of active sessions, recent events).
- Global mute/pause option for all bubbles.

### 4.2 Settings Screen – Hooks Installer & Configuration

- Clean, guided interface with tabs or sections per tool.
- Automatic detection of installed tools (Cursor, Claude Code, VS Code + GitHub Copilot, OpenAI Codex).
- For each tool, options to:
  - Enable/disable the platform’s bubble.
  - Choose installation scope: Global (affects all projects) or per-project (select specific folder).
  - One-click **“Install / Update Hooks”** button.
- The app will:
  - Write the required configuration files (`hooks.json`, `settings.json`, etc.).
  - Bundle and place the shared status bridge script.
  - Show a clear preview/diff of changes before applying.
  - Provide an easy “Uninstall Hooks” or revert option.
- Global settings:
  - Animation style and intensity.
  - Bubble position presets or auto-arrangement.
  - Notification preferences (desktop toasts, sounds on state change).
  - Ignore short-lived activities to reduce noise.
  - Debug mode (log raw hook events).

### 4.3 Status Bridge (Shared Backend)

- Lightweight, always-running Node.js process bundled with the Electron app.
- Receives events from all configured hooks across tools (via command execution or local HTTP where supported).
- Aggregates per-platform state:
  - “Working” if any relevant activity event (e.g., PreToolUse, SubagentStart, SessionStart) is active for that platform.
  - “Idle” when all activity has stopped (SessionEnd, Stop, Notification/idle_prompt, etc.).
- Communicates status to the Electron UI via IPC for real-time bubble updates.
- Everything remains fully local — no internet or external servers required.

### 4.4 Supported Tools (v1)

- Claude Code (leverages its full lifecycle events)
- Cursor (`.cursor/hooks.json`)
- VS Code + GitHub Copilot (`.github/hooks/` and compatible formats)
- OpenAI Codex (`hooks.json` with feature flag)

The architecture uses a normalized event schema so new tools can be added with minimal effort.

## 5. Non-Goals (v1)

- Complex dashboards, detailed logging, or analytics.
- Cloud syncing or multi-machine coordination.
- Replacing the native notifications or security features of the AI tools.

## 6. Technical Considerations & Risks

- **Permissions**: Electron will request necessary filesystem access (e.g., Full Disk Access on macOS) with clear onboarding explanations.
- **Cross-tool normalization**: The bridge handles slight differences in event names and payloads across tools.
- **Performance**: Hook scripts remain very lightweight; bubble animations use efficient GPU-accelerated rendering.
- **Security**: All hooks point only to the user-approved local bridge script; configs are fully user-owned and reversible.
- **Platforms**: macOS, Windows, Linux (standard Electron support).
- **Updates**: App supports auto-updates; hook configurations stay under user control.

## 7. Success Metrics

- Average setup time for connecting the first two tools: under 60 seconds.
- Percentage of users who enable bubbles for 2+ platforms.
- Daily usage of the bubbles (time visible and not muted).
- Positive qualitative feedback on reduced context-switching and improved “team management” feeling.

## 8. Roadmap Sketch

- **MVP (v1.0)**: Multi-bubble UI + hooks installer for the four core tools + status bridge.
- **v1.1**: Custom animation themes, sound alerts, per-bubble quick actions.
- **v1.2**: Plugin system and support for additional tools.
- **Future**: Team configuration sharing, deeper integrations (e.g., Raycast).

## Hooks doc

VS Copilot: https://code.visualstudio.com/docs/copilot/customization/hooks
Codex: https://developers.openai.com/codex/hooks
Cursor: https://cursor.com/docs/hooks
Claude Code: https://code.claude.com/docs/en/hooks
Kiro: https://kiro.dev/docs/hooks/
Gemini CLI: https://geminicli.com/docs/hooks/

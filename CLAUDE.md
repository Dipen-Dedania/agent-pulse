# Agent Pulse

Ambient, glanceable awareness of AI coding agents.

## 🛠 Build & Run
- **Dev Mode**: `npm start` (launches Vite renderer and Electron main concurrently)
- **Build Main**: `npm run build:main`
- **Run Main**: `npm run dev:main`
- **Run Renderer**: `npm run dev:renderer`
- **Bridge Smoke Test**: `npm run test:bridge` (verifies HTTP bridge logic without GUI)

## 🎨 Coding Style
- **Language**: TypeScript (strict mode)
- **Frontend**: React 19, Vite, Tailwind CSS 4, Framer Motion (for animations), Zustand (state management)
- **Backend**: Electron (Main process), Node.js
- **UI Design**: "Apple Glass" (Glassmorphism)
    - Use `backdrop-filter: blur()` and semi-transparent layers.
    - High-end, frosted-glass aesthetic.
- **Naming**:
    - Components: `PascalCase`
    - Variables/Functions: `camelCase`
    - Types/Interfaces: `PascalCase`
- **Patterns**:
    - Use Functional Components and Hooks in React.
    - Prefer composition over deep prop drilling.
    - Use the normalized event schema in `src/common/` for all tool communication.
    - Main $\leftrightarrow$ Renderer communication via Electron IPC.

### 🧩 Component Library (reuse, don't hand-roll)
Reusable renderer UI primitives live in **`src/renderer/components/Shared/`** and are
exported from its barrel — import them as `from '../Shared'` (see `Shared/README.md`).
**Always use these instead of hand-rolling an equivalent:**
- `GlassToggle` — switches/toggles (never a hand-rolled `role="switch"` + knob).
- `Select` — dropdowns (never a native `<select>`).
- `appAlert` / `appConfirm` (+ `AppDialogHost`) — dialogs (never `window.alert`/`window.confirm`).
- `TooltipOverlay` — the bubble tooltip overlay.
- `Card` — titled glass section panels.
- `Segmented` — compact mode switches.

Glass surfaces use the `.glass-control` (small controls) / `.glass-primary` /
`.glass-secondary` / `.glass-modal` utility
classes (in `index.css`) — do **not** copy-paste `bg-glass/… backdrop-blur-md …
rounded-2xl` shells. `npm run lint:ui` enforces these rules and runs as part of `npm test`.

### 🎞 Motion (one vocabulary, `src/renderer/motion.ts`)
- Never hand-write `transition={{ duration: … }}`; import `snappy` / `smooth` / `gentle`.
- **Switching the body under a `Tabs` / `Segmented` row** always uses the standard
  cross-fade: wrap it in `<AnimatePresence mode="wait">` + `<motion.div key={tab}
  variants={tabContent} initial="initial" animate="animate" exit="exit"
  transition={tabContentTransition}>` — never an instant swap, never a bespoke fade.
  `SettingsPanel`'s tab body and `BacklogSettingsModal` are the reference.
- Inside a `Modal`, give any `overflow-hidden` child (a `Tabs` track on
  `.glass-secondary`, a `Card`) `shrink-0`: the panel is a max-height flex column
  that scrolls, and such children are the only ones allowed to shrink, so they
  collapse to a sliver once the body outgrows the panel.

## 📂 Project Structure
- `src/main/bridge/`: HTTP server (port 4242) and status state management.
- `src/main/installer/`: Tool detection and hook configuration writing logic.
- `src/main/backlog/`: Backlog board + scheduler engine. Cards run headlessly on a per-card
  agent (`claude -p` or `codex exec`) behind the `AgentAdapter` seam in `backlog/agents/` —
  the engine and `runner.ts` never branch on the CLI; add agent-specific argv, parsing, or
  usage-limit wording in the adapter, not the engine. See `codex-backlog-plan.md`.
- `src/main/mcp/`: The Agent Pulse MCP server for Claude Code (backlog capture from a
  terminal chat) plus its `~/.claude.json` registration. `server.ts` runs as its own
  process — it must never import Electron or add npm dependencies.
- `src/main/windows/`: Electron window configurations (Bubbles, Settings).
- `src/main/boot-sequence.ts`: staged launch. `app.on('ready')` runs only Stage 0 (IPC
  registration, theme, tray, then `settingsWindow.show()`); pollers, schedulers and the two
  SQLite databases boot in Stage 1 after the page loads (`app:wait-boot` gates the Settings
  panel on it); fs maintenance runs in Stage 2. New IPC handlers the Settings UI calls at
  mount belong in Stage 0 or 1, never Stage 2. `[Boot]` log lines carry per-step timings.
- `src/renderer/components/Shared/`: Reusable UI primitives (barrel-exported). Import from here; don't hand-roll.
- `src/renderer/components/Bubble/`: Visual status indicators and animations.
- `src/renderer/components/Settings/`: Configuration interface and hook management.
- `src/common/`: Shared TypeScript types and event schemas.

## ⚙️ Technical Notes
- **Status Bridge**: Listens for POST requests from tool hooks. Normalizes events into `Working`, `Idle`, or `Dead/Error` states.
- **Hooks**: Injected into target tools (Claude Code, Cursor, etc.) to send lifecycle events to the bridge.
- **Bubbles**: Always-on-top, draggable windows.

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

Glass surfaces use the `.glass-primary` / `.glass-secondary` / `.glass-modal` utility
classes (in `index.css`) — do **not** copy-paste `bg-glass/… backdrop-blur-md …
rounded-2xl` shells. `npm run lint:ui` enforces these rules and runs as part of `npm test`.

## 📂 Project Structure
- `src/main/bridge/`: HTTP server (port 4242) and status state management.
- `src/main/installer/`: Tool detection and hook configuration writing logic.
- `src/main/windows/`: Electron window configurations (Bubbles, Settings).
- `src/renderer/components/Shared/`: Reusable UI primitives (barrel-exported). Import from here; don't hand-roll.
- `src/renderer/components/Bubble/`: Visual status indicators and animations.
- `src/renderer/components/Settings/`: Configuration interface and hook management.
- `src/common/`: Shared TypeScript types and event schemas.

## ⚙️ Technical Notes
- **Status Bridge**: Listens for POST requests from tool hooks. Normalizes events into `Working`, `Idle`, or `Dead/Error` states.
- **Hooks**: Injected into target tools (Claude Code, Cursor, etc.) to send lifecycle events to the bridge.
- **Bubbles**: Always-on-top, draggable windows.

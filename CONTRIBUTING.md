# Contributing to Agent Pulse

Thanks for your interest in improving Agent Pulse! This guide covers everything you need to get a development environment running and land your first PR.

## Quick links

- [Development setup](#development-setup)
- [Running tests](#running-tests)
- [Architecture orientation](#architecture-orientation)
- [Adding support for a new tool](#adding-support-for-a-new-tool)
- [Pull request guidelines](#pull-request-guidelines)
- [Contributor License Agreement](#contributor-license-agreement-cla)

## Development setup

### Prerequisites

- **Node.js 22+** — required. `@electron/rebuild` needs ≥22.12.0, and `better-sqlite3` only ships prebuilt Windows binaries from Node 22 onward (older Nodes fall back to a node-gyp build that needs a local C++ toolchain).
- npm (ships with Node.js)

### Install & run

```bash
git clone https://github.com/Dipen-Dedania/agent-pulse.git
cd agent-pulse
npm install
npm run rebuild:native   # rebuilds better-sqlite3 against Electron's ABI
npm start
```

`npm start` launches the Vite renderer (port 5173) and the Electron main process together.

> **Gotcha:** if you skip `npm run rebuild:native`, the app still runs but the Pulse Timeline (analytics) silently records nothing and logs `better-sqlite3 not loadable`. Re-run it after every `npm install`.

Useful variants:

| Command | Purpose |
| --- | --- |
| `npm run start:info` / `start:warn` / `start:error` / `start:debug` | Same as `npm start` with a different main-process log level |
| `npm run dev:renderer` | Vite dev server only — pure UI iteration |
| `npm run dev:main` | Build + launch only the Electron main process (renderer must already be running) |
| `npm run build:main` | Type-check / compile the main process (`tsc -p tsconfig.main.json`) |

## Running tests

```bash
npm test              # full Vitest suite (must pass before every PR)
npm run test:watch    # TDD loop
npm run test:coverage # V8 coverage report under coverage/
npm run test:bridge   # end-to-end bridge smoke test, no GUI needed
```

CI runs `npm ci`, `npm run build:main`, and `npm test` on Windows, macOS, and Linux for every pull request. All three must be green.

## Architecture orientation

See the [Architecture section of the README](README.md#architecture) for the full picture. The 60-second version:

- **Main process** (`src/main/`) owns an HTTP bridge on `localhost:4242` that receives lifecycle events from hooks installed into each AI tool. It normalizes them into a shared `AgentState` schema and pushes state to renderer windows over Electron IPC.
- **Renderer** (`src/renderer/`) is a React 19 + Tailwind CSS 4 + Framer Motion SPA rendering both the floating status bubbles and the Settings window.
- **Common** (`src/common/`) holds the shared event schema, tool metadata, logger, and guardrail types used by both processes. **All tool communication must go through the normalized event schema here** — never invent per-tool side channels.

Key directories when navigating:

| Path | What lives there |
| --- | --- |
| `src/main/bridge/` | HTTP server + status state management |
| `src/main/installer/` | Tool detection and hook config writers |
| `src/common/toolMeta.ts` | Per-tool metadata (ids, names, surfaces) |
| `src/main/usage/`, `codex-usage/`, `cursor-usage/`, `antigravity-usage/` | Subscription usage pollers |
| `src/main/timeline/` | SQLite Pulse Timeline store |
| `src/main/guardrails/` | Shell-command guardrail engine |
| `src/renderer/components/Bubble/` | Animated status bubbles |
| `src/renderer/components/Settings/` | Settings tabs |

## Adding support for a new tool

The most common contribution! The rough shape:

1. **Metadata** — register the tool in `src/common/toolMeta.ts` (id, display name, surface) and add a logo to `public/assets/`.
2. **Hook installer** — add detection + hook-config writing in `src/main/installer/`. Look at an existing tool with a similar hook mechanism (JSON hooks file vs. shell script) as a template.
3. **Event normalization** — map the tool's lifecycle event names to `AgentState` in `src/main/bridge/`.
4. **Tests** — add normalization cases (every event → expected state) and an `installHook`/`uninstallHook` round-trip test, mirroring the existing per-tool suites.
5. **Docs** — add the tool to the README's supported-tools table and the "Config files Agent Pulse touches" table.

If you're unsure whether a tool is feasible (e.g. it has no hook mechanism), open a [tool support request](https://github.com/Dipen-Dedania/agent-pulse/issues/new?template=tool_support_request.yml) first and we'll figure it out together.

## Pull request guidelines

- **Branch from `main`**, one logical change per PR.
- **Title style**: conventional-commit prefixes matching the existing history — `fix:`, `feat:`, `docs:`, `chore:`, `refactor:`, `test:`.
- **Link the issue** you're addressing (`Fixes #123`). For non-trivial features, open an issue first so we can agree on the approach before you invest time.
- **Tests**: `npm test` must pass; new behavior needs new tests.
- **No secrets or personal paths** in code, fixtures, or logs — this codebase handles session tokens, so be extra careful with test fixtures.
- **Coding style**: TypeScript strict mode, functional React components + hooks, `PascalCase` components/types, `camelCase` functions/variables. Match the style of surrounding code.

### Platform coverage

The maintainer develops primarily on **Windows**. Testing and fixes on **macOS and Linux are especially valuable** — if you're on one of those platforms, calling out what you manually verified in your PR description helps a lot.

## Contributor License Agreement (CLA)

Agent Pulse is dual-licensed (AGPLv3 + commercial). To keep that model possible, we ask every contributor to sign our [Contributor License Agreement](CLA.md) — you keep ownership of your contribution and license it to the project, including the right to distribute it under the commercial license.

Signing is automated: the CLA bot will comment on your first PR with instructions. You sign once by replying with a comment; it covers all your future contributions.

## Reporting bugs & security issues

- Bugs and feature requests → [GitHub Issues](https://github.com/Dipen-Dedania/agent-pulse/issues) (please use the templates).
- Security vulnerabilities → **do not open a public issue**; see [SECURITY.md](SECURITY.md).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

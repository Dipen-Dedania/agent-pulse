# Pulse Timeline — Implementation Plan

Combined Session Timeline + Cross-Agent Activity Heatmap feature. Persists normalized events, derives sessions, samples quota, and exposes an Analytics tab in Settings with heatmap, digest card, hour-of-day rhythm, tool-mix, and per-project breakdown.

---

## 1. Goals

- Persist agent activity locally and visualize it across tools and projects.
- Answer: *"What did my agents do today?"*, *"How much time did I spend on project X this week?"*, *"Which tool am I actually using most?"*, *"How much quota did this session burn?"*
- Stay fully local — no telemetry, no cloud.

## 2. Non-goals (for v1)

- No push notifications / scheduled digest delivery.
- No cost-in-dollars projection (lands later as feature #5, uses the same `quota_samples` table).
- No multi-machine sync.
- No cross-device session linking.
- No export to CSV/JSON (can add later if asked).

## 3. Data model

New SQLite database at `<userData>/pulse-timeline.db` (alongside existing config). Uses `better-sqlite3` — synchronous, fast, ~250KB native binary, well-supported on the three targets in `electron-builder` config (win/mac/linux).

### `events`
Raw lifecycle stream — write-through from the bridge.

| column         | type     | notes                                                  |
|----------------|----------|--------------------------------------------------------|
| `id`           | INTEGER  | PK autoincrement                                       |
| `tool_id`      | TEXT     | matches `ToolId` in `src/common/types.ts`              |
| `state`        | TEXT     | matches `AgentState`                                   |
| `timestamp`    | INTEGER  | ms epoch                                               |
| `session_id`   | TEXT     | from hook payload when available                       |
| `task_summary` | TEXT     | nullable; redacted when "screenshare safe" mode is on  |
| `active_agents`| INTEGER  | nullable                                               |
| `project_id`   | TEXT     | nullable; SHA-1(8) of normalized project path          |
| `project_path` | TEXT     | nullable; absolute path of the git root or cwd         |
| `error_message`| TEXT     | nullable                                               |

Indexes: `(timestamp)`, `(tool_id, timestamp)`, `(project_id, timestamp)`.

### `sessions`
Derived rollup — written when a session closes (or on app shutdown for the still-open one).

| column            | type     | notes                                              |
|-------------------|----------|----------------------------------------------------|
| `id`              | INTEGER  | PK autoincrement                                   |
| `tool_id`         | TEXT     |                                                    |
| `project_id`      | TEXT     | nullable                                           |
| `project_path`    | TEXT     | nullable                                           |
| `started_at`      | INTEGER  | ms epoch — first non-idle event                    |
| `ended_at`        | INTEGER  | ms epoch — last non-idle event + idle-gap timeout  |
| `turns`           | INTEGER  | count of `working` transitions                     |
| `peak_state`      | TEXT     | worst severity reached (error > waiting > working) |
| `task_summary`    | TEXT     | nullable; first non-empty summary in window        |
| `had_error`       | INTEGER  | 0/1                                                |

Indexes: `(started_at)`, `(tool_id, started_at)`, `(project_id, started_at)`.

### `quota_samples`
Written by each usage poller on every successful poll (no extra API calls — just persists what's already in memory).

| column          | type     | notes                                                  |
|-----------------|----------|--------------------------------------------------------|
| `id`            | INTEGER  | PK autoincrement                                       |
| `tool_id`       | TEXT     | `claude-code`, `openai-codex`, `antigravity-cli`       |
| `window_key`    | TEXT     | `5h`, `7d`, `primary`, `secondary`, or model key       |
| `pct_remaining` | REAL     | 0–100                                                  |
| `resets_at`     | INTEGER  | ms epoch                                               |
| `sampled_at`    | INTEGER  | ms epoch                                               |

Indexes: `(tool_id, window_key, sampled_at)`.

### Retention

- `events` — 60 days, pruned daily at app start.
- `quota_samples` — 60 days, pruned daily.
- `sessions` — kept forever (tiny; ~300KB / 30 days).

Estimated 30-day footprint: ~20–25 MB.

## 4. Architecture

```
src/main/
  timeline/
    db.ts              # better-sqlite3 init, migrations, prepared statements
    schema.sql         # CREATE TABLE statements (versioned)
    events-writer.ts   # subscribes to bridge state-manager → insert event row
    sessions-deriver.ts# tracks open sessions in memory, closes on idle-gap
    quota-writer.ts    # subscribes to the 3 usage pollers → insert sample row
    queries.ts         # heatmap, digest, hour-rhythm, tool-mix, project breakdown
    ipc.ts             # exposes typed queries to renderer over Electron IPC
    project-resolver.ts# walk-up-to-.git, hashing, caching
    prune.ts           # daily retention sweep
    index.ts           # wires everything; called from src/main/index.ts
```

Renderer additions:

```
src/renderer/components/Settings/
  AnalyticsTab.tsx           # new tab in SettingsPanel
  analytics/
    HeatmapCard.tsx          # GitHub-contrib grid
    DigestCard.tsx           # today/yesterday summary
    HourRhythmCard.tsx       # 24-bucket histogram
    ToolMixCard.tsx          # last 7d / 30d split
    ProjectBreakdownCard.tsx # ranked list per project
    useAnalytics.ts          # hook → IPC queries with caching
```

### Event flow

1. Bridge receives hook POST → normalizes into `NormalizedEvent`.
2. `state-manager` emits to its existing subscribers AND to `events-writer` (new subscriber).
3. `events-writer` resolves `project_id`/`project_path` from the payload's `cwd`, then inserts the row.
4. `sessions-deriver` listens to the same stream, maintains an in-memory map of open sessions keyed by `(tool_id, project_id)`, closes them when an idle-gap timer fires.
5. Usage pollers (`src/main/usage/`, `src/main/codex-usage/`, `src/main/antigravity-usage/`) each get one extra subscriber that writes to `quota_samples`.

All writes are synchronous (better-sqlite3 is sync) and wrapped in `setImmediate` so they never block the bridge response.

## 5. Hook payload extension — `cwd` capture

For project tracking to work, each tool's installed hook must forward the working directory. Updates in `src/main/installer/`:

- **claude-code** (HTTP hook) — already has access to `$CLAUDE_PROJECT_DIR`. Add it to the POST body as `cwd`.
- **cursor / openai-codex / antigravity-cli / kiro** (shell hooks) — wrap the bridge POST so it includes `"cwd": "$PWD"`.
- **vscode-copilot** (PowerShell hooks on Windows) — include `$PWD.Path` in JSON body.

Bridge change in `src/main/bridge/server.ts`:

- Accept optional `cwd` field on incoming POST.
- Forward into `NormalizedEvent.payload.cwd` (extend the type in `src/common/types.ts`).

Project resolution in `project-resolver.ts`:

1. Normalize `cwd` (resolve symlinks, lowercase drive letter on Windows).
2. Walk up directories looking for `.git`. First hit wins. Fallback: original `cwd`.
3. `project_id = sha1(normalized_path).slice(0, 8)`.
4. `project_path = basename` for display, full path stored for tooltips.
5. LRU cache (size 256) to avoid filesystem hits on every event.

## 6. Session derivation rules

A session is keyed by `(tool_id, project_id)`. Maintained in memory by `sessions-deriver`:

- **Open**: first non-idle event for that key starts a session — record `started_at`, capture `task_summary` on first event that has one.
- **Extend**: every subsequent non-idle event for that key updates `last_active_at` and resets the idle-gap timer.
- **Close**: timer fires `IDLE_GAP_MS` (default 5 min, configurable) after the last non-idle event → write row, drop from map.
- **Force-close on shutdown**: app `before-quit` flushes all open sessions with `ended_at = last_active_at`.
- **peak_state** is computed during the open window (`error` > `waiting` > `idle-active` > `working`).
- **turns** = count of `idle-active → working` transitions within the window.

## 7. UI — Analytics tab

Added as a 4th tab in `SettingsPanel.tsx` (alongside Hooks / Usage / Guardrails).

### Cards (top-to-bottom in the tab)

1. **DigestCard** — today + yesterday side-by-side. Per tool: active time, sessions, longest session, top task summary, quota burned (delta of `pct_remaining` over the day). Includes total cross-tool active time.

2. **HeatmapCard** — GitHub-contrib grid, last 90 days. Toggle:
   - rows: all-tools-combined / per-tool / per-project (top 6 + "other")
   - cell intensity: total active minutes that day
   - hover tooltip: session count, top task, total minutes

3. **HourRhythmCard** — 24-bucket histogram. Last 30 days. Shows when you actually pair with agents during the day.

4. **ToolMixCard** — last 7d / 30d toggle. Horizontal stacked bar: % active time per tool.

5. **ProjectBreakdownCard** — ranked list of projects by total active time in the selected window. Per row: project name (with full path on hover), tools used (icons), total time, sessions.

### Privacy toggle (Settings → Analytics)

- **"Redact task text in stored events"** — when on, `task_summary` is written as `null`. Existing rows stay as-is (or offer a one-shot "scrub" button).

### IPC contract

Typed methods on `window.api.analytics`:
- `getDigest(date: string) → DigestPayload`
- `getHeatmap(range: '30d' | '90d', groupBy: 'tool' | 'project' | 'all') → HeatmapPayload`
- `getHourRhythm(range: '7d' | '30d') → HourRhythmPayload`
- `getToolMix(range: '7d' | '30d') → ToolMixPayload`
- `getProjectBreakdown(range: '7d' | '30d' | '90d') → ProjectBreakdownPayload`

All payloads include their query timestamp; renderer caches via a `useAnalytics` hook with 30s TTL.

## 8. Implementation phases

### Phase 1 — Persistence backbone (~1 day)
- Add `better-sqlite3` dep + `electron-rebuild` step in build scripts.
- Create `src/main/timeline/db.ts` + `schema.sql` with the three tables and indexes.
- Migration runner (single `schema_version` row in a meta table).
- `prune.ts` with daily sweep.
- Unit test: open DB, write rows, prune, close.

### Phase 2 — Event + project capture (~1 day)
- Extend `NormalizedEvent.payload` with `cwd`.
- Update bridge server to read incoming `cwd` field.
- Update each hook installer in `src/main/installer/` to forward `cwd`/`$PWD`/`$CLAUDE_PROJECT_DIR`.
- Implement `project-resolver.ts` with LRU + git-root walk.
- Wire `events-writer.ts` as a subscriber on `state-manager`.
- Integration test via `npm run test:bridge`: POST events with cwd, verify rows + project_id stable across calls.

### Phase 3 — Sessions deriver (~0.5 day)
- Implement `sessions-deriver.ts` with in-memory open-sessions map + idle-gap timer.
- Wire to `state-manager` event stream.
- `before-quit` flush.
- Unit test: feed synthetic event sequences, assert session boundaries match spec.

### Phase 4 — Quota sampling (~0.5 day)
- Add `quota-writer.ts` subscribing to the three usage pollers' `*:updated` IPC events on the main side.
- Write one row per window per poll (`5h`, `7d`, `primary`, `secondary`, and one per Antigravity model).
- Skip writes when state is `unauthenticated` / `unavailable`.

### Phase 5 — Query layer + IPC (~0.5 day)
- Implement `queries.ts` — five queries listed above, returning typed payloads.
- Wire IPC handlers in `timeline/ipc.ts`, expose via `preload`.
- Add `src/common/timeline-types.ts` for shared payload types.

### Phase 6 — Analytics UI (~1.5 days)
- New `AnalyticsTab.tsx` registered in `SettingsPanel.tsx`.
- Five cards listed in §7. Heatmap is the most involved; rest are simple charts (no extra library — Tailwind + raw SVG matches existing aesthetic).
- `useAnalytics.ts` hook with 30s TTL cache.
- Privacy toggle wired to `user-config.ts`.

### Phase 7 — Polish (~0.5 day)
- Empty states for new users (no data yet).
- Loading skeletons.
- Glass-style consistent with existing Settings cards.
- README section + improvement.md cleanup.

**Total: ~5.5 dev days.**

## 9. Open questions / decisions to revisit later

- **Idle-gap default**: 5 min is a guess. May want per-tool defaults (Codex CLI sessions are bursty; Claude Code sessions are long).
- **Heatmap intensity scale**: linear vs logarithmic? Linear hides light days when one day is a 6h outlier. Lean log + tooltip showing absolute minutes.
- **Project-id for non-git directories**: currently falls back to cwd. May produce noise (e.g. `~/`, `/tmp`). Consider an ignore-list or grouping under "Untracked".
- **Re-deriving sessions on schema change**: keep an idempotent re-derive routine that rebuilds `sessions` from `events` so we can iterate on the rules without losing history.

## 10. Touch list (files modified or created)

**New:**
- `src/main/timeline/*` (8 files)
- `src/renderer/components/Settings/AnalyticsTab.tsx`
- `src/renderer/components/Settings/analytics/*` (6 files)
- `src/common/timeline-types.ts`

**Modified:**
- `src/common/types.ts` — add `cwd?: string` to `NormalizedEvent.payload`
- `src/main/bridge/server.ts` — accept + forward `cwd`
- `src/main/bridge/state-manager.ts` — expose subscribe-to-event-stream API if not already public
- `src/main/index.ts` — boot timeline module
- `src/main/installer/*` — each hook script template gets `cwd` forwarding
- `src/main/usage/*` + `src/main/codex-usage/*` + `src/main/antigravity-usage/*` — emit per-poll snapshot to `quota-writer`
- `src/main/user-config.ts` — add `analytics.redactTaskText`, `analytics.idleGapMinutes`
- `src/renderer/components/Settings/SettingsPanel.tsx` — register Analytics tab
- `package.json` — add `better-sqlite3`, electron-rebuild hook

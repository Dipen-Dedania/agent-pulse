# Improvement list

# Claude Code subscription-usage polling

Background poller that tracks **subscription quota usage** (5-hour and 7-day windows) by calling Anthropic's undocumented OAuth usage endpoint — the same one Claude Code itself uses for its statusline.

**Independent of hooks.** Hooks fire only during active sessions; this poller runs in the Electron main process and surfaces remaining quota even when Claude Code isn't actively in use.

Scope is **Claude Code only**. Other tools' bubbles are unaffected.

## The endpoint

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <accessToken from ~/.claude/.credentials.json>
anthropic-beta: oauth-2025-04-20
Accept: application/json
```

Response shape (best-effort — handle variants):

```json
{
  "five_hour":  { "utilization": 42, "resets_at": 1742651200 },
  "seven_day":  { "utilization": 18, "resets_at": 1743120000 }
}
```

- Field names vary: `utilization` or `used_percentage`. Handle both.
- `resets_at` may be Unix seconds (number) or an ISO 8601 string. Handle both.
- **Undocumented.** Wrap every call defensively; never crash on shape changes or 4xx/5xx.

## Credentials

OAuth access token lives in Claude Code's credentials file:

- **macOS:** Keychain entry `Claude Code-credentials`, accessed via `security find-generic-password -s "Claude Code-credentials" -w`. Fallback to file if Keychain entry is missing.
- **Linux / Windows:** `<homedir>/.claude/.credentials.json` — read `.claudeAiOauth.accessToken`.

**Re-read on every poll.** Claude Code rewrites the file when the token auto-refreshes; never cache in memory.

## Architecture

Project is **TypeScript + ESM**. Match existing patterns from `bridge/`, `installer/`, and `windows/`.

### New files

```
src/main/usage/
  poller.ts        UsagePoller class — polling loop, backoff, IPC, notifications
  credentials.ts   readAccessToken() — cross-platform, no caching
  parse.ts         parseUsageResponse() — field/timestamp variant handling

src/main/usage/__tests__/
  parse.test.ts    Field-name and timestamp variant coverage
```

### Files to modify

```
src/common/types.ts                          + UsageSnapshot, UsageStatus
src/main/user-config.ts                       + usage: { enabled, intervalMs, warnThreshold }
src/main/index.ts                             instantiate poller, wire IPC, before-quit cleanup
src/main/windows/bubble-manager.ts            split BUBBLE_SIZE → WIDTH/HEIGHT (taller window)
src/renderer/components/Bubble/Bubble.tsx     listen for usage:updated, render bars (claude-code only)
src/renderer/components/Settings/SettingsPanel.tsx  + usage section
```

## Polling loop

- Default interval: **10 minutes**, user-configurable.
- Hard floor: **60 seconds** (the endpoint rate-limits aggressively).
- Run one poll immediately on app `ready`; then interval-driven.
- Stop cleanly on `before-quit`.
- Use recursive `setTimeout` (not `setInterval`) so backoff can adjust the next delay without races.

## Error handling

| Condition | Behavior |
|---|---|
| **200 OK, shape valid** | Update snapshot, broadcast `usage:updated`, check threshold for notification. |
| **200 OK, shape unrecognised** | Log warn, expose `status: 'unavailable'`. Keep normal interval. |
| **401** | Set `status: 'unauthenticated'`. **Pause polling.** Resume on manual refresh, app restart, or `usage:refresh-now`. Surface message: *"Run any Claude Code command to refresh the token, then click Refresh."* |
| **429** | Double next-poll delay (capped at 60 min). Reset to normal on next success. |
| **5xx / network error** | Log warn, skip. Keep normal interval. |
| **404 / 400 endpoint-moved** | Set `status: 'unavailable'`. Back off to 60 min — endpoint changed, not transient. |
| **Missing credentials file** | Set `status: 'unauthenticated'`. Pause polling. |

## IPC contract

Match existing channel patterns (`ipcMain.on` for fire-and-forget, `ipcMain.handle` for invoke).

| Channel | Direction | Purpose |
|---|---|---|
| `usage:get-current` | `handle` (renderer → main) | Returns latest `UsageStatus` snapshot. |
| `usage:refresh-now` | `on` (renderer → main) | Trigger an immediate poll, bypassing backoff. |
| `usage:updated` | `webContents.send` (main → renderer) | Broadcast on each successful poll **or** status change. |

The renderer's Zustand store (or a new small store) holds the latest snapshot. The Claude bubble subscribes to it.

## Settings UI (in `SettingsPanel.tsx`)

A dedicated section, visually distinct from the per-tool grid since this is Claude-specific:

- Master toggle: **"Track Claude usage"**
- Interval input (seconds, min 60, default 600)
- Warning threshold slider (1–99%, default 80)
- Current snapshot display: "5h: 42% · resets in 2h 14m / 7d: 18% · resets in 4d"
- Status pill: `OK` / `Unauthenticated` / `Unavailable` / `Rate-limited`
- **Refresh now** button (calls `usage:refresh-now`)

## Bubble UI — two progress bars below the Claude bubble

The bubble's existing waiting/working rings stay untouched. Usage rides on a new surface below the orb.

- Window height grows to fit (e.g. 70 × 86); width stays 70.
- All bubble windows share the new height — non-Claude bubbles just leave the bottom transparent. Simpler than per-tool sizing; no visual cost (windows are transparent + click-through).
- Two bars, ~50px × 3px, stacked with a 2px gap. **Top = 5h** (more urgent), **bottom = 7d**.
- Fill color thresholds: `<50%` green · `<80%` amber · `≥80%` red. Reuse `stateColors.ts` palette where possible.
- Track color: subtle (track @ ~10% opacity of fill).
- Bars only render for `toolId === 'claude-code'` AND when `userConfig.usage.enabled` AND status is `ok`. For `unauthenticated` / `unavailable` show grayed-out empty tracks (keeps layout stable).
- Hover the bar area → native `title` attribute with `5h: 42% · resets in 2h 14m / 7d: 18% · resets in 4d`. (Cheap stopgap; the proper bubble tooltip is disabled — `TOOLTIP_ENABLED = false` at `Bubble.tsx:10`.)
- Bars are inert (no click handler); drag is only initiated from the orb itself.

## Notifications

Native `new Notification(...)` from the renderer (or `electron.Notification` from main — match what the codebase already uses if anything).

- Fire when 5h or 7d crosses the configured threshold (default 80%).
- Debounce: at most one notification per window per reset cycle. Store `lastNotifiedResetAt` per window in memory (not persisted — restarting the app is rare enough that re-notifying is acceptable).

## Out of scope for MVP

- **Rolling JSONL history log.** Mentioned in earlier spec but skipped here — no UI consumer yet. Add when there's a "trend sparkline" or similar.
- **Per-tool window sizing.** All bubbles share the same height. Revisit if other tools grow surfaces of their own.
- **Token refresh.** We can't refresh the OAuth token ourselves; users must run a Claude Code command.

## What NOT to do

- Don't put network calls in the renderer — CORS blocks it and credentials don't belong there.
- Don't bundle or store the token anywhere outside Claude Code's own credential location.
- Don't assume the endpoint will always exist — treat it as best-effort enrichment.
- Don't `setInterval` from the renderer — pauses when windows are hidden.
- Don't introduce new dependencies. Node `fetch`, `fs`, `child_process` are sufficient.

## Style

- Match the existing class-with-`init()` pattern (`StatusBridgeServer`, `BubbleManager`).
- Use the shared `logger` from `src/common/logger.ts`. Log levels: `debug` for poll cycle, `info` for status changes, `warn` for transient errors, `error` for unexpected.
- Component naming: PascalCase. Variables: camelCase. TS strict mode.

## Deliverables

1. `src/main/usage/poller.ts`, `credentials.ts`, `parse.ts` + parser unit tests.
2. Type additions in `src/common/types.ts` and config extension in `src/main/user-config.ts`.
3. Main-process wiring (`src/main/index.ts`).
4. Bubble window size split (`bubble-manager.ts`) + bar rendering in `Bubble.tsx`.
5. Settings panel section.
6. Inline comments where the "undocumented endpoint" caveat or "open Claude Code to refresh" recovery path matters.

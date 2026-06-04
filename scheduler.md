# Cowork Scheduler — Window-Aware Session Scheduling

Turn Claude's rolling 5-hour usage window from a constraint into a daily cadence.
Agent Pulse already *measures* the window (`src/main/usage/poller.ts`); this feature
*acts* on it — opening a fresh window at the times the user chooses, by firing one
minimal `claude -p` ping. That ping is the whole feature: it anchors a new 5-hour block
and refreshes the token in the same act. No prep/briefing work — just the reset.

This is the **active** sibling of the "use-it-or-lose-it" nudge that already ships:
the nudge tells you a window is going to waste; the scheduler does something about it.

> Scope: this doc covers the scheduler only. The credit-expiry *autorun* of queued
> tasks lives in [`backlog.md`](./backlog.md) (the Auto-Executing Kanban). The
> scheduler is the upstream signal that feature consumes — "a fresh window just
> opened, here's how long it lasts."

## Concept

A 5-hour window is a renewable resource: you get a fresh allowance 5 hours after the
window's *first message*. You cannot send a message without spending a window — every
message either rides the current window or opens a new one. So the only real control
variable is **when you spend your first message**, because that timestamp defines the
whole 5-hour block.

The scheduler makes that decision deliberate instead of accidental: open a fresh window
at the moments that fit the user's day, and surface window state ambiently so a window is
always live and freshly-reset when the user sits down.

**Opener semantics (important):** a ping can only *start the next* window — it cannot cut
a live one short. If it fires while a window is still active, it just rides that window
(no reset). It opens a genuinely new block only when the previous one has already expired.
So slots must be spaced ≥5h apart to each land a fresh window (6/11/4 works); in
`adaptive` mode we simply fire the opener at `resetsAt`.

## What's already built (and reused as-is)

- **`usage/poller.ts`** — polls the undocumented `GET /api/oauth/usage` endpoint with the
  OAuth bearer token and `anthropic-beta: oauth-2025-04-20`, normalizing
  `five_hour` / `seven_day` into `{ utilization, resetsAt }`. This is our authoritative,
  **account-wide** window state (it sees web + every machine, not just local transcripts).
- **`usage/credentials.ts`** — reads the access token from Keychain (mac) /
  `~/.claude/.credentials.json` (Win/Linux). Re-read every poll; never cached.
- **Passive notifications** — `capWarning` (remaining ≤ threshold) and the
  `nudge` "use it or lose it" (remaining ≥ threshold AND reset within `NUDGE_LEAD_MS`).
- **`WindowValueCard`** (transcripts) — the dollar *value* extracted from a window.

The scheduler adds a new main-process module and a new config block; it does **not**
re-implement window detection.

## Window state: source of truth

Drive everything off the live OAuth endpoint's `resetsAt`, **not** transcript
reconstruction. The server hands us the exact reset instant, so there's no anchored-block
math to maintain. Transcripts stay responsible only for the *value* view.

| Concern | Source |
|---|---|
| Is a window live, %, exact reset time | **Live OAuth endpoint** (`usage/poller.ts`) |
| $ extracted, burn rate, per-model | **Transcripts** (`getWindowValue`) |

## Token freshness — Claude owns the token, we just read it

**Decision: active nudge near expiry.** Agent Pulse never calls the OAuth *token*
endpoint itself; Claude Code owns refresh. We only ever *read* `.credentials.json`. When
the token is about to expire and nothing else is keeping it fresh, we fire a tiny
`claude -p` so Claude Code performs its own refresh, then we re-read the file.

Mechanics:

- Extend `credentials.ts` to also surface `claudeAiOauth.expiresAt` (today it returns only
  `accessToken`). Schedule the nudge for ~2 min **before** `expiresAt` — proactive, so the
  usage panel never flickers to "Token expired."
- The nudge is the cheapest possible call: `claude -p --model haiku` with a trivial prompt.
  Cost is a rounding error; its only job is to make Claude Code bootstrap auth and refresh.
- **The opener and the refresh are the same call.** A scheduled window-opener ping already
  refreshes the token as a side effect, so in `fixed`/`adaptive` mode the openers keep it
  fresh. A *dedicated* nudge is only needed in `off` mode (or a long gap with no upcoming
  slot) — and a slightly-stale reading while fully idle is harmless anyway.

### Why we don't refresh ourselves (tested)

We probed `POST https://console.anthropic.com/v1/oauth/token` with the Claude Code
`client_id`. Findings:

- Endpoint + client_id are correct (structured Anthropic errors, not 404).
- The token endpoint is **aggressively rate-limited (429), with no `Retry-After`**, and
  appears to **reject refreshes that aren't due** — repeated attempts 429'd while the
  access token still had ~3.7h of life.
- Therefore: an app refreshing on its own cadence would fight this limit and risk 429-ing
  *Claude Code's own* refresh. Whether refresh tokens rotate is moot — independent minting
  is off the table.

This is *why* the nudge fires only near expiry: that's the one moment a refresh is actually
due and will be accepted.

## Scheduling model — `off` / `fixed` / `adaptive`

User-configurable; **no hardcoded 6/11/4**. That trio is offered only as a one-click preset.

- **`off`** — today's behavior: passive nudges only, no auto-opening.
- **`fixed`** — user defines their own slots (add/remove rows: `06:00`, `11:00`, `16:00`,
  whatever fits them). The opener fires at each slot. Simple and predictable.
- **`adaptive`** — user sets a work-hours range + max windows/day. The scheduler opens a
  window at each block's `resetsAt` within work hours. Robust to manual drift: if the user
  messages Claude off-script, the cadence shifts forward instead of wasting a slot.

Proposed config (sibling to `UsageConfig` in `user-config.ts`):

```ts
interface SchedulerConfig {
  mode: 'off' | 'fixed' | 'adaptive';
  fixed: { time: string }[];                         // 'HH:mm' local — opener fires at each
  adaptive: { workHours: { start: string; end: string }; maxWindowsPerDay: number };
  tokenNudge: { enabled: boolean; leadMs: number };  // refresh ping before expiresAt (esp. `off` mode)
}
```

## The window opener

The action is a single primitive: a minimal `claude -p --model haiku` ping with a trivial
prompt. Its only job is to anchor a fresh 5-hour block at the scheduled moment (and refresh
the token in the same call). No prep, no briefing, no content — just the reset.

One primitive, two trigger policies:

- **Opener** — fires at a `fixed` slot or, in `adaptive` mode, at the previous block's
  `resetsAt`. Purpose: start the next window on the user's schedule.
- **Token nudge** — fires ~2 min before `expiresAt` when no opener is coming (`off` mode /
  long gaps). Purpose: keep the usage panel from going stale.

They're the same `claude -p` call; only the timing policy differs. In `fixed`/`adaptive`
mode the openers subsume the nudge.

## Bubble / UI integration

- Window-state glance: `🟢 Window 2 · 3h12m left` (fed by `resetsAt`).
- When idle between windows: `next window opens 4:00pm`.
- Reuse the existing nudge badge for "credit about to expire unused."
- Settings: a Scheduler section beside the existing Claude Subscription Usage panel —
  mode switch and (for `fixed`) a slot editor. Slot define editor should have option to pick a day as well to keep off the scheduler on weekend etc. 

## Constraints & caveats

- **You can't open a window without spending.** Each opener ping consumes a sliver of the
  window. Negligible (haiku, trivial prompt), but `pricing.ts` can still show the
  API-equivalent so the cost is never hidden.
- **Weekly cap.** Opener pings count against the weekly cap. Tiny, but a few per day adds up;
  cap the openers per day.
- **Token endpoint is rate-limited.** Never poll-refresh; only nudge near expiry.
- **Auth context for `claude -p`.** Must run in the user's logged-in session (where Claude
  Code's creds resolve), not a service/Task-Scheduler context — which is exactly why the
  scheduler lives *inside* the always-on Electron main process, not OS cron.

(Deferred: missed-slot behavior — laptop asleep at a slot time — is out of scope for now.)

# Codex Subscription-Usage Polling
Background poller that tracks ChatGPT/Codex weekly quota by calling the same internal endpoint the ChatGPT web UI uses.

Independent of hooks. Runs in the Electron main process, surfaces remaining quota even when Codex isn't actively coding.

Scope is Codex bubble only (toolId === 'codex'). Claude Code bubbles are unaffected.

The endpoint
```
GET https://chatgpt.com/backend-api/wham/usage
Authorization: Bearer <accessToken from ~/.codex/auth.json>
Accept: application/json
```

json payload:
```
{
    "user_id": "user-43pn0vfeiNHLGSLOPbnMBT0H",
    "account_id": "user-43pn0vfeiNHLGSLOPbnMBT0H",
    "email": "dipen@zuru.com",
    "plan_type": "free",
    "rate_limit": {
        "allowed": true,
        "limit_reached": false,
        "primary_window": {
            "used_percent": 25,
            "limit_window_seconds": 604800,
            "reset_after_seconds": 501635,
            "reset_at": 1779694268
        },
        "secondary_window": null
    },
    "code_review_rate_limit": null,
    "additional_rate_limits": null,
    "credits": {
        "has_credits": false,
        "unlimited": false,
        "overage_limit_reached": false,
        "balance": null,
        "approx_local_messages": null,
        "approx_cloud_messages": null
    },
    "spend_control": {
        "reached": false,
        "individual_limit": null
    },
    "rate_limit_reached_type": null,
    "promo": null,
    "referral_beacon": null,
    "rate_limit_reset_credits": {
        "available_count": 0,
        "can_reset": false
    }
}
```

Only primary_window is guaranteed. secondary_window may be null — render only the bar(s) that exist.

reset_at may be Unix seconds (number) or an ISO 8601 string. Handle both. Prefer reset_at; fall back to Date.now() + reset_after_seconds * 1000.

Undocumented. Wrap every call defensively; never crash on shape changes.
---

Credentials
Auth token lives at ~/.codex/auth.json. Read .accessToken (or .access_token — handle both). Re-read on every poll — Codex rewrites the file on token refresh.

No macOS Keychain path is needed; the file is sufficient.

---
Architecture
New files mirror the Claude poller structure

Polling loop
Default interval: 15 minutes (weekly windows shift slowly; no need for 10-min cadence).

Hard floor: 10 minutes.

Same recursive setTimeout + backoff pattern as the Claude poller.

Stop cleanly on before-quit.
--- 

Error handling
Condition	Behavior
200 OK, shape valid	Update snapshot, broadcast codex-usage:updated, check threshold.
200 OK, shape unrecognised	Log warn, status: 'unavailable'. Keep normal interval.
401	status: 'unauthenticated'. Pause. Message: "Sign into ChatGPT/Codex and retry."
429	Double delay (cap 60 min). Reset on next success.
5xx / network error	Log warn, skip. Keep normal interval.
404 / 400	status: 'unavailable'. Back off to 60 min.
Missing ~/.codex/auth.json	status: 'unauthenticated'. Pause.
Bubble UI — one progress bar
One bar below the Codex orb for primary_window. Render a second bar only when secondary_window is non-null (rare). Same 50px × 3px style, fill-color thresholds, and track opacity as the Claude bars.

Window height grows by the same increment used for Claude (already handled if you split BUBBLE_SIZE → WIDTH/HEIGHT). Codex bubbles simply render one bar instead of two; layout stays stable.

Hover title: "Weekly: 25% · resets in 5d 19h".

Settings UI addition
Inside the existing "Track Claude usage" section (or a sibling section), add:

Master toggle: "Track Codex usage"

Interval input (seconds, min 300, default 900)

Warning threshold slider (1–99%, default 80)

Snapshot display: "Weekly: 25% · resets in 5d 19h"

Status pill + Refresh now button (codex-usage:refresh-now)

---

Out of scope for MVP
Credit/balance display (rate_limit.credits) — no UI consumer yet.

plan_type display — add when a "plan badge" surface exists.

Token refresh — users must re-authenticate via ChatGPT.

What NOT to do
Don't put the fetch in the renderer — CORS blocks chatgpt.com from Electron's renderer.

Don't cache the token; re-read auth.json every poll.

Don't assume primary_window.reset_at is always a number.

Don't crash if rate_limit is absent entirely.
---
Style
Match the Claude poller exactly.

---
Deliverables
codex-poller.ts, codex-credentials.ts, codex-parse.ts + parser unit tests.

IPC wiring in src/main/index.ts (alongside the Claude poller).

Bar rendering in Bubble.tsx gated on toolId === 'codex'.

Settings panel section for Codex usage.

Inline comment wherever the "undocumented endpoint / sign in to refresh" caveat matters.
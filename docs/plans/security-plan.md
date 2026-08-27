# Agent Pulse — Security Hardening Plan

Practical, low-risk fixes for the issues in `security.md`. Sequenced so each step is shippable on its own and **none break a working install**. App-specific constraints in mind:

- Hooks bake the bridge URL into scripts at install time → token rotation requires re-install, which we already support.
- Claude Code's native `http` hook supports a `headers` object → we can use `Authorization: Bearer …` uniformly across bash, PowerShell, and native hooks.
- Cursor's MCP endpoint (`/mcp`) is called by Cursor itself and we don't control its config → keep that endpoint open but isolate it from the sensitive paths.
- Local-only app; no need for TLS, OAuth, etc.

---

## Phase 0 — Free wins (no behavior change)

These are pure hardening with no risk of breaking anything. Ship as one commit.

- [ ] **Bind bridge to `127.0.0.1` explicitly.** `server.listen(this.port, '127.0.0.1', …)` in `bridge/server.ts:83`. Closes the bridge to LAN access in one line.
- [ ] **Cap request body size.** Reject if `body.length > 64 * 1024` in both `/event` and `/mcp` handlers. Same file.
- [ ] **Cap `agent_pid_chain` length** to 16 in `extractCommonFields` (`bridge/server.ts:303-342`). Defends the focus PowerShell script against pathological inputs.
- [ ] **Switch `detector.ts:34` from `execSync(string)` to `execFile(lookup, [cmd])`.** Hardcoded args today, but staying in `execFile` is a free invariant.
- [ ] **Use `|` as the `sed` delimiter** in the three hook-script builders in `config-writer.ts` (search for `s/^{/{$INJECT/`). Fixes the silent drop of `cwd`/`agent_pid`/`transcript_path` on Unix paths.
- [ ] **Redact `transcript_path` in debug logs** (`bridge/server.ts:96, 108`). Replace the absolute path with its basename when `logger.debug` writes raw bodies.

**Risk:** ~zero. The bind change is the only one a user could notice; if anyone is reaching the bridge from another machine on purpose (very unlikely), they need to opt in.

---

## Phase 1 — Host header validation (defeats DNS rebinding)

Cheapest fix for the browser-driven attack surface. No new state, no config migration.

- [ ] In `handleRequest`, reject any request whose `req.headers.host` isn't in a small allowlist:
      `localhost:<port>`, `127.0.0.1:<port>`, `[::1]:<port>`.
- [ ] Return `403 Forbidden` with no body. Don't `JSON.parse` first.

**Risk:** Hooks send the request from `curl`/`Invoke-WebRequest`/Claude Code's native http hook — all of them set Host to the URL they were configured with. Since `BRIDGE_URL = http://localhost:<port>/event`, all three pass. The MCP endpoint sees a `Host` of whatever Cursor was pointed at, which is also localhost.

**How to verify before shipping:** add a structured log line for every rejected request during a dev session and run normal Claude Code + Cursor + Antigravity flows for a few minutes. Zero rejections expected.

---

## Phase 2 — Bearer token on `/event`

This is the big one. Token lives in the user config; hook scripts include it at install time.

### Generation

- [ ] Add `bridgeToken: string` to `UserConfig` in `user-config.ts`. On `loadConfig`, if missing, generate via `crypto.randomBytes(32).toString('base64url')` and `saveConfig`.
- [ ] Persist with restrictive perms on POSIX: write to a temp file with `mode: 0o600`, then rename. (Windows ACLs already restrict `%APPDATA%`/userData per user.)

### Server-side check

- [ ] In `/event` handler, require `Authorization: Bearer <token>` matching `userConfig.bridgeToken`. Use `crypto.timingSafeEqual` on equal-length buffers.
- [ ] Keep `/mcp` unauthenticated for now — it only triggers `working`/`idle` state on Cursor and is harder to abuse than `/event` (no `transcript_path` read, no DB write of cwd/model). Revisit if we ever expand MCP capabilities.

### Hook-side wiring

Each generator in `config-writer.ts` already builds the URL and the script. Add the token at the same point:

- [ ] **Claude Code native HTTP hook** (`writeClaudeCodeHook`): add `headers: { Authorization: 'Bearer ' + token }` to the `httpHook` object. Native — no script change needed.
- [ ] **Bash hook scripts** (`buildShellScript`, `buildCodexShellScript`, `buildAntigravityShellScript`): add `-H "Authorization: Bearer <token>"` to the `curl` call. The token is baked in as a string literal during install (not read from env, since the hook may run in a stripped shell).
- [ ] **PowerShell hook scripts**: add `-Headers @{ 'Authorization' = 'Bearer <token>' }` to `Invoke-WebRequest`.

### Migration path (the "don't break existing installs" piece)

- [ ] On app startup, **after** `loadConfig`, walk every tool the user has hooks installed for (the detector already reports `hookInstalled`) and **re-install** silently if the on-disk script doesn't contain the current token. This is a one-time refresh; from then on, the token rotates only when the user manually clears their config.
- [ ] Surface a Settings affordance: "Rotate bridge token" → regenerate and re-install all hooks.

**Risk:** Medium-low. Three things to watch:
1. Users with custom hook configs we don't know about → the re-install preserves other tools' hooks (existing code already does `filter(h => !h.command?.includes('agent-pulse'))`). Verify this still holds for the new entries.
2. A user has an older Agent Pulse with no token, upgrades, but the bridge starts before re-install runs → there's a window where the new bridge rejects old hooks. Fix: keep a **two-token** acceptance for one launch — accept either "no header" OR "matching bearer," log a warning when the legacy path is hit, and disable legacy after re-install completes.
3. Build smoke test: `test:bridge` already exists. Extend it to include a token-auth flow.

---

## Phase 3 — `transcript_path` allowlist

Closes the arbitrary file read once Phase 2 is in (Phase 2 alone reduces the attacker pool to "things that can read the user config," which is much smaller, but defense-in-depth is cheap here).

- [ ] In `transcript-reader.ts:onTranscriptEvent`, before `fs.statSync`, run `path.resolve(transcriptPath)` and require the resolved path to start with one of:
  - `path.join(os.homedir(), '.claude', 'projects')`
  - `path.join(os.homedir(), '.codex', 'sessions')` (verify the actual subdir Codex uses)
  - Whatever path patterns the other tools produce (audit needed — check 2-3 real transcript paths from a dev session per tool)
- [ ] Reject silently otherwise; log at `debug` level.

**Risk:** Low — but requires a quick audit of every tool's transcript path layout before merging. Add a unit test in `timeline/__tests__/` with one valid and one traversal path per tool.

---

## Phase 4 — Lock down `open-path` IPC

- [ ] Replace `ipcMain.handle('open-path', filePath)` with `ipcMain.handle('reveal-tool-location', toolId: ToolId)`. The handler looks up the cached detection result (or re-runs the detector) and opens *that* path, never a renderer-supplied string.
- [ ] Update the one call site in `SettingsPanel.tsx:510-513` to pass `toolId` instead of `config.location`.

**Risk:** Zero functional change for the user. One renderer file changes.

---

## Phase 5 — Guardrail engine: timeout + tighter pattern validation

Defends against ReDoS even if every other layer fails.

- [ ] In `engine.ts:evaluateCommand`, wrap each `re.test(command)` call in a 50ms timeout. Easiest implementation: use the `re2` package (linear-time alternative to `RegExp`) for user-supplied rules, keep native `RegExp` for built-in `CORE_RULES`.
- [ ] If `re2` is too heavy a dep, second option: run user patterns in a `Worker` with a hard `terminate()` deadline. Cache compiled workers per pattern hash.

**Risk:** Medium. Behavior of `re2` differs from JS `RegExp` in edge cases (no backreferences, no lookbehind). Audit `CORE_RULES` first — if none use backreferences, just use `re2` everywhere and we're done.

---

## Phase 6 — Hook script hygiene (Windows ACLs)

Lower priority since Phase 2 already kills the high-value abuse path (replacing the hook script to inject calls into our bridge). But still good practice.

- [ ] After writing `agent-pulse.ps1` / `agent-pulse.sh` on Windows, `execFile('icacls', [path, '/inheritance:r', '/grant:r', `${username}:F`])` to remove inheritance and grant only the current user. (POSIX side: `fs.chmod(path, 0o700)` already implied by `mode: 0o755` write; tighten to `0o700`.)
- [ ] Don't drop `-ExecutionPolicy Bypass` yet — without signed scripts we'd lock out users on `Restricted`/`AllSigned`. Park this as a follow-up tied to code signing.

**Risk:** Low. Test on a fresh Windows VM that `icacls` exits 0 and the hook still runs.

---

## Phase 7 — Defense-in-depth follow-ups (no rush)

- [ ] `setWindowOpenHandler({ action: 'deny' })` on every BrowserWindow.
- [ ] Tighten CSP in packaged builds: drop `http://localhost:5173`/`ws://…` from `connect-src` when `app.isPackaged`.
- [ ] Hard-cap `events` table size in `db.ts` (e.g. delete oldest 10k rows when count exceeds 1M).
- [ ] Add a "Reset all data" affordance in Settings that wipes the SQLite DB and rotates the bridge token in one click — useful for the user if they ever suspect compromise.

---

## What we're explicitly NOT doing (and why)

- **Auth on `/mcp`:** Cursor's MCP client doesn't know about our token, and the endpoint only flips `working`/`idle`. Add later if we expand MCP scope.
- **TLS on the bridge:** Local-only; the token + Host header check covers the actual threats.
- **Pinning Antigravity's self-signed cert:** No stable fingerprint exposed by the IDE. Park.
- **Replacing PowerShell with a signed binary:** Worth doing eventually (code-signing cert) but out of scope here.

---

## Suggested ship order

1. Phase 0 (one commit, ~30 min)
2. Phase 1 (one commit, ~20 min + a few minutes of dev-session validation)
3. Phase 2 (multi-commit feature branch, ~1-2 days including migration testing across all six tools)
4. Phase 3 (~half day including transcript-path audit)
5. Phase 4 (~1 hour)
6. Phase 5 (~half day if `re2` works; longer if we go the Worker route)
7. Phase 6, 7 — when convenient

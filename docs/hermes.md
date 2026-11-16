# Hermes observation integration (experimental)

Tested source: [Hermes v0.23.1](https://github.com/NousResearch/hermes-agent/tree/3b421578588243f920886e6fe79a6faa87ea026e), commit `3b421578588243f920886e6fe79a6faa87ea026e`. This integration is **live status only**, with manual profile setup. It does not block tools, ingest transcripts, account for tokens, derive session history or count turns. It does not yet distinguish failed/interrupted turn completion from normal completion.

## How it works

- Hermes's native outbound payloads include conversation content, so they are never pointed at Pulse. A filtering shell adapter (`public/hermes/agent_pulse.py`) runs as a Hermes command hook and forwards only metadata.
- [`shell_hooks.py`](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/agent/shell_hooks.py) emits top-level `session_id`/`profile` and nested `extra.request_id`. It splits each hook command with `split_command_line` (POSIX `shlex.split`; on Windows `shlex.split(posix=False)` minus one layer of matching quotes) and runs it with `shell=False`. Each exact event/command pair needs consent; a synthetic `hermes hooks test` does not establish it.
- [`turn_finalizer.py`](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/agent/turn_finalizer.py) emits `on_session_end` per completed turn, not when the process dies.
- [`human_input_hooks.py`](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/tools/human_input_hooks.py) pairs request/resolution IDs. A tool event must not clear a pending request.
- Pulse aggregates all Hermes sessions into one live bubble status. That status reaches the bubble, the "needs you" escalation (webhooks, OS notification) and the screen-edge glow. It is **not** recorded in the timeline: SessionsDeriver groups by tool/project and infers turns from state transitions, so an aggregate would produce false attribution and counts.

## Setup (macOS, Linux and native Windows)

While a Hermes home exists, Agent Pulse keeps a copy of the helper at `~/.agent-pulse/hermes/agent_pulse.py` (`%USERPROFILE%\.agent-pulse\hermes\agent_pulse.py` on Windows), refreshed on each launch. Start Agent Pulse first.

Run the helper with any Python 3.9+ that has `ruamel.yaml`. Hermes's own launcher runs its managed Python with a private import path, so Hermes's interpreter is not required (or usually usable) here; the hooks themselves are stdlib-only and run with the Python you used for setup. Keep that Python installed, and re-run setup if you replace it.

macOS / Linux (default profile `~/.hermes`):

```sh
python3 -m pip install --user ruamel.yaml
python3 ~/.agent-pulse/hermes/agent_pulse.py --install --home ~/.hermes
```

Windows, PowerShell (default profile `%LOCALAPPDATA%\hermes`):

```powershell
py -m pip install --user ruamel.yaml
py "$env:USERPROFILE\.agent-pulse\hermes\agent_pulse.py" --install --home "$env:LOCALAPPDATA\hermes"
```

The helper uses YAML 1.1 semantics (as Hermes does), preserves comments, unrelated settings, foreign hooks and outbound hooks, and keeps a private backup under `agent-pulse-observer`. It refuses malformed or duplicate-key config and treats a bare `hooks:` key as empty. Run it while other config writers are stopped; its lock (`flock` on POSIX, `msvcrt.locking` on Windows) serializes this helper only. It installs an immutable content-addressed adapter copy and merges only entries matching its previous manifest command. If Hermes's own Python happens to import `hermes_cli`, the helper also checks the required hook capabilities; otherwise it relies on the minimum version above and `hermes hooks doctor`.

Select that same profile in Hermes, restart, and approve **only the six observer event/command pairs** at Hermes's prompts. The helper never edits the consent allowlist, sets `hooks_auto_accept`, or passes `--accept-hooks`. Run `hermes hooks doctor` in the selected profile, then run a real turn. Settings deliberately does not claim "Hook installed" from file existence. A changed adapter command requires new consent; old approvals are not silently revoked.

Install separately into each profile home. Each installation has its own random namespace; runtime profile and session identities are HMAC-hashed with Pulse's dedicated local token, so profiles with identical raw session IDs stay separate. Missing session IDs are ignored rather than merged into a phantom session.

Removal (same command, `--uninstall`):

```sh
python3 ~/.agent-pulse/hermes/agent_pulse.py --uninstall --home ~/.hermes
```

This removes only its exact registered command entries (and any hook list it leaves empty), keeps backup/adapter files and consent intact, and prints a command for revoking its old consent. Restart Hermes after removal. The desktop Uninstall button does not manage this manual integration.

**Not supported yet:** Hermes running inside WSL2 while Agent Pulse runs on Windows. WSL2 has its own home folder (so no `hermes.json`) and, unless mirrored networking is enabled, its own loopback.

## State and transport contract

- `pre_llm_call`, `pre_tool_call`, `post_tool_call`: working; `on_session_end`: idle-active.
- `on_human_input_request`: waiting until the matching resolution or a newer turn completion. Several simultaneous waits and sessions are supported; resolving one cannot clear another. Resolved IDs are retained through the replay acceptance window.
- Aggregate priority: waiting, then working, then idle-active. `activeAgents` means observed working/waiting **sessions**, not subagent depth.
- Expiry, checked every five seconds; idle then means no recent observation, **not proven process death** (there is no heartbeat):
  - a session with a pending human request never expires; it clears on resolution, a newer turn completion, or a Pulse restart;
  - a session whose newest activity is `pre_tool_call` (a long build or test) expires after 30 quiet minutes;
  - any other session expires after 5 quiet minutes.
- Serial turns per session are supported; overlapping turns sharing one session ID are not distinguished.
- Adapter timestamps order events; stale events (>30s), events >5s in the future, duplicates and delayed pre-completion activity are rejected/ignored. No retries, guaranteed delivery or reliable cross-process total ordering is claimed. Concurrent hook starts can still race.
- Separate `POST /hermes/event` and `GET /hermes/status` use a dedicated random capability in `~/.agent-pulse/hermes.json`, rotated at app startup. It grants no backlog/MCP access. Session hashes change on restart. File mode is 0600 on POSIX; on Windows it inherits the user profile's private ACL. Local code running as the same user is inside the trust boundary.
- Fixed `127.0.0.1`, Host allowlist, Origin rejection, no CORS, exact metadata schema, 2KiB byte limit, one-second body deadline, at most 16 in-flight bodies, 100 requests/sec, 256 sessions and 128 request records/session. Saturation fails open and loses observations. Generic `/event` cannot ingest Hermes status.
- Runtime stdin cap: 8MiB. Oversized conversation payloads are dropped. Telemetry includes only schema version, event name, hashed session/request IDs and timestamp; no prompt, answer, credential, cwd, tool arguments, transcript, model output or raw error text.
- Network operations time out after 200ms each; Hermes supplies an outer one-second hook-process timeout. No proxy, redirect, retry, response-body parsing, stdout directives or nonzero runtime exits. Pulse being unavailable cannot grant, deny or modify a tool call.

## Reproducible checks

```sh
npm run build
npm test
python3 scripts/hermes/test_adapter.py   # any Python 3.9+; config tests skip without ruamel.yaml
HERMES_TEST_PYTHON=/path/to/hermes-test-venv/bin/python \
HERMES_TEST_SOURCE=/path/to/hermes-source python3 scripts/hermes/run-live.py
```

`test_adapter.py` covers config/comment/consent preservation, idempotent setup and removal, malformed config refusal, privacy and profile correlation, bounded failure, and the Windows/POSIX hook command round-trip through Hermes's splitting rules.

The live harness creates a disposable HOME/USERPROFILE/HERMES_HOME under the system temp directory, runs the production compiled StatusBridgeServer and StatusStateManager (`run-bridge.cjs` refuses to run against a real home), and approves only the six fixture event/commands using Hermes's consent writer. It executes a real AIAgent turn against a deterministic local OpenAI-compatible provider and a real `clarify` tool, checks working → waiting → working → idle-active against both the session snapshot and the normalized ToolStatus, then stops Pulse and repeats the turn to verify fail-open behavior. It does not exercise the Electron window/IPC layer or a human using the CLI.

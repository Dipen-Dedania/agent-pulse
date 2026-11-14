# Hermes observation integration (experimental)

Tested source: [Hermes v0.23.1](https://github.com/NousResearch/hermes-agent/tree/3b421578588243f920886e6fe79a6faa87ea026e), commit `3b421578588243f920886e6fe79a6faa87ea026e`, Python 3.14.9. This first integration is **live status only**, with manual profile setup. It does not block tools, ingest transcripts, account for tokens, derive session history or count turns. It does not yet distinguish failed/interrupted turn completion from normal completion.

## Review decisions

Reviewed against Pulse main `6e4fd7885b6a493a1439ebbd3f0a51401a2749c7`, repository AGENTS.md, and the installed official Hermes source before implementation. No repository `.agents/skills` directory was present. Existing website changes and draft PR #25 are independent.

- Hermes native outbound payloads include conversation content. Do not point them directly at Pulse. The shell adapter filters before transport.
- [`shell_hooks.py`](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/agent/shell_hooks.py) emits top-level `session_id`/`profile` and nested `extra.request_id`. Runtime dispatch needs approval of each exact event/command. A synthetic `hermes hooks test` does not establish consent.
- [`turn_finalizer.py`](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/agent/turn_finalizer.py) emits `on_session_end` per completed turn, not when the process dies.
- [`human_input_hooks.py`](https://github.com/NousResearch/hermes-agent/blob/3b421578588243f920886e6fe79a6faa87ea026e/tools/human_input_hooks.py) pairs request/resolution IDs. A tool event must not clear a pending request.
- Pulse's existing SessionsDeriver groups by tool/project and infers turns from state transitions. Feeding aggregate state or Hermes waits to it would produce false attribution/counts. Hermes therefore updates only the live bubble projection and an authenticated diagnostic snapshot, with no timeline events.

## Setup (Linux/macOS manual workflow)

Use the Python interpreter from your Hermes v0.23.1 environment, not an unrelated system Python. Start Agent Pulse first. From the checked-out Agent Pulse repository:

```sh
/path/to/hermes/python public/hermes/agent_pulse.py --install --home /absolute/path/to/hermes-profile
```

The helper checks required hook capabilities. It uses Hermes's installed `ruamel.yaml` dependency and YAML 1.1 semantics, preserves comments, unrelated settings, foreign hooks and outbound hooks, and keeps a private backup under `agent-pulse-observer`. It refuses malformed/duplicate-key config. Run while other config writers are stopped; its lock serializes this helper but cannot coordinate unrelated editors. It installs immutable content-addressed adapter files and merges only entries matching its previous manifest command. Do not move the Hermes interpreter afterwards without reinstalling.

Select that same profile in Hermes, restart, and approve **only the six observer event/command pairs** at Hermes's prompts. This helper never edits the consent allowlist, sets `hooks_auto_accept`, or passes `--accept-hooks`. Existing broad auto-accept settings, if any, remain your responsibility. Run `hermes hooks doctor` in the selected profile, then run a real turn. The Pulse setup guide deliberately does not claim “Hook Active” from mere file existence. A changed adapter command requires new consent. Old approvals are not silently revoked; revoke obsolete exact commands yourself.

Install separately into each profile home. Each installation has its own random namespace; runtime profile and session identities are HMAC-hashed with Pulse's dedicated local token. Profiles with identical raw session IDs remain separate. Missing session IDs are ignored rather than merged into a phantom session.

Removal:

```sh
/path/to/hermes/python public/hermes/agent_pulse.py --uninstall --home /absolute/path/to/hermes-profile
```

This removes only its exact registered command entries, keeps backup/adapter files and consent intact, and prints a command for revoking its old consent. Restart Hermes after removal. The desktop Uninstall button does not manage this manual integration.

## State and transport contract

- `pre_llm_call`, `pre_tool_call`, `post_tool_call`: working; `on_session_end`: idle-active.
- `on_human_input_request`: waiting until the matching resolution or a newer turn completion. Several simultaneous waits and sessions are supported; resolving one cannot clear another. Resolved IDs are retained through the replay acceptance window.
- Aggregate priority: waiting, then working, then idle-active. `activeAgents` means observed working/waiting **sessions**, not subagent depth.
- Quiet sessions expire after five minutes, checked every five seconds. Idle then means no recent observation, **not proven process death**. There is no heartbeat; a long silent model call or human wait may expire. Serial turns per session are supported; overlapping turns sharing one session ID are not distinguished.
- Adapter timestamps order events; stale events (>30s), events >5s in the future, duplicates and delayed pre-completion activity are rejected/ignored. No retries, guaranteed delivery or reliable cross-process total ordering is claimed. Concurrent hook starts can still race; use distinct session IDs for concurrent conversations.
- Separate `POST /hermes/event` and `GET /hermes/status` use a dedicated random capability in `~/.agent-pulse/hermes.json`, rotated at app startup. It grants no backlog/MCP access. Session hashes change on restart. File mode is 0600 on POSIX. Local code running as the same user is inside the trust boundary.
- Fixed `127.0.0.1`, Host allowlist, Origin rejection, no CORS, exact metadata schema, 2KiB byte limit, one-second body deadline, at most 16 in-flight bodies, 100 requests/sec, 256 sessions and 128 request records/session. Saturation fails open and loses observations. Existing integration routes retain their contracts; generic `/event` cannot ingest Hermes status.
- Runtime stdin cap: 8MiB. Oversized conversation payloads are dropped. Telemetry includes only schema version, event name, hashed session/request IDs and timestamp; no prompt, answer, credential, cwd, tool arguments, transcript, model output or raw error text. Hermes itself still receives and may display its own tool content.
- Network operations time out after 200ms each; Hermes supplies an outer one-second hook-process timeout. No proxy, redirect, retry, response-body parsing, stdout directives or nonzero runtime exits. Pulse unavailable cannot grant/deny/modify a tool call.

## Reproducible checks

```sh
npm run build
npm test
PYTHONPATH=/tmp/hermes-pulse-test /tmp/hermes-test-venv/bin/python scripts/hermes/test_adapter.py
HERMES_TEST_PYTHON=/tmp/hermes-test-venv/bin/python \
HERMES_TEST_SOURCE=/tmp/hermes-pulse-test python3 scripts/hermes/run-live.py
```

The live harness creates disposable HOME/HERMES_HOME, runs the production compiled StatusBridgeServer and StatusStateManager, and approves only the six fixture event/commands using Hermes's consent writer. It executes a real AIAgent turn against a deterministic local OpenAI-compatible provider and a real `clarify` tool with a deterministic answer callback. It independently checks both the session snapshot and actual normalized ToolStatus at working → waiting → working → idle-active, including explicit zero active count. It then stops Pulse and repeats the real turn to verify fail-open behavior. This is not paid-model inference or a human interacting with the CLI's UI.

The cloud execution environment prevents Electron/Chromium's singleton Unix socket (`socket() failed: Operation not permitted`), so full desktop launch is not validated. The bridge harness does not mock normalization, state aggregation, shell execution, consent registration, tool dispatch, HTTP or the Hermes runtime, but does not exercise BrowserWindow/IPC rendering. Native Windows installation (the setup helper uses POSIX flock), macOS desktop behavior, packaged installers, interactive consent/approval UI, gateway/chat surfaces and long-lived multi-profile gateway reloads remain unvalidated. Keep this PR in draft pending native desktop testing.

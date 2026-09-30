# Muse Code hook fixtures

Captured 2026-09-29 from **Muse Code 1.4.1 (1.4.1-R4503.1)**, native Windows build,
by registering a probe command hook for every lifecycle event in
`~/.config/muse/settings.json` and driving `muse exec` against (a) the built-in
`--provider echo` and (b) a local fake Meta Model API (OpenAI Responses-API dialect)
that answered with a `powershell` tool call. Each file is one verbatim stdin payload
with paths scrubbed and the `messages` / `tools` / `options` arrays elided.

## What the spike settled

| Question | Answer |
|---|---|
| Config path | `$XDG_CONFIG_HOME/muse/settings.json`, else `~/.config/muse/settings.json`, on every platform (no `%APPDATA%`). Data lives in `~/.local/share/muse`. |
| Hooks schema | Claude-style: `hooks: { <Event>: [{ hooks: [{ type: "command", command, timeout }] }] }`. A bare array is rejected ("hooks must be an object"). `matcher` is optional. Handler fields also accepted: `commandWindows` (selected on Windows only), `statusMessage`, `async`. |
| Trust | User-level (settings.json) hooks ran headless with no trust prompt. The TUI has a one-time "new or changed hooks need your trust" prompt. Project `.muse/hooks.json` needs workspace trust. |
| `timeout` unit | Seconds (a `timeout: 1` hook that took ~240 ms completed). |
| Environment | Cleared. On Windows only `ComSpec, Path, PATHEXT, PROMPT, SystemRoot, TEMP, TMP, windir` survive. |
| Windows spawn | `cmd.exe /C <command>` with embedded `"` backslash-escaped → any quoted path fails. Fix: `powershell.exe -EncodedCommand <base64>` (no quotes needed). |
| BOM | A UTF-8 BOM in settings.json is fatal ("malformed settings file … expected value at line 1 column 1"). Missing `schema_version` is fatal too. |
| Events observed | SessionStart, UserPromptSubmit, PreLLMCall, PostLLMCall, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, Notification (`permission_prompt`), Stop, SubagentStart/Stop (for Muse's internal `skill-reminder` / `verify-reminder` observers on every turn), SessionEnd. |
| Stop | Fired at every turn end on both the echo and Meta provider paths in 1.4.1 (the 1.2 "skips Stop" report did not reproduce). Caveat: an `async: true` Stop hook can be cut off when `muse exec` exits right after the turn; SessionEnd still arrives and also maps to idle. |
| Deny | Output `{"hookSpecificOutput":{"permissionDecision":"deny",…}}` or `{"decision":"block","reason":…}` blocks the call (status `blocked`, model sees "tool blocked by hook: <reason>"). Any extra top-level key (`status`, `continue`, `matchedRules`) makes the hook FAIL and Muse fails open — the command runs. |
| Tool names | Windows shell tool is `powershell` (`tool_input.command`); Unix presumably `bash`. Read tool is `read_file` (`tool_input.path`). |
| Tokens | `PostLLMCall.usage` = `{input_tokens, output_tokens, cached_tokens, reasoning_tokens}` per call, but the payload also embeds the full conversation (>64 KB), so it is not registered in v1. |
| Session logs | `~/.local/share/muse/sessions/YYYY/MM/DD/<session-id>/session.jsonl` records every hook run with stdout/stderr/exit code — the place to debug a hook. |

`PostLLMCall.idle.json` (tool_call_count 0) and `PostLLMCall.toolcalls.json` (1) are kept
for a future token/idle feature; the bridge ignores both today.

## Shim performance findings (Windows, fresh `powershell.exe` per hook)

| Cost | Measured | Handling in the shipped shim |
|---|---|---|
| `powershell.exe` startup + stdin read | ~0.17 s | unavoidable floor |
| POST to `http://localhost:<port>` via .NET | ~2.0 s (IPv6 `::1` attempt against the IPv4-only bridge) | post to `http://127.0.0.1:<port>` instead (~0.18 s total) |
| `Invoke-WebRequest` / `ConvertTo-Json` | +0.3 s / +1 s (module auto-import) | raw `HttpWebRequest`, manual JSON escaping |
| WMI process-tree walk (`Get-CimInstance`) | 2–4 s cold, even as one query | only in the awaited once-per-session SessionStart; the bridge latches the chain for later events |
| Result | PreToolUse (awaited, per tool call) **0.19 s**; SessionStart ~2.5 s once; all other events `async: true` | |

Async hooks are not ordered against awaited ones, so a slow background hook could land
after a later Stop and revive an idle bubble — hence every non-SessionStart hook is on
the fast path and PostToolUse maps to `working`.

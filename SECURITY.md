# Security Policy

## Supported versions

Only the **latest release** on the [Releases page](https://github.com/Dipen-Dedania/agent-pulse/releases/latest) receives security fixes. The in-app updater keeps installed copies current.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use one of these private channels:

1. **GitHub private vulnerability reporting** (preferred): [Report a vulnerability](https://github.com/Dipen-Dedania/agent-pulse/security/advisories/new)
2. **Email**: dipen27891@gmail.com — include "SECURITY" in the subject line.

Please include a description of the issue, steps to reproduce, the affected version, and any suggested mitigation. You can expect an acknowledgment within **7 days**. Please allow a reasonable disclosure window before publishing details.

## Scope — areas we especially want eyes on

Agent Pulse is a local-first desktop app, but several subsystems are security-sensitive and review of them is explicitly welcome:

- **HTTP bridge** (`src/main/bridge/`) — a local HTTP server on `localhost:4242` that ingests events from tool hooks. Anything affecting what it accepts, from whom, and how payloads are parsed.
- **Hook installers** (`src/main/installer/`) — code that writes into other tools' config files (`~/.claude/settings.json`, `~/.cursor/hooks.json`, etc.) and generates shell scripts they execute.
- **Credential / token handling** — usage pollers read OAuth tokens and session cookies (Anthropic OAuth, ChatGPT session, Cursor `state.vscdb`, GitHub Copilot token from the Windows credential store). Leaks to logs, disk, or the network beyond the intended API endpoints are high-severity.
- **Guardrail engine** (`src/main/guardrails/`) — regex-based command blocking; bypasses or ReDoS in user-supplied rules.
- **Webhook senders** (`src/main/notifications/`) — outbound Discord/Slack payload construction.
- **Auto-updater** (`src/main/updater/`) — update feed handling and binary installation.

## Out of scope

- Vulnerabilities requiring an already-compromised local machine or another local process with the user's own privileges.
- Issues in the third-party tools Agent Pulse integrates with (report those upstream).

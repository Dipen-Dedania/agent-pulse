# Central Ignore Mechanism for AI Coding Agents — Research & Analysis

> **Goal:** Investigate a central mechanism in Agent Pulse that manages "ignore lists" for the
> AI coding agents it already tracks (Claude Code, Cursor, GitHub Copilot, Codex, +others),
> so agents never touch secrets — `.env`, SSH keys, credential files, tokens, etc.
>
> **Scope note:** This is a **separate guardrail** from the existing *command* guardrails in Agent
> Pulse. Command guardrails gate *what an agent is allowed to run*; this **Secret Protection**
> guardrail gates *what an agent is allowed to read*. The two must be presented as **distinct
> sections** in the UI (see §2).
>
> **Date:** 2026-06-16 · **Status:** research → ready to turn into an implementation plan.

---

## 1. TL;DR

- **Every major agent has *some* exclusion mechanism, but they are fragmented**: different file
  names, different syntaxes (mostly `.gitignore`-style), different enforcement guarantees, and
  different scopes (project / global / org).
- **Scope is project-directory based, NOT workspace based** (see §3). The artifacts live at a
  project/repo *root*; "workspace" (e.g. VS Code multi-root) is not a native scope. Most agents also
  support a **user/global** variant, and a few add **org/enterprise** scope.
- **None of them is a hard security boundary.** Vendors explicitly call them "best-effort." Several
  have *known bugs* where `.env` is read despite being excluded. Terminal/MCP sub-tools routinely
  bypass the ignore layer.
- **The strongest real protections are OS-level sandbox deny-reads (Codex) and built-in
  hardcoded secret-name refusals (Gemini, partially Codex)** — not the user-facing ignore files.
- **There is an active industry push to standardize one filename** (e.g. `.aiignore`) but no
  consensus yet.
- **Chosen approach for Agent Pulse (see §7.0):** a **layered safety net from one canonical glob
  list** — **(1) global ignore files** (broad, cooperative), **(2) hook-based active blocking** where
  supported (enforced refusal + the detection sensor), and **(3) transparency**: a "not 100%" warning
  with the concrete reason + a supported-agents coverage list + per-agent enforcement badges. Secret
  managers / sandboxes are recommended as the real boundary, not owned by Agent Pulse.

---

## 2. Guardrail taxonomy & UI distinction

Agent Pulse will have **two separate guardrail families**. They share a "guardrail" mental model but
protect against different things and must be visually and structurally separated in Settings.

| | **Command Guardrails** (existing) | **Secret Protection** (new — this doc) |
|---|---|---|
| **Protects against** | Agent *running* dangerous commands | Agent *reading* sensitive files |
| **Unit of control** | Command patterns / allow-deny rules | File glob patterns |
| **Underlying mechanism** | Hook/interception of tool calls | Per-agent ignore files + deny rules |
| **Example rule** | block `rm -rf`, `git push --force` | block `.env`, `*.pem`, `~/.ssh/**` |
| **Failure mode** | Agent executes destructive action | Secret leaks into model context / upstream |

### UI requirements
- **Two clearly labeled sections** under a "Guardrails" parent (e.g. tabs or distinct cards):
  **"Command Guardrails"** and **"Secret Protection"**.
- Each section gets its own description line so users never conflate "block a command" with "hide a
  file."
- Shared visual language (same card/toggle components) but **never a merged rule list** — the rule
  *shapes* differ (command pattern vs file glob).
- The Secret Protection section additionally surfaces:
  - the **supported-agents row** (§2.1) — which installed agents this list is being applied to;
  - **scope** controls (§3) and **enforcement-strength badges** (§7.3) that the command section does
    not need.

### 2.1 Supported AI agents (must be highlighted in the UI)
The Secret Protection panel must **explicitly show which agents the list covers**, and reflect each
agent's *detected/installed* state. Recommended display: a row of agent chips, each showing
coverage + enforcement strength.

| Agent | Covered by fan-out writer? | What gets written | UI badge |
|---|---|---|---|
| **Claude Code** | ✅ Yes | `permissions.deny` in `settings.json` (+ optional hook) | ⚠️ Soft — deny can be bypassed |
| **Cursor** | ✅ Yes | `.cursorignore` | ⚠️ Soft — terminal/MCP bypass |
| **Windsurf** | ✅ Yes | `.codeiumignore` | ⚠️ Soft — context exclusion |
| **Gemini CLI** | ✅ Yes | `.geminiignore` | ⚠️ Soft list + ✅ built-in secret-name refusal |
| **GitHub Copilot** | ⚠️ Partial | `.copilotignore` (client) + org guidance | ⚠️ Not applied in Agent/CLI modes |
| **OpenAI Codex** | ⚠️ Partial | config sandbox deny additions | ✅ Hard (OS sandbox) — built-ins already cover most |

- Agents **not detected** on the machine should be shown greyed-out ("not installed") rather than
  hidden, so users know the full coverage map.
- The row doubles as a trust signal: it makes clear Agent Pulse is the *one place* that protects
  *all* installed agents at once.

---

## 3. Scope model: project vs workspace vs global vs org  *(the direct answer)*

**The ignore mechanisms are project-directory based, not workspace based.** Each agent reads a file
located at the **root of a project/repo folder**. The VS Code "workspace" concept (a `.code-workspace`
that can bundle several root folders) is **not** a scope any of these tools honor — in a multi-root
workspace, *each folder* needs its own ignore file.

The meaningful scope axis is: **Project (per folder) → User/Global (per machine) → Org/Enterprise**.

| Agent | Project scope (per folder root) | User/Global scope | Org/Enterprise scope | "Workspace" aware? |
|---|---|---|---|---|
| **Claude Code** | `.claude/settings.json` (+ `.settings.local.json`) | `~/.claude/settings.json` | Enterprise managed settings | ❌ (per-dir only) |
| **Cursor** | `.cursorignore` / `.cursorindexingignore` at root; *Hierarchical* setting walks parent dirs | Global ignore patterns (Cursor settings) | ❌ | ⚠️ via hierarchical parent walk, not `.code-workspace` |
| **GitHub Copilot** | `.copilotignore` at repo root (client-side) | ❌ (no individual global) | ✅ repo + org + enterprise Content Exclusion | ❌ |
| **OpenAI Codex** | project config / `AGENTS.md` overrides | `~/.codex/config.toml` (sandbox deny defaults) | Cloud env config | ❌ |
| **Windsurf** | `.codeiumignore` at root | `~/.codeium/.codeiumignore` | ❌ | ❌ |
| **Gemini CLI / Code Assist** | `.geminiignore` / `.aiexclude` at root (follows dir hierarchy) | ❌ (project-anchored) | ❌ | ❌ |

### Implications for Agent Pulse
- **Default to User/Global scope** wherever an agent supports it (`~/.claude`, `~/.codeium`, Cursor
  global patterns, Codex `config.toml`). This protects *every* directory the agent ever opens — the
  safest default and the one that matches Agent Pulse's "ambient, always-on" philosophy.
- **Offer Project scope as an override** for agents where the session's working directory is known
  (Agent Pulse already sees lifecycle events that can carry a project path). Useful for project-only
  patterns or for Copilot/Gemini which lack an individual-global file.
- **Org scope is out of scope for auto-write** (Copilot Content Exclusion, Claude enterprise) — a
  desktop app can't set these; surface as **guidance** instead.
- **No "workspace" mode.** If a tracked workspace spans multiple roots, treat it as N project folders.

---

## 4. Per-agent mechanism matrix

| Agent | Ignore file(s) | Settings/deny rules | Global scope | Org scope | Hard guarantee? |
|---|---|---|---|---|---|
| **Claude Code** | `.claudeignore` (requested, **not reliably honored**) | `permissions.deny` → `Read(./.env)` in `settings.json` | ✅ `~/.claude/settings.json` | Enterprise managed settings | ❌ deny known to be bypassable |
| **Cursor** | `.cursorignore` (full block), `.cursorindexingignore` (index only) | — | ✅ global ignore patterns | ❌ | ❌ "best-effort"; terminal/MCP bypass |
| **GitHub Copilot** | `.copilotignore` (VS Code, client-side) | Content Exclusion (YAML paths) | — | ✅ **repo + org + enterprise** | ⚠️ but **not applied in Agent/Edit/CLI/Coding-agent modes** |
| **OpenAI Codex** | (no user ignore file yet — open FR) | OS sandbox **deny-read** + `shell_environment_policy` | ✅ config defaults | Cloud env config | ✅ **strongest** (OS-enforced) for built-in secret paths |
| **Windsurf (Codeium)** | `.codeiumignore` | `.windsurfrules` NEVER/ALWAYS guardrails | ✅ `~/.codeium/.codeiumignore` | — | ❌ context-exclusion, LLM-unpredictable |
| **Gemini CLI / Code Assist** | `.geminiignore` (CLI), `.aiexclude` (Code Assist) | hardcoded secret-name refusal | ✅ | ❌ | ⚠️ built-in refusal for `.env/.pem/credentials.json` is hard; ignore file is soft |

Legend: ✅ exists / reliable · ⚠️ partial / conditional · ❌ absent or unreliable.

---

## 5. Agent-by-agent detail

### 5.1 Claude Code
- **Primary mechanism:** `permissions.deny` array in `.claude/settings.json` (project) or
  `~/.claude/settings.json` (user/global). Patterns are tool-scoped, e.g.:
  ```jsonc
  {
    "permissions": {
      "deny": [
        "Read(./.env)", "Read(./.env.*)",
        "Read(./secrets/**)", "Read(*.pem)", "Read(*.key)",
        "Read(~/.ssh/**)"
      ]
    }
  }
  ```
- **`.claudeignore`:** community-requested (issue #4160) to mirror `.gitignore`. As of research date
  it is **not reliably honored** — `.env` contents can still be read.
- **⚠️ Critical caveat:** multiple reports (incl. GH issue #24846, press coverage) that
  `permissions.deny` for `Read(./.env*)` is **not consistently enforced** — Claude Code may still
  ingest `.env` (e.g. when a tool/subprocess loads env or reads via bash). Users get a false sense
  of security.
- **Recommended hardening:** combine deny rules + move secrets out of the working tree + consider a
  `PreToolUse` hook that blocks reads of sensitive paths (defense in depth).

### 5.2 Cursor
- **`.cursorignore`** = full block: excluded from semantic search, Tab, Agent tools, inline edit,
  and `@` mentions.
- **`.cursorindexingignore`** = index-only block: not indexed, but AI can still read on demand.
- Standard `.gitignore` glob syntax; supports negation `!` (with the usual "can't re-include under a
  wildcard-excluded parent" limitation). "Hierarchical Cursor Ignore" setting walks parent dirs;
  global ignore patterns available.
- **Caveats (from Cursor's own docs):**
  - "Terminal and MCP server tools used by Agent **cannot block access** to code governed by
    `.cursorignore`."
  - "Complete protection isn't guaranteed due to LLM unpredictability."
  - Real-world reports of `.env` being uploaded despite `.gitignore`/`.cursorignore` (HN thread).

### 5.3 GitHub Copilot
- **Content Exclusion** (the canonical mechanism) configured at **repository / org / enterprise**
  level via Settings → Copilot → Content exclusion. YAML path patterns:
  ```yaml
  "*":
    - "**/.env"
    - "**/*.pem"
    - "secrets/**"
  ```
- **`.copilotignore`** (VS Code, client-side) can mirror/extend org patterns and is
  version-controlled.
- Requires **Copilot Business or Enterprise** to use content exclusion.
- **⚠️ Major limitation:** content exclusion is **NOT supported in Edit mode, Agent mode, Copilot
  CLI, or the Copilot Coding Agent** — i.e. exactly the autonomous modes most relevant to Agent
  Pulse. It mainly governs inline completion + chat context.

### 5.4 OpenAI Codex
- **No user-facing ignore file yet** (open feature requests: issue #1397, discussion #5523).
- **Strongest actual enforcement** comes from the **OS-level sandbox**: in `read-only` and
  `workspace-write` modes Codex applies **default deny-read entries** for common secret paths:
  `.env*`, private-key extensions, SSH key filenames, `.npmrc`, `.pypirc`, `.netrc`,
  `.aws/credentials`, `.azure/**`, `.config/gcloud/**`, `secrets/**`.
- **`shell_environment_policy`** controls which env vars get passed to subprocesses (clean/trimmed
  start + include/exclude/override) to avoid leaking secrets into spawned commands.
- Sandbox + approval policy are separate, composable controls.
- Because enforcement is OS-level, it is **harder to bypass** than the context-filter approach of
  the others — but it covers a *fixed built-in list*, not arbitrary user globs (yet).

### 5.5 Windsurf (Codeium)
- **`.codeiumignore`** (analogous to `.gitignore`) excludes files from AI context including
  Cascade's reads. Also respects `.gitignore`. Global file at `~/.codeium/.codeiumignore`.
- **`.windsurfrules`** with NEVER/ALWAYS flags = prompt-level guardrails (soft).
- Same class of "context exclusion, not a hard boundary" guarantee.

### 5.6 Gemini CLI / Gemini Code Assist
- **`.geminiignore`** (CLI) and **`.aiexclude`** (Code Assist) — both `.gitignore` syntax.
- **Built-in hard refusal:** Gemini CLI refuses to display contents of files with sensitive-looking
  names (`.env`, `.pem`, `credentials.json`) **regardless of `.geminiignore`** — this is the
  reliable layer.
- Known bug: in some agent tools (`list_dir` in Antigravity) `.geminiignore` is ignored (issue
  #14546).

---

## 6. Cross-cutting findings

1. **Syntax is nearly universal `.gitignore` glob** across `.cursorignore`, `.codeiumignore`,
   `.geminiignore`, `.aiexclude`, `.copilotignore`. A central tool can author one canonical glob
   list and emit each file with minimal translation.
2. **Filename fragmentation is the core pain.** Switching agents = re-authoring exclusions =
   leak risk. There is an active standardization discussion (gemini-cli issues #4688) proposing a
   single `.aiignore`. No agent enforces a shared standard today.
3. **Two fundamentally different enforcement models:**
   - **Context exclusion** (Cursor, Copilot, Windsurf, Gemini ignore-file, Claude deny): filters
     what the *model* sees. Bypassable by terminal/MCP/subprocess tools and by LLM behavior.
   - **Sandbox / hardcoded refusal** (Codex OS deny-read, Gemini secret-name refusal): enforced
     below the model. Much stronger but covers fixed lists.
4. **Agent/autonomous modes are the weak point.** Copilot exclusions don't apply in Agent mode;
   Cursor terminal/MCP bypasses; Claude deny is inconsistently enforced. These are precisely the
   modes Agent Pulse observes.
5. **None should be the *sole* control for true secrets.** Defense in depth = keep secrets outside
   the repo + secret manager + ignore files + sandbox + monitoring.

---

## 7. Proposal: "Secret Protection" feature for Agent Pulse

Agent Pulse already detects installed agents and writes hook configs (see
`src/main/installer/`). The same detection layer is the natural place to own a **single canonical
ignore ruleset** that fans out to every detected agent. This ships as a **new, separate guardrail
family** alongside the existing command guardrails (§2).

### 7.0 Defined strategy (the chosen approach)

Agent Pulse implements Secret Protection as a **layered safety net from one canonical glob list**,
combined with **radical transparency** about its limits:

1. **Layer 1 — Global ignore files (cooperative filter).** Write the canonical list into each
   detected agent's **user/global** ignore artifact (`.cursorignore`, `.codeiumignore`,
   `.geminiignore`, Claude `permissions.deny`, …). Protects every directory by default, with no
   per-project setup. *Weak but free and broad.*
2. **Layer 2 — Hook-based active blocking (enforced refusal).** Where the agent supports
   tool-call hooks (Claude `PreToolUse`, Cursor `beforeReadFile`, Codex), install a hook that
   **denies a `Read` of a protected path at invocation time** — and reports the attempt to the
   bridge. *Stronger than the ignore file; also doubles as the detection sensor.*
3. **Layer 3 — Transparency (it's not 100%).** Always show: a **"not a guarantee" warning with the
   concrete reason**, a **supported-agents coverage list** (§2.1), and **per-agent
   enforcement-strength badges** (§7.4). Recommend defense-in-depth (secret managers / sandbox) as
   the real boundary.

Explicitly **not** the strategy: pretending the ignore file is a security boundary; targeting
org/enterprise controls (guidance only); a "workspace" scope.

### 7.1 Concept
- New UI section under **Guardrails → Secret Protection** (distinct from Command Guardrails): a single
  editable glob list (`.env*`, `*.pem`, `*.key`, `**/id_rsa`, `~/.ssh/**`, `secrets/**`, `*.p12`,
  `.aws/credentials`, …) with a curated **default secrets preset** (§9).
- A **fan-out writer** per detected agent that translates the canonical list into the right
  artifact(s) — both the ignore file (Layer 1) and, where supported, the blocking hook (Layer 2):

  | Agent | Layer 1: ignore artifact | Layer 2: hook blocking |
  |---|---|---|
  | Claude Code | `permissions.deny` in `~/.claude/settings.json` | ✅ `PreToolUse` on `Read`/`Grep`/`Bash` |
  | Cursor | global `.cursorignore` patterns | ✅ `beforeReadFile` (deny/redact) |
  | Codex | config sandbox deny additions | ⚠️ `PreToolUse`-style (partial) |
  | Windsurf | `~/.codeium/.codeiumignore` | ❌ lifecycle hooks only |
  | Gemini | `.geminiignore` (project) | ❌ + built-in secret-name refusal helps |
  | Copilot | `.copilotignore` (project) + org guidance | ❌ no tool-call deny |

### 7.2 Hook-based active blocking — mechanics & detection
The hook is a checkpoint **between the agent and the file**, and the **same hook is the monitoring
sensor**. Flow on a single read:
1. Agent calls its `Read` tool on `/project/.env`.
2. Before executing, it runs Agent Pulse's hook, passing JSON on **stdin**:
   `{ "tool_name": "Read", "tool_input": { "file_path": "/project/.env" }, "cwd": "...", "session_id": "..." }`.
3. Hook matches `file_path` against the canonical glob list.
4. **Match → deny** by returning
   `{ "hookSpecificOutput": { "hookEventName": "PreToolUse", "permissionDecision": "deny",
   "permissionDecisionReason": "Agent Pulse: protected secret file" } }` (or `exit 2` + stderr).
   The read never executes — the agent gets the denial reason, not the contents.
5. No match → `allow` / `exit 0`.

- **Detection / "how we check":** before denying, the hook `POST`s the attempt to the bridge
  (`localhost:4242`) → bubble alert. An **audit-only mode** uses `PostToolUse` (fires *after* a read)
  to warn without blocking. So Agent Pulse never polls the filesystem — agents self-report reads
  through the hook.
- **Coverage gap (must be disclosed):** hooks fire on **structured tool calls only**. Shell reads
  (`cat .env`, `source .env`, `python -c "open('.env')"`) only trip the `Bash` hook, where the
  command string must be *parsed/guessed* — brittle and bypassable. Cursor forum reports `deny`
  sometimes not blocking and `beforeReadFile` not firing in agent mode. **Only an OS sandbox /
  separate-user closes the shell hole.** → This is the literal reason behind the Layer-3 warning.

### 7.3 Scope handling (from §3)
- **Default = User/Global scope** for every agent that supports it — write once, protect all dirs.
- **Project scope as an explicit override** using the working directory carried in lifecycle events;
  required for Copilot/Gemini which have no individual-global file.
- **Org scope = guidance only** (cannot be auto-written by a desktop app).
- **No "workspace" mode** — multi-root workspaces are handled as N project folders.

### 7.4 Transparency: warning + reason + supported-agents list (Layer 3)
Because the analysis shows these mechanisms are **unreliable**, the UI must be explicit:
- A persistent **"Not a 100% guarantee" notice** in the Secret Protection panel, stating the
  **reason in plain terms**: "Ignore files are best-effort and hooks can't catch files read through
  shell commands. For true secrets, use a secret manager or sandbox."
- A **supported-agents coverage list** (§2.1) showing, per detected agent: covered? ignore-file?
  hook-block? + an **enforcement-strength badge** (`Hard (sandbox)` / `Soft (context)` /
  `Bypassable in Agent mode` / `Known-bypass bug`).
- Greyed-out entries for installed-but-uncoverable agents, so the gap is visible, not hidden.

### 7.5 Risks / open questions
- **Write conflicts:** users may hand-edit these files. Use clearly delimited managed blocks
  (`# >>> agent-pulse managed >>>` … `# <<< agent-pulse managed <<<`) and never clobber user lines.
- **Org-managed settings** (Copilot Content Exclusion, Claude enterprise) can't be written by a
  desktop app — surface as guidance, not auto-write.
- **Hook install reuse:** Layer 2 should reuse the existing command-guardrail hook machinery in
  `src/main/installer/` rather than a parallel system — confirm the hook config can carry both a
  command matcher and a `Read`/file matcher without conflict.
- **Don't over-promise.** Marketing must say "reduces exposure + warns you," not "blocks agents from
  secrets."
- **Prior art:** lightweight OSS `aiignore-cli` already does fan-out file generation (CLI, Apache-2.0,
  early-stage); enterprise DLP (Cycode, GitGuardian, Cloudanix) already does real-time read
  interception. Agent Pulse's wedge = **GUI + global ignore + hook blocking + ambient monitoring for
  the individual developer**.

### 7.6 Suggested phasing
1. **Phase 1 — Canonical list + dual fan-out writer (Layer 1 + Layer 2).** Global-scope ignore
   files for all supported agents **and** the blocking hook for Claude/Cursor/Codex. Default secrets
   preset. Managed-block safety. Ship with the Layer-3 warning from day one.
2. **Phase 2 — UI split + scope controls + supported-agents/enforcement badges** (the §2 two-section
   split, §3 scope toggle, §7.4 transparency surface).
3. **Phase 3 — Active monitoring/alert** when a tracked agent touches a protected path (built on the
   same hook → bridge path from §7.2).
4. **Phase 4 — Standardization bet:** also emit a single `.aiignore` and follow the emerging
   cross-agent standard if/when it lands.

---

## 8. Open questions for development

These must be resolved (or explicitly deferred) when turning this into an implementation plan.

### Architecture & data model
1. **Canonical store location** — where does Agent Pulse persist the master glob list? (Its own
   settings store in `src/common`/main config.) Single global list, or list + per-project overrides?
2. **Merge strategy per artifact type** — text files (`.cursorignore`, `.geminiignore`,
   `.codeiumignore`) take a delimited managed block; but Claude `settings.json` and Codex
   `config.toml` need **structured merge** (array/key merge), not a text block. Two writer
   strategies needed. How do we de-dupe against entries the user already added by hand?
3. **Idempotency & removal** — when a pattern is removed from the canonical list, the writer must
   *retract* it from every agent (clean the managed block), not just stop adding. Need a stable
   managed-block contract for add/update/remove.

### Scope & detection
4. **Project-path discovery** — for project-scope writes we need the agent session's working
   directory. Do lifecycle events reliably carry cwd for *every* agent? (Per prior findings, hook
   payloads vary widely — Cursor/Copilot may not expose it.) If unknown → global-only for that agent.
5. **Global-scope coverage gaps** — Copilot and Gemini have **no individual user-global file**, so
   global-default protection isn't achievable for them without a project path. How do we communicate
   that gap honestly in the UI?
6. **Multi-root workspaces** — confirm the "N project folders" handling; does Agent Pulse enumerate
   all roots, or only the active one?

### Sync lifecycle
7. **When do we (re)write?** — on list edit, on app start, on agent launch, on agent detection? A
   newly *installed* agent should retroactively receive the current list — what triggers that?
8. **Drift / external edits** — if a user or another tool edits the managed block, do we overwrite,
   warn, or reconcile? (Lean: detect drift, warn, offer re-sync.)

### Per-agent specifics
9. **Codex** — write into `~/.codex/config.toml` sandbox deny (risk of clobbering user TOML), or
   just *surface* that its built-in deny-list already covers most secrets and skip writing? Decision
   affects whether Codex is "covered" or "informational" in §2.1.
10. **Claude target file** — write to `settings.json`, `settings.local.json`, or user `~/.claude`?
    Project `settings.json` is committed to git (visible to team); `.local` is not. Which is default?
11. **Optional Claude `PreToolUse` hook** — do we ship the defense-in-depth read-blocking hook in
    Phase 1, or defer? It overlaps with the command-guardrail hook machinery — reuse or separate?
12. **Glob dialect differences** — negation/re-include semantics differ (Cursor can't re-include
    under a wildcard-excluded parent). Do we restrict the canonical syntax to a safe common subset?

### Monitoring (Phase 3)
13. **Read-event availability** — which agents actually emit (or let us infer) a "file was read"
    signal, and at what fidelity? This is the biggest unknown and gates the whole monitoring feature.
14. **Alert UX** — bubble alert vs notification vs settings badge; how to avoid alert fatigue when an
    agent legitimately reads many files.

### Product / naming
15. **Preset governance** — is the default secrets preset (§9) user-editable, resettable, and
    version-updatable as we learn new secret patterns?
16. **Org/enterprise story** — Copilot Content Exclusion and Claude enterprise settings are
    guidance-only today. Is there appetite to later support managed/team rollout?

---

## 9. Default "protected secrets" preset (starting point)

```gitignore
# Environment & secrets
.env
.env.*
*.local.env

# Keys & certs
*.pem
*.key
*.p12
*.pfx
id_rsa
id_dsa
id_ecdsa
id_ed25519

# SSH / cloud credentials
**/.ssh/**
**/.aws/credentials
**/.azure/**
**/.config/gcloud/**

# Package/registry tokens
.npmrc
.pypirc
.netrc

# Generic secret stores
secrets/**
credentials.json
service-account*.json
*.kdbx
```

---

## 10. Sources

- [Claude Code settings — Claude Code Docs](https://code.claude.com/docs/en/settings)
- [Read deny permissions not enforced for .env (issue #24846)](https://github.com/anthropics/claude-code/issues/24846)
- [Support ".claudeignore" (issue #4160)](https://github.com/anthropics/claude-code/issues/4160)
- [Prevent Claude Code from accessing .env — Jad Joubran](https://jadjoubran.io/blog/prevent-claude-code-env)
- [Claude Code can consume/transmit .env even if told not to — Martin Eve](https://eve.gd/2026/04/19/claude-code-can-consume-transmit-and-compromise-your-env-files-even-if-you-tell-it-not-to/)
- [Claude Code's prying AIs read off-limits secret files — The Register](https://www.theregister.com/2026/01/28/claude_code_ai_secrets_files/)
- [Ignore File — Cursor Docs](https://cursor.com/docs/reference/ignore-file)
- [Cursor uploads .env despite .gitignore/.cursorignore — Hacker News](https://news.ycombinator.com/item?id=43331770)
- [Excluding content from GitHub Copilot — GitHub Docs](https://docs.github.com/en/copilot/how-tos/configure-content-exclusion/exclude-content-from-copilot)
- [Content exclusion concepts — GitHub Docs](https://docs.github.com/en/copilot/concepts/context/content-exclusion)
- [Configure GitHub Copilot Access via Content Exclusion — Microsoft C++ Blog](https://devblogs.microsoft.com/cppblog/configure-github-copilot-access-via-content-exclusion/)
- [Agent approvals & security — OpenAI Codex](https://developers.openai.com/codex/agent-approvals-security)
- [Sandbox — OpenAI Codex](https://developers.openai.com/codex/concepts/sandboxing)
- [Configurable file exclusion patterns for sensitive files (codex issue #1397)](https://github.com/openai/codex/issues/1397)
- [How can sensitive files remain uncompromised with Codex CLI? (discussion #5523)](https://github.com/openai/codex/discussions/5523)
- [Ignoring Files — Gemini CLI Docs](https://google-gemini.github.io/gemini-cli/docs/cli/gemini-ignore.html)
- [Exclude files from Gemini Code Assist (.aiexclude) — Google](https://developers.google.com/gemini-code-assist/docs/create-aiexclude-file)
- [Introduce a standard for ai agent ignore file (gemini-cli issue #4688)](https://github.com/google-gemini/gemini-cli/issues/4688)
- [Add configurable file exclusion patterns (gemini-cli issue #2092)](https://github.com/google-gemini/gemini-cli/issues/2092)
- [How to Protect Sensitive Files From AI Coding Agents — Agent Rules Builder](https://www.agentrulegen.com/guides/how-to-protect-files-from-ai-agents)
- [Is it safe to use Cursor or Windsurf — Trelis](https://trelis.substack.com/p/is-it-safe-to-use-cursor-or-windsurf)
- [aiignore-cli (multi-tool ignore generator, Apache-2.0)](https://github.com/yjcho9317/aiignore-cli)
- [Cycode AI Guardrails — real-time IDE security](https://cycode.com/blog/ai-guardrails-real-time-ide-security/)
- [GitGuardian ggshield AI hook](https://www.helpnetsecurity.com/2026/04/15/product-showcase-gitguardian-ggshield-ai-hook/)

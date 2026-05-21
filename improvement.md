#command guardrail system

This app already observes Claude Code hooks and tool calls. I now want you to design and implement a **command guardrail system** with two tiers of safety rules.

High‑level intent
- Goal: Add a reusable guardrail module that inspects commands before execution and classifies them into:
  1) **Must block** (hard stop) category
  2) **Should warn / soft guardrail** category
- Scope: This is focused on shell / CLI commands (especially Bash or platform shell), but the design should make it easy to extend later.
- Platforms: Support Windows, macOS and Linux.

Context to load before coding
1. Scan the repo to understand:
   - How we currently watch hooks and tool calls
   - Where command strings are available (e.g., PreToolUse JSON from Claude Code)
   - Existing logging / UI surface to show warnings or blocks
2. Identify the best place(s) to add:
   - A central “guardrail engine” (pure JS/TS logic)
   - Integration points with the existing hook watcher and Electron UI

Behavioral requirements
- **Tier 1: MUST‑BLOCK rules**
  - Block clearly destructive or high‑risk commands (e.g., `rm -rf /`, `git reset --hard`, `git clean -fd`, mass `drop table`, pipe‑to‑shell like `curl ... | sh`, etc.).
  - These rules should be OS‑aware so we don’t block legitimate platform‑specific commands incorrectly.
  - When a Tier 1 rule matches:
    - Do NOT allow execution.
    - Emit a structured event (e.g., `{ level: "error", ruleId, command, reason }`).
    - Provide a clear human‑readable message explaining why it was blocked and, when possible, suggest a safer alternative.

- **Tier 2: SHOULD‑WARN rules**
  - Catch commands that are not inherently fatal but are risky or often mistakes (e.g., `git push --force`, `npm install` in a pnpm repo, `docker system prune -a`, etc.).
  - When a Tier 2 rule matches:
    - Do NOT automatically block.
    - Surface a prominent warning in the UI and/or log:
      - Rule id, command, and a short explanation.
    - Make it easy to:
      - (a) upgrade a rule from Tier 2 → Tier 1
      - (b) temporarily bypass a single warning (with explicit user confirmation)

Design + implementation expectations
- Create a **config‑driven rule system**, not hard‑coded if/else everywhere:
  - A rule should at least have: `id`, `pattern` (regex or matcher), `os` (one or more), `tier` ("mustBlock" | "warn"), `message`, and optional `suggestedFix`.
  - Structure the rules so we can load:
    - A “core” rule set (safe defaults)
    - Project‑ or workspace‑specific overrides later.
- Implement a pure function like `evaluateCommand(command, context) -> { decision, matchedRule, messages[] }`:
  - `decision` ∈ { "allow", "warn", "block" }
  - `context` may include OS, repo metadata, and any other relevant details.
- Wire this evaluation function into the existing hook watcher flow where commands are currently observed.
- Add **minimal but solid tests** for:
  - At least one Tier 1 rule per OS
  - A couple of Tier 2 rules
  - No false positives on obviously safe commands
- Keep changes surgical:
  - Prefer small modules over large refactors.
  - Use existing project style and conventions.

UX / developer experience
- Provide a simple way for a developer to:
  - Toggle guardrails on/off for debugging (but default is ON).
  - Inspect which rule blocked/warned on a given command.
  - Extend or override rules in a single place (e.g., `guardrails.config.ts`).
- When appropriate, add **short inline docs / comments** explaining:
  - How to add a new rule
  - How the evaluation pipeline works

Workflow
1. First, describe your understanding of the current hook watcher architecture and where command data flows.
2. Propose a small design sketch for the guardrail module (files, functions, rule structure).
3. Once I confirm (or after a short self‑check if everything is obvious), implement in small steps:
   - Create the rule engine and a minimal initial rule set (both tiers).
   - Integrate it into the hook watcher pipeline.
   - Add tests.
   - Add any UI/logging surfaces needed to make warnings and blocks visible.
4. At the end, summarize:
   - What rules exist (Tier 1 vs Tier 2, per OS)
   - How to extend them
   - How a future developer would plug this into additional tools (e.g., non‑Bash commands or other agents).

Constraints and guardrails for YOU
- Prefer **config + pure functions** over framework magic.
- No speculative abstraction: keep it as simple as possible while still cleanly extensible.
- Touch only the files that are necessary for this feature.
- If you’re unsure about a rule (e.g., whether it should be Tier 1 or Tier 2), call it out explicitly in comments or TODOs rather than guessing.

Start by:
- Reading the repo.
- Mapping where commands appear today.
- Proposing the initial Tier 1 and Tier 2 rule lists for macOS and Linux based on common dangerous patterns.
Then wait for my confirmation or edits before wiring everything fully.
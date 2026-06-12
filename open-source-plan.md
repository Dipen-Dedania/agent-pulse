# Open-Sourcing Plan — Agent Pulse

Goal: make the now-public repo welcoming, trustworthy, and contribution-ready.
Phases are ordered by urgency; each item lists the concrete file or setting to change.

---

## Phase 0 — Urgent hygiene (do first, before promoting the repo)

1. **Fix the license mismatch**
   - `package.json`: change `"license": "ISC"` → `"license": "AGPL-3.0-only"` (SPDX expression; the dual-license offer lives in the license file, not here).
   - Split `LICENSE.md` into:
     - `LICENSE` — the verbatim AGPLv3 text (GitHub then auto-detects it and shows the license chip).
     - `COPYING.commercial.md` (or a "Licensing" section in README) — the dual-license / commercial-offer explanation.
   - Fill in `package.json` `description`, `author`, `keywords` while in there.

2. **Decide the contributor-licensing model (blocks accepting outside PRs)**
   - Dual-licensing requires you to own (or be licensed to relicense) every line. Options:
     - **CLA** (recommended for the current model): add a CLA via [cla-assistant.io](https://cla-assistant.io) or the `contributor-assistant/github-action`; document it in CONTRIBUTING.md.
     - **DCO only**: simpler, but then external contributions are AGPL-only and the commercial license can only cover your own code — document that asymmetry honestly.
   - Whichever you pick, state it explicitly in CONTRIBUTING.md.

3. **Purge internal working notes from the public tree**
   - Tracked files to delete or move to a private location: `plan.md`, `prd.md`, `qa.md`, `improvement.md`, `scheduler.md`, `codex-usage.md`, `codex.md` (verify each — anything genuinely useful to contributors moves to `docs/`).
   - Untrack `.claude/settings.local.json` (`git rm --cached`) and add `.claude/settings.local.json` + a catch-all for local notes (e.g. `*.local.md` or a `notes/` dir) to `.gitignore`.
   - Untracked-but-present files (`audit.md`, `backlog.md`, `security.md`, `security-plan.md`, `bubble-click-research.md`, `copilot-usage.md`, `github-pages/PLAN.md`, `github-pages/design.md`): move out of the repo dir or into a gitignored folder so they can't be committed accidentally.
   - ⚠️ `security.md` at root is internal notes — if it ever lands on GitHub it will be surfaced as the repo's *security policy*. Replace with a real `SECURITY.md` (Phase 1).

4. **Secret/history scan**
   - Run a one-off scan (`gitleaks detect` or `trufflehog git`) over full history — this codebase handles session tokens (Cursor `state.vscdb`, GitHub `gho_` tokens), so verify none were ever committed in fixtures/logs.
   - Enable **Settings → Code security**: secret scanning + push protection, private vulnerability reporting.

5. **README corrections for public status**
   - Remove the *"repo is private, so downloads require sign-in"* paragraph.
   - Verify the Releases page actually has public artifacts; if releases were created while private, confirm they're visible.

---

## Phase 1 — Community health files (`.github/` + root)

All of these are picked up by GitHub's "community standards" checklist (Insights → Community).

1. **`CONTRIBUTING.md`** (root)
   - Dev setup: Node 18+, `npm install`, `npm run rebuild:native` (better-sqlite3 gotcha!), `npm start`.
   - How to run tests (`npm test`, `npm run test:bridge`) and what must pass before a PR.
   - Architecture orientation: link the README architecture section; one paragraph on the bridge → normalized-event → renderer flow; where to add a new tool integration (`src/main/installer/`, `src/common/toolMeta.ts`).
   - PR conventions: branch from `main`, conventional-commit-style titles (`fix:`, `feat:` — matches existing history), one logical change per PR.
   - CLA/DCO statement from Phase 0.2.
   - Platform note: maintainers develop on Windows; macOS/Linux testing is especially valuable from contributors.

2. **`SECURITY.md`** (root or `.github/`)
   - Supported versions (latest release only).
   - Private reporting channel: GitHub private vulnerability reporting (enable it) + email fallback.
   - Scope notes: local HTTP bridge on :4242, hook installers writing to user config files, token handling in usage pollers — explicitly invite review of these.

3. **`CODE_OF_CONDUCT.md`** — Contributor Covenant v2.1, contact email filled in.

4. **`.github/PULL_REQUEST_TEMPLATE.md`**
   ```markdown
   ## What & why
   <!-- Link the issue: Fixes #123 -->

   ## How it was tested
   - [ ] `npm test` passes
   - [ ] Manually verified on: Windows / macOS / Linux (delete non-applicable)

   ## Checklist
   - [ ] Follows the normalized event schema in `src/common/` for tool communication
   - [ ] No secrets / personal paths in code or fixtures
   - [ ] Docs updated (README / CONTRIBUTING) if behavior changed
   ```

5. **Issue templates (`.github/ISSUE_TEMPLATE/`)** — use issue *forms* (YAML):
   - `bug_report.yml` — fields: app version, OS + version, affected tool (dropdown: Claude Code / Cursor / Copilot / Codex / Kiro / Antigravity / app itself), what happened, main-process log excerpt, hook config involved.
   - `feature_request.yml` — problem / proposed solution / alternatives.
   - `tool_support_request.yml` — request a new agent/tool integration: tool name, does it expose hooks/lifecycle events, docs links. (This will likely be your most common request type.)
   - `config.yml` — `blank_issues_enabled: false`, contact links → Discussions for Q&A.

6. **`.github/FUNDING.yml`** — optional (GitHub Sponsors / Ko-fi) given the commercial-license model.

7. **`CODEOWNERS`** — `* @Dipen-Dedania` so PRs auto-request your review.

---

## Phase 2 — CI for contributors

1. **New `.github/workflows/ci.yml`** triggered on `pull_request` (and `push` to main):
   - Matrix: `windows-latest`, `macos-latest`, `ubuntu-latest`.
   - Steps: `npm ci` → `npm run build:main` (type check) → `npm test`.
   - Keep it secret-free so it runs safely on fork PRs (no GCP auth — that stays in release.yml).
2. **Trim `release.yml`** so the push-to-main trigger doesn't duplicate what ci.yml now covers (or keep artifacts build but let ci.yml be the required check).
3. **Branch protection on `main`**: require the CI check + 1 review (or just the check while solo), no force pushes.
4. **`.github/dependabot.yml`** — weekly `npm` + `github-actions` updates, grouped minor/patch to limit noise.

---

## Phase 3 — Labels

Create via `gh label create` script or a labels-sync action. Suggested set:

| Label | Purpose |
| --- | --- |
| `bug`, `enhancement`, `documentation`, `question` | Standard triage |
| `good first issue`, `help wanted` | Contributor funnel (GitHub surfaces these) |
| `tool: claude-code`, `tool: cursor`, `tool: copilot`, `tool: codex`, `tool: kiro`, `tool: antigravity` | Per-integration triage |
| `area: bridge`, `area: bubbles/ui`, `area: installer/hooks`, `area: timeline/analytics`, `area: usage-pollers`, `area: guardrails`, `area: updater`, `area: statusline` | Subsystem routing |
| `platform: windows`, `platform: macos`, `platform: linux` | OS-specific issues |
| `new-tool-request` | Pairs with the tool-support issue template |
| `needs-repro`, `upstream` | Triage states |

Seed 3–5 `good first issue` items from the existing backlog (e.g. small UI polish, a doc fix, an extra guardrail rule) — an empty "good first issue" filter kills contributor momentum.

---

## Phase 4 — README rework

Keep the strong feature documentation, but restructure for a public audience:

1. **Top of file**: badges (CI status, latest release, license AGPL-3.0, platform support), then a **screenshot or GIF of the bubbles in action** — this is a visual product; one image beats the entire Highlights section for conversion.
2. **Move maintainer internals out**: the "Auto-updates → Releasing a new build / Required secrets" and Firebase-bucket details belong in `docs/RELEASING.md`. Public README keeps only "how updates reach you" (one paragraph).
3. **Add sections**: Contributing (link CONTRIBUTING.md + good-first-issue filter), Security (link SECURITY.md), Licensing (AGPLv3 + commercial contact — keep, it's already there).
4. **Fix**: private-repo paragraph (Phase 0.5), and re-verify the supported-tools table against current code before publishing.

---

## Phase 5 — Repo settings & polish (GitHub UI)

- **About box**: description ("Floating desktop status bubbles for your AI coding agents"), website (the GitHub Pages site), topics: `electron`, `react`, `typescript`, `ai-agents`, `claude-code`, `cursor`, `github-copilot`, `developer-tools`, `desktop-app`, `productivity`.
- **Social preview image** (Settings → General) — reuse the logo/og image from github-pages.
- **Enable Discussions** with Q&A + Show-and-tell categories; point issue-template `config.yml` contact links at it.
- **CHANGELOG.md** — start one (or formalize that GitHub Releases *are* the changelog and link that from README).
- Disable the wiki (unused) to reduce surface area.

---

## Suggested execution order

| PR | Contents |
| --- | --- |
| 1 | Phase 0: license fix, notes purge, README private-repo fix, gitignore |
| 2 | Phase 1: CONTRIBUTING, SECURITY, CoC, PR template, issue forms, CODEOWNERS |
| 3 | Phase 2: ci.yml, dependabot.yml (+ branch protection in UI) |
| 4 | Phase 4: README restructure + screenshots + docs/RELEASING.md |
| — | Phases 3 & 5 are GitHub-side (labels script, settings), no PR needed |

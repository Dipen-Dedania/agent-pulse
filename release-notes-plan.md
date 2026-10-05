# Release notes: "what's new" before and after an update

Status: planned 2026-10-05. Not started.

Today the Updates tab has a release-notes slot (`UpdatesTab.tsx:168`) that
never renders. The canonical feed is Firebase (`generic` provider), and
electron-builder only writes `releaseNotes` into `latest.yml` when
`releaseInfo` is configured, which it is not. The GitHub Release does get an
auto-generated changelog, but the app never reads GitHub. After an update
installs there is no "you just updated" moment at all: nothing stores the
previous version, nothing compares it to `app.getVersion()`.

Goal: a user sees what changed (a) on the Updates tab when a new version is
pending, and (b) once, on the first launch after an update lands, on every
platform, from either feed, with no new npm dependencies.

## 0. Decisions

- **One changelog, hand-written, in the repo.** `CHANGELOG.md` at the root
  in Keep-a-Changelog shape (`## [1.4.0] - 2026-10-05`, then `### Added` /
  `### Fixed` / … bullets). It is the single source for the feed manifest,
  the GitHub Release body and the bundled post-install card. Auto-generated
  PR lists stay as an *appendix* on the GitHub Release only; they read like
  commit logs and are the wrong voice for an end-user card.
- **Feed-agnostic.** Both providers are made to work. Firebase gets notes via
  `releaseInfo.releaseNotesFile`; GitHub already supplies notes (as HTML) and
  needs only normalization. The provider choice (section 6) stays a one-line
  knob and no longer decides whether users see notes.
- **Notes travel as Markdown, render through the existing renderer.** The
  dependency-free `Markdown` component in `src/renderer/components/Backlog/`
  already does headings, lists, links (via `open-external`), code and
  emphasis, and never emits raw HTML. It moves to `Shared/` and the Updates
  tab uses it. No `dangerouslySetInnerHTML`, no sanitizer dependency.
- **Main normalizes, renderer only renders.** Whatever shape electron-updater
  hands over (Markdown string, HTML string from GitHub's atom feed, or the
  `{version, note}[]` array from `fullChangelog`), the main process turns it
  into one Markdown string with `## x.y.z` section headers and drops sections
  for versions the user already has. The renderer never sees provider
  differences.
- **Post-install card reads the bundled changelog, not the network.**
  `CHANGELOG.md` ships inside the asar. On first launch of a new version the
  main process slices the sections in `(previousVersion, currentVersion]`
  and exposes them in `UpdaterState`. Works offline, identical on every
  feed, and covers the macOS manual-install path where electron-updater
  never ran the install.
- **Surface the post-install card by opening Settings on the Updates tab,
  once.** On Windows/Linux the user just clicked "Restart & install", so a
  window appearing on relaunch is expected. On macOS they just dragged the
  new DMG in and launched it, same expectation. The Updates tab badge also
  lights while the card is undismissed (same `badge` slot the pending-update
  dot uses). The card dismisses with "Got it", which persists the version.
  No system notification, no bubble toast, no separate window.
- **Fresh installs show nothing.** `lastRunVersion === null` means first run
  of a build with this feature. We stamp the version and stay quiet; the
  first-run tour owns that moment.
- **Release gate.** CI refuses to publish a tag whose version has no
  `CHANGELOG.md` section, mirroring the existing `package.json` version
  mismatch guard. Cheap insurance against a release with an empty card.

## 1. Changelog file + extraction script

### 1a. `CHANGELOG.md` (new, repo root)
Keep-a-Changelog format. Seed it with sections for the current `1.3.9` and
the last few shipped versions (summarize from git tags; brief is fine). An
`## [Unreleased]` section at the top is allowed and ignored by the tooling.

### 1b. `scripts/release-notes.mjs` (new)
Pure functions plus a CLI, so the parser is unit-testable and shared by the
build and the workflow:

```
parseChangelog(md) -> Array<{ version, date, body }>   // ordered newest first
sectionsFor(entries, { from?, to })                     // (from, to] by semver
renderSections(entries) -> markdown with "## x.y.z" headers
```

CLI modes:
- `node scripts/release-notes.mjs feed --version 1.4.0 --count 5` writes
  `build/release-notes.md`: the target version's section plus up to four
  prior versions, each under its own `## x.y.z` header. Multiple sections so
  a user three versions behind sees everything they missed (the manager
  trims the ones they already have; see 2a).
- `node scripts/release-notes.mjs github --version 1.4.0` writes
  `build/github-release-body.md`: only that version's section, for the
  GitHub Release body.
- `node scripts/release-notes.mjs check --version 1.4.0` exits non-zero if
  no section exists. Used by CI.

`build/` is electron-builder's default `buildResources` directory and is
already git-ignored (verify; add if not).

### 1c. Wire into the build
- `package.json`: `"prebuild:notes": "node scripts/release-notes.mjs feed --version $npm_package_version"` is not portable on Windows `cmd`; instead have the script read `package.json` itself when `--version` is omitted, and call it from each `dist:*` script: `npm run build && node scripts/release-notes.mjs feed && electron-builder …`.
- `electron-builder.config.cjs`: add
  ```js
  releaseInfo: { releaseNotesFile: 'build/release-notes.md' },
  ```
  and add `'CHANGELOG.md'` to `files` so the bundled copy exists for section 3.
  electron-builder reads the file (verified in
  `app-builder-lib/out/publish/updateInfoBuilder.js`) and writes it as
  `releaseNotes` in `latest*.yml`, which the generic provider passes through
  to `update-available`.

## 2. Main process: normalize notes from the feed

### 2a. `src/main/updater/release-notes.ts` (new)
```ts
export function normalizeReleaseNotes(
  raw: unknown,               // UpdateInfo.releaseNotes
  currentVersion: string,
): string | null
```
- `string` that looks like HTML (`/<\/?[a-z][^>]*>/i`): convert with a small
  tag-to-Markdown pass. Rules: `h1..h6` → `#`-prefixed line, `li` → `- `,
  `a[href]` → `[text](href)`, `code` → backticks, `strong|b` → `**`,
  `em|i` → `_`, `p|br|div|ul|ol` → line breaks, everything else stripped,
  entities `&amp; &lt; &gt; &quot; &#39; &nbsp;` decoded. This is what the
  GitHub provider's atom `content` looks like. Good enough for release
  bodies; not a general HTML converter.
- `string` that is already Markdown (Firebase path): pass through.
- `Array<{version, note}>` (GitHub `fullChangelog`): each note goes through
  the same HTML pass, then sections are rendered as `## version` + body.
- Finally split on `## x.y.z` headers (if any) and drop sections whose
  version is `<= currentVersion`. A string without version headers is kept
  whole. Empty result → `null`.
- Version compare: a 10-line `compareVersions(a, b)` in
  `src/common/version.ts` (numeric dotted compare, prerelease tail sorts
  lower). Shared with section 3 and the renderer; no `semver` dependency
  from app code.

### 2b. `src/main/updater/manager.ts`
- `toUpdateInfoLite` loses its inline notes handling and calls
  `normalizeReleaseNotes(info.releaseNotes, app.getVersion())`.
- `releaseNotesFormat` is not needed; the renderer always gets Markdown.

## 3. Main process: post-install "what's new"

### 3a. `src/main/user-config.ts`
```ts
export interface UpdaterConfig {
  autoCheck: boolean;
  lastCheckedAt: number | null;
  lastRunVersion: string | null;   // app.getVersion() the last time the card was dismissed (or first stamped)
}
```
Default `null`. Config migration: existing users have no key; `null` is the
"fresh" state, so the first launch after this ships stamps silently (see
decisions). That means the *first* release containing this feature shows no
card; the one after does. Acceptable, and the alternative (showing the card
for a version whose notes the user never asked about) is noisier.

### 3b. `src/common/updater-types.ts`
```ts
export interface WhatsNew {
  fromVersion: string;
  toVersion: string;
  notes: string;          // markdown, sections in (from, to]
}
export interface UpdaterState {
  …
  whatsNew: WhatsNew | null;   // non-null until dismissed
}
export function hasUpdatesAttention(state): boolean   // hasPendingUpdate(status) || whatsNew != null
```
`hasPendingUpdate` is unchanged (the tray dot still means "a new version
exists", not "you just updated").

### 3c. `src/main/updater/manager.ts`
- New dep: `readBundledChangelog: () => string | null` (default reads
  `path.join(app.getAppPath(), 'CHANGELOG.md')`, injectable for tests).
- In `init()`, after the dev/disabled gates (also run this in dev when
  `ENABLE_UPDATER` is on and a `AGENT_PULSE_FAKE_PREV_VERSION` env var is
  set, so the card can be exercised without a packaged build):
  ```
  prev = cfg.lastRunVersion; cur = app.getVersion()
  if prev == null            -> persist lastRunVersion = cur; whatsNew = null
  else if compare(prev, cur) >= 0 -> whatsNew = null   (same, or downgrade)
  else                       -> whatsNew = { prev, cur, notes: sectionsFor(changelog, prev, cur) or a one-line fallback }
  ```
  `sectionsFor` here reuses `scripts/release-notes.mjs`'s parser. To avoid
  main importing from `scripts/`, the parser lives in
  `src/common/changelog.ts` and the script imports *that* (it is plain TS
  compiled by the main build; the script runs with `tsx`-free Node, so keep
  `src/common/changelog.ts` dependency-free and have the script import the
  compiled `dist/common/changelog.js`, or simply duplicate the ~40-line
  parser in the script with a test asserting both agree on a fixture).
  Recommendation: compiled-dist import; `npm run build` already precedes
  `dist:*`.
- New public method `dismissWhatsNew()`: sets `whatsNew = null`, persists
  `lastRunVersion = cur`, broadcasts.
- `getState()` includes `whatsNew`.

### 3d. `src/main/updater/index.ts`
- `ipcMain.handle('updates:dismiss-whats-new', …)`; add to the
  `removeHandler` list.
- `bootUpdater` returns `hasWhatsNew(): boolean` on the handle.

### 3e. `src/main/index.ts`
After `bootUpdater`, if `this.updater.hasWhatsNew()` call
`this.settingsWindow.show()`. The renderer picks the tab itself (4b). Do
this after the tour gate: if `!userConfig.tour.hasSeenTour` skip the
auto-show (a fresh install can't have `whatsNew` anyway, but belt and
braces).

## 4. Renderer

### 4a. Move `Markdown` to Shared
- `git mv src/renderer/components/Backlog/Markdown.tsx src/renderer/components/Shared/Markdown.tsx`,
  same for its test. Export from the barrel. Leave
  `Backlog/Markdown.tsx` as a one-line re-export for a release, then delete.
- Add `Markdown` to `Shared/README.md` and to the CLAUDE.md component list.

### 4b. `SettingsPanel.tsx`
- Tab badge: `badge: t.id === 'updates' && hasUpdatesAttention(updaterState)`.
- Initial tab: on mount, once `updaterState` resolves, if
  `updaterState.whatsNew` is non-null and the user has not yet interacted
  (a `useRef` guard set on the first `setActiveTab` call), `setActiveTab('updates')`.
  No new IPC for navigation; the state already carries the intent.

### 4c. `UpdatesTab.tsx`
- **What's new card** (new, rendered first when `state.whatsNew`):
  eyebrow "What's new", title `Updated to {toVersion}`, subtitle
  `from {fromVersion}`, `<Markdown content={notes} />` in the existing
  scrollable glass box, footer `Button` "Got it" → `updates:dismiss-whats-new`
  and a text link "Full changelog" → `open-external` to the release page for
  `toVersion`. Uses the shared `Card`-style shell already in the file.
- **Pending-update card**: replace the `<pre>` with `<Markdown>`; label the
  box "What's new in {version}". Nothing else changes.
- Both cards use `.apple-scroll` and `max-h-48` as today.

## 5. CI / release workflow

`.github/workflows/release.yml`:
- New step after the version-mismatch check (same `if`):
  `node scripts/release-notes.mjs check` → fails the job with
  `::error::CHANGELOG.md has no section for <version>`.
- The `feed` mode runs inside `npm run dist:*`, nothing to add.
- New step before the GitHub publish: `node scripts/release-notes.mjs github`.
- `softprops/action-gh-release`: add `body_path: build/github-release-body.md`
  and keep `generate_release_notes: true` (softprops appends the generated
  list below the body, giving hand-written notes on top and the PR list as
  an appendix). `append_body: true` is not needed; the release is created
  fresh per tag. Matrix jobs race to create the same release; softprops
  handles "already exists" by updating, which it does today.

`docs/RELEASING.md`: new "Writing the changelog" subsection (format, the
gate, what the user sees where), and update the "GitHub Releases are for
changelog visibility" line to say the body now comes from `CHANGELOG.md`.

## 6. Provider switch (decision for Dipen, independent of 1–5)

Everything above works on Firebase. Switching the feed to GitHub Releases is
a one-line flip (`UPDATE_PROVIDER = 'github'` in `electron-builder.config.cjs`
plus the matching `env` in `release.yml`) and buys nothing for release notes
once section 1 ships, while costing:
- unauthenticated GitHub API rate limits per NAT (the 30–120 s launch jitter
  and 6 h cadence were designed for this, so it is tolerable, not free);
- the manifest must be attached to the Release; the matrix already does
  that (`release/latest*.yml` in `artifact_path`), so no workflow change;
- comments in three files and RELEASING.md currently say GitHub is fallback
  only and would need rewording.

Recommendation: keep Firebase as the feed, ship sections 1–5, and leave the
GitHub provider as the documented fallback it is today. If the switch is
wanted anyway, section 2a already handles the HTML notes shape, and setting
`autoUpdater.fullChangelog = true` in `init()` gives multi-version notes on
that feed too.

## 7. Tests (Vitest, no GUI)

- `src/common/__tests__/version.test.ts`: `compareVersions` ordering incl.
  prerelease tails and unequal lengths.
- `src/common/__tests__/changelog.test.ts`: parse a fixture with
  `[Unreleased]`, three versions, mixed `### ` subsections; `sectionsFor`
  half-open range; empty range → `[]`.
- `src/main/updater/__tests__/release-notes.test.ts`: Markdown passthrough;
  GitHub HTML sample (h2 + ul/li + a + entities) → expected Markdown;
  `fullChangelog` array → sectioned Markdown; sections `<= current` dropped;
  `No content.`/empty → `null`.
- `src/main/updater/__tests__/manager.whatsNew.test.ts`: fresh install
  stamps and stays null; upgrade sets `whatsNew` with the right range and
  persists nothing until `dismissWhatsNew`; same version → null; downgrade →
  null; missing bundled changelog → one-line fallback, not a crash; dev mode
  without the env override → null.
- `src/renderer/components/Settings/__tests__/UpdatesTab.test.tsx`: new
  cases for the What's new card (renders Markdown headings/lists, Got it
  invokes the IPC, Full changelog opens the tag URL) and for the pending
  card rendering `<Markdown>` rather than `<pre>`.
- `scripts/__tests__/release-notes.test.mjs` (or in the vitest tree):
  `check` exits non-zero on a missing version; `feed` emits N sections.
- `npm run lint:ui` must stay clean (the new card reuses existing shells).

## 8. Rollout

1. Land sections 1, 2, 4a, 4c (pending-card notes) and 5 first. From the
   next tag, `latest.yml` carries notes and the Updates tab shows them for
   anyone still on an older build *before* they download.
2. Land 3, 4b and the rest of 4c in the same or the following release. The
   post-install card first appears on the release *after* the one that
   ships it (see 3a).
3. Verify on Windows by installing the previous tagged build, letting the
   launch check find the new one, confirming the notes render, installing,
   and confirming the card on relaunch with the Updates tab selected. Record
   mac manual-install behaviour the same way when a mac is at hand.

## 9. Out of scope / later

- A "don't show after updates" toggle. Add to the Updates tab if the card
  feels nagging.
- Rendering GitHub's auto-generated PR appendix inside the app. The in-app
  text is the hand-written section only.
- Localised notes.
- Signed macOS build / real mac auto-install (tracked in
  `mac-update-detection-plan.md`).

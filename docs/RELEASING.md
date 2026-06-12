# Releasing Agent Pulse

Maintainer documentation for cutting releases and operating the auto-update feed. Contributors don't need anything here — see [CONTRIBUTING.md](../CONTRIBUTING.md) instead.

## How updates are served

- **Engine**: `electron-updater` runs inside the main process (`src/main/updater/manager.ts`). The renderer's *Settings → Updates* tab is purely a view onto that state, broadcast via IPC.
- **Feed**: Each installer is permanently tied to one update feed, baked into `app-update.yml` at build time. The default — and what production ships — is **Firebase Storage** (a GCS-backed bucket). The `electron-builder.config.cjs` `publish` block points at `https://storage.googleapis.com/bitsy-cc3f6.firebasestorage.app/agent-pulse/releases/`. Flipping `UPDATE_PROVIDER` to `'github'` is supported for emergency fallback but isn't the default.
- **GitHub Releases** are published in parallel for changelog visibility — auto-update *does not* read from GitHub; the Firebase feed is canonical.

## Cutting a release

The CI workflow (`.github/workflows/release.yml`) handles building, packaging, and uploading. You just bump and tag.

1. **Bump `package.json`** to the new version (e.g. `1.1.8`) and commit it on `main`.
2. **Tag and push** — this is the trigger:
   ```bash
   git tag v1.1.8
   git push origin v1.1.8
   ```
   Alternatively, use **Actions → Build Distribution → Run workflow** and type the version. The workflow refuses to run if the typed version doesn't match `package.json` — cheap insurance against typos.
3. **The workflow then** (matrix: `windows-latest`, `macos-latest`, `ubuntu-latest`):
   - Installs deps with `npm ci`, runs `npm test`.
   - Builds installers via `npm run dist:win` / `dist:mac` / `dist:linux`.
   - Authenticates to GCP using the `GCP_SA_KEY` service-account credential.
   - **Uploads installers first**, then `latest.yml` / `latest-mac.yml` last with `Cache-Control: no-cache`. Ordering matters: if clients see `latest.yml` before the binary lands, they'll 404 on download. The no-cache header bypasses the default 1 h GCS edge cache so users see the new release immediately.
   - Publishes a GitHub Release with the same artifacts for changelog visibility.
4. **What landing in Firebase looks like**: under `gs://bitsy-cc3f6.firebasestorage.app/agent-pulse/releases/` you'll see `Agent-Pulse-Setup-<version>.exe`, its `.blockmap`, `Agent-Pulse-<version>.dmg` (arm64 + x64), and the manifest files. Installed clients poll `latest.yml` from there.

Pushes to `main` (without a tag) build the same installers and attach them as workflow artifacts for smoke-testing, but never touch the update feed or publish a release.

## Required secrets / setup (one-time)

- **`GCP_SA_KEY`** — repo secret. JSON key for a GCP service account with `roles/storage.objectAdmin` on the `bitsy-cc3f6.firebasestorage.app` bucket (or at least on the `agent-pulse/releases/` prefix).
- **Bucket read access** — the `agent-pulse/releases/` prefix must grant `roles/storage.objectViewer` to `allUsers` so `electron-updater` can fetch `latest.yml` and binaries without auth. Without this, installed clients silently fail every check.
- **`GITHUB_TOKEN`** — provided automatically by GitHub Actions for the parallel GitHub Release publish.

## Update behavior reference

- **Check cadence**: one jittered check **30–120 s after launch** (so a corporate-NAT fleet doesn't stampede the feed), then every **6 hours** while the app stays open. The "Check now" button is throttled to once per 10 min.
- **User control**: downloads are *never* automatic — the user clicks **Download**, then **Restart & install**. Auto-install-on-quit is disabled because the tray keeps the app alive past window-close.
- **Platforms**: Windows (NSIS) auto-updates end-to-end. macOS surfaces an `unsupported` status with a manual-install banner — code signing + notarization aren't wired yet. Dev / unpackaged runs report `disabled` instead of silently failing.
- **Soft failures**: `403` / `429` responses are treated as soft failures (no user-visible error); the next periodic check retries.

## Verifying / debugging an update

- Local check: install a stale build, launch it, watch the `[UpdaterManager]` and `[electron-updater]` lines in the main-process log. The launch check fires 30–120 s in.
- Force a check from the UI: *Settings → Updates → Check now* (respects the 10-min throttle).
- Confirm what feed a given build is using: open `<install-dir>/resources/app-update.yml` — it shows the baked-in provider URL.

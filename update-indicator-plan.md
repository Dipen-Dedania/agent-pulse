# Update indicator: tray dot + Updates tab badge

Status: implemented 2026-10-01 (verified on Windows via tests; macOS / Linux
runtime not exercised). Dotted icons generated once with a Pillow script
(not committed). Follow-up the same day: `mac-update-detection-plan.md`
made macOS check-only so the dot actually lights there, and removed the
dock badge (dead on an LSUIElement app).

Today the updater (`src/main/updater/manager.ts`) checks on launch and every
6 h, then broadcasts `updates:state` to every window. The only listener is
`UpdatesTab.tsx`, which is mounted only while that tab is open, so an update
found while the user is on Hooks (or has Settings closed) is invisible until
they happen to click Updates. The tray icon never changes.

Goal: when a new version is `available` or `downloaded`, show a dot on the
tray icon and a dot on the Updates tab, on Windows, macOS and Linux, with no
new npm dependencies.

## 0. Decisions

- **One source of truth.** The main process already owns updater status.
  Both indicators derive from `UpdaterState.status`, never from a second
  flag. `hasPendingUpdate(status) = status === 'available' || status === 'downloaded'`
  lives in `src/common/updater-types.ts` so main and renderer agree.
- **Tray dot is an image swap, not a badge API.** Electron has no
  `tray.setBadge()`. We ship a second PNG with a pre-rendered dot and call
  `tray.setImage()`. Pre-rendered beats runtime compositing: no canvas in
  main, no pixel maths, identical on every platform.
- **Not a template image.** The current tray icon is the full-colour favicon,
  not a macOS template image, so a red dot renders as red on all three
  platforms. If the icon is ever converted to a template on mac, the dotted
  variant must be re-authored as an alpha mask (dot becomes a hole or a
  solid shape). Out of scope now; note it in the tray file comment.
- **macOS extra: dock badge.** `app.dock.setBadge('1')` is a one-liner that is
  only applied on darwin and cleared with `setBadge('')`. Included because it
  is free and is the native mac convention; guarded so it never throws
  elsewhere.
- **Tab badge is a generic `badge` slot on the shared `Tabs`.** Not an
  Updates-only prop. `TabItem.badge?: boolean | number`. `true` renders a
  6 px dot, a number renders a count pill. Rendered with the shared
  `Badge` primitive where a pill is needed, so `lint:ui` stays clean.
- **Dot stays until resolved.** Opening the Updates tab does not clear the
  dot. It clears only when status leaves `available` / `downloaded`
  (install, or a later check that finds nothing). Rationale: the user asked
  to "directly see there's a new version they can download"; a dot that
  vanishes on first glance defeats that. Reconsider if it feels nagging.
- **No system notification.** Out of scope. Cheap to add later from the
  same hook in `index.ts`.

## 1. Assets

Add `public/assets/favicon/favicon-32x32-update.png` and
`favicon-16x16-update.png`: the existing icons with a filled circle in the
top-right corner (red `#ef4444`, 1 px white ring for contrast on dark and
light trays). Diameter 10 px on the 32 px image, 5 px on the 16 px image.
Generated once with a short Node script using `sharp` if present in
`node_modules`, otherwise with a throwaway Python/Pillow script in the
scratchpad. Script is not committed; the PNGs are.

`public/` is already `asarUnpack`ed (`electron-builder.config.cjs:51`), so
the path resolution in `getTrayIconPath()` works unchanged for the new file.

## 2. Main process

### 2a. `src/common/updater-types.ts`
```ts
export function hasPendingUpdate(status: UpdaterStatus): boolean {
  return status === 'available' || status === 'downloaded';
}
```

### 2b. `src/main/windows/tray.ts`
- Split `getTrayIconPath()` into `getTrayIconPath(variant: 'normal' | 'update')`.
- Load both images once in `init()`; keep them as fields. Log a warning if
  the update variant is empty and fall back to the normal image (never a
  blank tray).
- New method:
  ```ts
  public setUpdatePending(pending: boolean, version?: string | null)
  ```
  - `tray.setImage(pending ? updateImage : normalImage)`
  - `tray.setToolTip(pending ? `Agent Pulse — update ${version ?? ''} available` : 'Agent Pulse')`
  - On darwin only: `app.dock?.setBadge(pending ? '1' : '')`, wrapped in
    try/catch (dock is undefined when the app is LSUIElement / agent-only).
  - Idempotent: track `private updatePending = false` and return early if
    unchanged, so the 6 h periodic broadcast does not re-set the image.
- Optionally rename the first menu item to `Download update…` while pending.
  Cheap: rebuild the menu in `setUpdatePending`. Included.

### 2c. `src/main/updater/manager.ts` + `index.ts`
- Add `onStateChange?: (state: UpdaterState) => void` to `UpdaterDeps` and
  call it from `broadcast()` after the window loop.
- `bootUpdater()` accepts and forwards it.
- In `src/main/index.ts`, pass
  `onStateChange: (s) => this.trayManager.setUpdatePending(hasPendingUpdate(s.status), s.info?.version)`.
  `trayManager` is constructed before `bootUpdater` (line 175 vs 370) so the
  reference exists; `setUpdatePending` must tolerate being called before
  `init()` (store the flag, apply it in `init()`).

## 3. Renderer

### 3a. `src/renderer/components/Shared/Tabs.tsx`
- `TabItem.badge?: boolean | number`.
- Render after the label inside the existing `inline-flex` span:
  - `true`: `<span aria-hidden className='w-1.5 h-1.5 rounded-full bg-red-500 shrink-0' />`
    plus a visually hidden "(has updates)" text for screen readers.
  - number: `<Badge tone='danger' variant='pill' size='xs'>{n}</Badge>`.
- README row for `Tabs` updated.

### 3b. `src/renderer/components/Settings/SettingsPanel.tsx`
- New hook `useUpdaterState()` in `src/renderer/hooks/useUpdaterState.ts`:
  `invoke('updates:get-state')` on mount, subscribe to `updates:state`,
  unsubscribe on unmount. Lifted out of `UpdatesTab.tsx`, which switches to
  the hook (removes its duplicated effect).
- `SettingsPanel` calls the hook and maps
  `badge: t.id === 'updates' && hasPendingUpdate(state.status)` into the
  `Tabs` items.

## 4. Tests

- `src/renderer/components/Shared/__tests__/Tabs.test.tsx` (new): renders
  icon, renders dot when `badge: true`, renders count when numeric, `fill`
  applies `flex-1`.
- `src/main/__tests__/tray.test.ts` (new): mock `electron` (`Tray`,
  `nativeImage`, `app`), assert `setImage` / `setToolTip` called with the
  update variant on `setUpdatePending(true)`, idempotent on repeat, dock
  badge only when `process.platform === 'darwin'`, flag applied when set
  before `init()`.
- `src/main/__tests__/updater-manager.test.ts` (new, small): `onStateChange`
  fires on `setStatus`.
- `hasPendingUpdate` unit test alongside.

## 5. Verification

- `npm test` (includes `lint:ui`), `tsc --noEmit`.
- Manual on Windows: run packaged build or temporarily force
  `status = 'available'` via a dev-only IPC; confirm tray dot, tooltip,
  menu label, tab dot; confirm all clear after "Up to date".
- macOS and Linux cannot be exercised here. Asset and API paths are
  platform-neutral; the darwin dock call is guarded. Flag for a quick check
  on a mac when one is available.

## 6. Out of scope

- System notification on update-available.
- Template-image (monochrome) tray icon for macOS.
- Clearing the dot on tab visit.

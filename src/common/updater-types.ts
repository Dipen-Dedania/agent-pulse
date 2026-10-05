// Shared types between the main process UpdaterManager and the renderer
// Updates tab. Mirrors the subset of electron-updater's UpdateInfo and
// ProgressInfo we actually surface — keeps the renderer free of any direct
// dependency on electron-updater.

export type UpdaterStatus =
  | 'idle'
  | 'disabled'     // feature flag off / dev mode
  | 'checking'
  | 'available'    // update found, not yet downloaded
  | 'not-available'
  | 'downloading'
  | 'downloaded'   // ready to install on next restart
  | 'error';

export interface UpdateInfoLite {
  version: string;
  releaseDate?: string;
  releaseName?: string | null;
  releaseNotes?: string | null;
  // Human-facing page for this version (GitHub Release). Platforms that
  // cannot self-install (macOS without a signed build) send users here.
  downloadPageUrl: string | null;
}

export interface UpdateProgressLite {
  percent: number;        // 0..100
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

/**
 * Set once, on the first launch after an update lands, until the user
 * dismisses the "What's new" card. `notes` is Markdown sliced from the
 * bundled CHANGELOG.md for every version in (fromVersion, toVersion].
 */
export interface WhatsNew {
  fromVersion: string;
  toVersion: string;
  notes: string;
}

export interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  info: UpdateInfoLite | null;
  progress: UpdateProgressLite | null;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  autoCheck: boolean;
  // False where electron-updater can detect but not apply updates (macOS
  // without a Developer ID signed build). Checks still run; download and
  // install are gated and the UI offers the download page instead.
  installSupported: boolean;
  // Surfaced so the renderer can render the macOS "manual install" banner
  // without re-detecting the platform itself.
  platform: NodeJS.Platform;
  // Non-null from the first launch of a new version until "Got it" is
  // clicked on the Updates tab. Null on fresh installs and in dev mode.
  whatsNew: WhatsNew | null;
}

/**
 * True when there is a new version the user can act on (download or
 * install). Both the tray dot and the Updates-tab badge derive from this so
 * main and renderer never disagree about what "pending" means.
 */
export function hasPendingUpdate(status: UpdaterStatus): boolean {
  return status === 'available' || status === 'downloaded';
}

/**
 * True when the Updates tab deserves the attention dot: a new version is
 * pending, or the user hasn't yet read what the version they just got
 * changed. The tray dot keeps using hasPendingUpdate alone — it means "a
 * newer version exists", not "you have unread notes".
 */
export function hasUpdatesAttention(state: Pick<UpdaterState, 'status' | 'whatsNew'>): boolean {
  return hasPendingUpdate(state.status) || state.whatsNew !== null;
}

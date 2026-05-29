// Shared types between the main process UpdaterManager and the renderer
// Updates tab. Mirrors the subset of electron-updater's UpdateInfo and
// ProgressInfo we actually surface — keeps the renderer free of any direct
// dependency on electron-updater.

export type UpdaterStatus =
  | 'idle'
  | 'unsupported'   // packaged platform we don't auto-update (e.g. macOS without signing)
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
}

export interface UpdateProgressLite {
  percent: number;        // 0..100
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

export interface UpdaterState {
  status: UpdaterStatus;
  currentVersion: string;
  info: UpdateInfoLite | null;
  progress: UpdateProgressLite | null;
  errorMessage: string | null;
  lastCheckedAt: number | null;
  autoCheck: boolean;
  // Surfaced so the renderer can render the macOS "manual install" banner
  // without re-detecting the platform itself.
  platform: NodeJS.Platform;
}

import { app, BrowserWindow } from 'electron';
import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater';
import { logger } from '../../common/logger';
import {
  UpdaterState,
  UpdaterStatus,
  UpdateInfoLite,
  UpdateProgressLite,
} from '../../common/updater-types';
import { UserConfig, UpdaterConfig } from '../user-config';

// On-launch check fires after a random delay in this window so a fleet of
// users behind one corporate NAT don't all hit the GitHub API simultaneously
// and trip the 60/hr/IP unauthenticated limit.
const LAUNCH_DELAY_MIN_MS = 30 * 1000;
const LAUNCH_DELAY_MAX_MS = 120 * 1000;

// Background re-check cadence. Six hours keeps us well under any
// per-IP ceiling and is plenty for an end-user desktop app.
const PERIODIC_CHECK_MS = 6 * 60 * 60 * 1000;

// Manual button throttle. Without this a frustrated user can spam
// "Check now" and chew through 60 unauthenticated requests in a minute.
const MANUAL_CHECK_THROTTLE_MS = 10 * 60 * 1000;

interface UpdaterDeps {
  getUserConfig: () => UserConfig;
  // Called whenever lastCheckedAt or autoCheck change so the on-disk config
  // stays consistent without us reaching back into AgentPulseApp.
  persistUpdaterConfig: (next: UpdaterConfig) => void;
  // Feature-flag gate. When false, the manager still answers IPC with a
  // 'disabled' state but never touches autoUpdater or starts timers.
  enabled: boolean;
}

export class UpdaterManager {
  private status: UpdaterStatus = 'idle';
  private info: UpdateInfoLite | null = null;
  private progress: UpdateProgressLite | null = null;
  private errorMessage: string | null = null;
  private launchTimer: NodeJS.Timeout | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;
  private lastManualCheckAt = 0;
  private inFlightCheck = false;
  private inFlightDownload = false;

  constructor(private deps: UpdaterDeps) {}

  // ── lifecycle ────────────────────────────────────────────────────────────
  public init(): void {
    if (!this.deps.enabled) {
      this.status = 'disabled';
      logger.info('[UpdaterManager] feature flag off — auto-update disabled');
      return;
    }

    // electron-updater is hard-coded to refuse running inside an unpackaged
    // app. Detect that early and surface a clean status so the UI doesn't
    // sit at "checking" forever during local dev.
    if (!app.isPackaged) {
      this.status = 'disabled';
      logger.info('[UpdaterManager] dev mode — auto-update disabled');
      return;
    }

    // macOS auto-update requires a signed + notarized build; until that's
    // wired up, surface a distinct status so the renderer shows a manual-
    // install banner instead of "checking" / spurious errors.
    if (process.platform === 'darwin') {
      this.status = 'unsupported';
      logger.info('[UpdaterManager] macOS — auto-update deferred (signing not wired)');
      return;
    }

    autoUpdater.logger = {
      info:  (...a: unknown[]) => logger.info('[electron-updater]', ...a),
      warn:  (...a: unknown[]) => logger.warn('[electron-updater]', ...a),
      error: (...a: unknown[]) => logger.error('[electron-updater]', ...a),
      debug: (...a: unknown[]) => logger.debug('[electron-updater]', ...a),
    } as typeof autoUpdater.logger;

    // We control download timing from the UI; auto-download would surprise
    // users on metered connections. autoInstallOnAppQuit is also off — the
    // tray keeps the app alive across window close, so quitting silently
    // applying an update isn't a clean UX either.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    this.bindUpdaterEvents();

    if (this.deps.getUserConfig().updates.autoCheck) {
      this.scheduleLaunchCheck();
      this.schedulePeriodicCheck();
    }
  }

  public shutdown(): void {
    if (this.launchTimer) clearTimeout(this.launchTimer);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    this.launchTimer = null;
    this.periodicTimer = null;
  }

  // ── public API (driven by IPC) ───────────────────────────────────────────
  public getState(): UpdaterState {
    return {
      status: this.status,
      currentVersion: app.getVersion(),
      info: this.info,
      progress: this.progress,
      errorMessage: this.errorMessage,
      lastCheckedAt: this.deps.getUserConfig().updates.lastCheckedAt,
      autoCheck: this.deps.getUserConfig().updates.autoCheck,
      platform: process.platform,
    };
  }

  // force=true bypasses the throttle (used by the on-launch check).
  public async checkNow(opts: { force?: boolean } = {}): Promise<void> {
    if (this.status === 'disabled' || this.status === 'unsupported') {
      logger.debug('[UpdaterManager] checkNow ignored: status =', this.status);
      return;
    }
    if (this.inFlightCheck) {
      logger.debug('[UpdaterManager] checkNow ignored: already checking');
      return;
    }
    const now = Date.now();
    if (!opts.force && now - this.lastManualCheckAt < MANUAL_CHECK_THROTTLE_MS) {
      logger.debug('[UpdaterManager] checkNow throttled');
      return;
    }
    this.lastManualCheckAt = now;
    this.inFlightCheck = true;
    this.setStatus('checking');
    try {
      // Don't await — results arrive via the autoUpdater event listeners.
      // We do catch here to handle the failure mode where the request never
      // dispatches at all (DNS failure, etc.).
      autoUpdater.checkForUpdates().catch((err) => this.onCheckError(err));
    } catch (err) {
      this.onCheckError(err);
    }
  }

  public async downloadUpdate(): Promise<void> {
    if (this.status !== 'available') {
      logger.debug('[UpdaterManager] downloadUpdate ignored: status =', this.status);
      return;
    }
    if (this.inFlightDownload) return;
    this.inFlightDownload = true;
    this.setStatus('downloading');
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      this.inFlightDownload = false;
      this.onCheckError(err);
    }
  }

  public quitAndInstall(): void {
    if (this.status !== 'downloaded') {
      logger.warn('[UpdaterManager] quitAndInstall ignored: status =', this.status);
      return;
    }
    // Mark the app as intentionally quitting so any window-all-closed
    // handlers know not to keep us alive on the tray.
    (app as unknown as { isQuitting: boolean }).isQuitting = true;
    // Per electron-updater docs: isSilent=false (show installer UI),
    // isForceRunAfter=true (relaunch after install).
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 250);
  }

  public setAutoCheck(enabled: boolean): void {
    const cfg = this.deps.getUserConfig().updates;
    if (cfg.autoCheck === enabled) return;
    const next: UpdaterConfig = { ...cfg, autoCheck: enabled };
    this.deps.persistUpdaterConfig(next);
    if (enabled) {
      this.scheduleLaunchCheck();
      this.schedulePeriodicCheck();
    } else {
      this.shutdown();
    }
    this.broadcast();
  }

  // ── internals ────────────────────────────────────────────────────────────
  private scheduleLaunchCheck() {
    if (this.launchTimer) return;
    const jitter =
      LAUNCH_DELAY_MIN_MS +
      Math.floor(Math.random() * (LAUNCH_DELAY_MAX_MS - LAUNCH_DELAY_MIN_MS));
    logger.info(`[UpdaterManager] launch check scheduled in ${Math.round(jitter / 1000)}s`);
    this.launchTimer = setTimeout(() => {
      this.launchTimer = null;
      this.checkNow({ force: true });
    }, jitter);
  }

  private schedulePeriodicCheck() {
    if (this.periodicTimer) return;
    this.periodicTimer = setInterval(() => {
      this.checkNow({ force: true });
    }, PERIODIC_CHECK_MS);
  }

  private bindUpdaterEvents() {
    autoUpdater.on('checking-for-update', () => {
      this.setStatus('checking');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.inFlightCheck = false;
      this.info = toUpdateInfoLite(info);
      this.errorMessage = null;
      this.recordChecked();
      this.setStatus('available');
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.inFlightCheck = false;
      this.info = toUpdateInfoLite(info);
      this.errorMessage = null;
      this.recordChecked();
      this.setStatus('not-available');
    });

    autoUpdater.on('download-progress', (p: ProgressInfo) => {
      this.progress = {
        percent: Math.round(p.percent ?? 0),
        bytesPerSecond: p.bytesPerSecond ?? 0,
        transferred: p.transferred ?? 0,
        total: p.total ?? 0,
      };
      this.setStatus('downloading');
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.inFlightDownload = false;
      this.info = toUpdateInfoLite(info);
      this.progress = null;
      this.setStatus('downloaded');
    });

    autoUpdater.on('error', (err: Error) => this.onCheckError(err));
  }

  private onCheckError(err: unknown) {
    this.inFlightCheck = false;
    this.inFlightDownload = false;
    const message = err instanceof Error ? err.message : String(err);
    // Treat rate-limit and forbidden responses as soft failures: don't
    // alarm the user; the next periodic check will retry. This is the
    // failure mode predicted for shared corporate NAT.
    const isSoft = /\b(403|429)\b/.test(message) || /rate limit/i.test(message);
    if (isSoft) {
      logger.warn('[UpdaterManager] soft check failure (rate-limited or forbidden):', message);
      this.errorMessage = null;
      this.setStatus('not-available');
      return;
    }
    logger.error('[UpdaterManager] update error:', message);
    this.errorMessage = message;
    this.setStatus('error');
  }

  private recordChecked() {
    const cfg = this.deps.getUserConfig().updates;
    const next: UpdaterConfig = { ...cfg, lastCheckedAt: Date.now() };
    this.deps.persistUpdaterConfig(next);
  }

  private setStatus(next: UpdaterStatus) {
    this.status = next;
    this.broadcast();
  }

  private broadcast() {
    const state = this.getState();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('updates:state', state);
    }
  }
}

function toUpdateInfoLite(info: UpdateInfo): UpdateInfoLite {
  // releaseNotes can be a string or an array of objects depending on provider;
  // normalize to a single string for the renderer.
  let notes: string | null = null;
  const raw = info.releaseNotes as unknown;
  if (typeof raw === 'string') {
    notes = raw;
  } else if (Array.isArray(raw)) {
    notes = raw
      .map((n) => (typeof n === 'string' ? n : (n as { note?: string })?.note ?? ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return {
    version: info.version,
    releaseDate: info.releaseDate,
    releaseName: info.releaseName ?? null,
    releaseNotes: notes,
  };
}

// Re-export from one place so consumers don't import from two modules.
export type { UpdaterState } from '../../common/updater-types';

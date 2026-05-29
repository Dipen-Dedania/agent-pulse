import { ipcMain } from 'electron';
import { logger } from '../../common/logger';
import { ENABLE_UPDATER } from '../feature-flags';
import { UserConfig, UpdaterConfig } from '../user-config';
import { UpdaterManager } from './manager';

interface BootOptions {
  // Callable so the manager always reads the current config snapshot rather
  // than a frozen copy captured at boot.
  getUserConfig: () => UserConfig;
  // The caller owns the in-memory UserConfig; we hand them back a mutated
  // version so they can update their own field and persist atomically.
  applyUpdaterConfig: (next: UpdaterConfig) => void;
}

export interface UpdaterHandle {
  checkNow: () => void;
  shutdown: () => void;
}

export function bootUpdater(opts: BootOptions): UpdaterHandle {
  // We always wire the manager + IPC so the renderer's Updates tab gets a
  // valid response no matter what. The manager short-circuits internally
  // (status: 'disabled') when the feature flag is off or we're in dev mode.
  const manager = new UpdaterManager({
    getUserConfig: opts.getUserConfig,
    persistUpdaterConfig: opts.applyUpdaterConfig,
    enabled: ENABLE_UPDATER,
  });
  manager.init();

  ipcMain.handle('updates:get-state', () => manager.getState());
  ipcMain.handle('updates:check-now', () => {
    manager.checkNow();
    return manager.getState();
  });
  ipcMain.handle('updates:download', async () => {
    await manager.downloadUpdate();
    return manager.getState();
  });
  ipcMain.handle('updates:quit-and-install', () => {
    manager.quitAndInstall();
    return true;
  });
  ipcMain.handle('updates:set-auto-check', (_e, enabled: boolean) => {
    manager.setAutoCheck(!!enabled);
    return manager.getState();
  });

  return {
    checkNow: () => manager.checkNow(),
    shutdown: () => {
      manager.shutdown();
      ipcMain.removeHandler('updates:get-state');
      ipcMain.removeHandler('updates:check-now');
      ipcMain.removeHandler('updates:download');
      ipcMain.removeHandler('updates:quit-and-install');
      ipcMain.removeHandler('updates:set-auto-check');
    },
  };
}

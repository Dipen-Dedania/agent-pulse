import { app, ipcMain, shell, BrowserWindow } from 'electron';
import { BubbleManager } from './windows/bubble-manager';
import { SettingsWindow } from './windows/settings-window';
import { TrayManager } from './windows/tray';
import { StatusStateManager } from './bridge/state-manager';
import { StatusBridgeServer } from './bridge/server';
import { ToolDetector } from './installer/detector';
import { ConfigWriter } from './installer/config-writer';
import { loadConfig, saveConfig, UserConfig, UsageConfig, CodexUsageConfig } from './user-config';
import { ToolId } from '../common/types';
import { logger } from '../common/logger';
import { installFileLogSink } from './file-log-sink';
import { UsagePoller } from './usage/poller';
import { CodexUsagePoller } from './codex-usage/poller';

// Windows uses this to group windows under our identity and show our taskbar icon.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.agentpulse.app');
}

class AgentPulseApp {
  private bubbleManager: BubbleManager;
  private settingsWindow: SettingsWindow;
  private trayManager: TrayManager;
  private stateManager: StatusStateManager;
  private bridgeServer: StatusBridgeServer;
  private detector: ToolDetector;
  private writer: ConfigWriter;
  private userConfig: UserConfig;
  private usagePoller: UsagePoller;
  private codexUsagePoller: CodexUsagePoller;

  constructor() {
    this.stateManager = new StatusStateManager();
    this.bridgeServer = new StatusBridgeServer(this.stateManager);
    this.bubbleManager = new BubbleManager();
    this.settingsWindow = new SettingsWindow();
    this.trayManager = new TrayManager();
    this.detector = new ToolDetector();
    this.writer = new ConfigWriter();
    this.userConfig = loadConfig();
    this.usagePoller = new UsagePoller(this.userConfig.usage);
    this.codexUsagePoller = new CodexUsagePoller(this.userConfig.codexUsage);
  }

  public init() {
    app.whenReady().then(() => installFileLogSink());
    this.bridgeServer.start();

    app.on('ready', () => {
      logger.info('[AgentPulseApp] app ready');
      this.setupIpc();
      this.bubbleManager.init();
      this.usagePoller.init();
      this.usagePoller.start();
      this.codexUsagePoller.init();
      this.codexUsagePoller.start();

      this.trayManager.init({
        onShowSettings: () => this.settingsWindow.show(),
        onQuit: () => {
          (app as unknown as { isQuitting: boolean }).isQuitting = true;
          app.quit();
        },
      });

      // Restore bubbles from last saved state
      const enabled = this.userConfig.enabledBubbles;
      logger.info('[AgentPulseApp] restoring enabled bubbles:', JSON.stringify(enabled));
      this.bubbleManager.syncEnabledBubbles(enabled);

      this.settingsWindow.show();
    });

    // Tray keeps the app alive — never auto-quit when windows close.
    // The only path to quit is the tray's "Quit Agent Pulse" menu item.
    app.on('window-all-closed', () => {
      logger.info(`[AgentPulseApp] window-all-closed platform=${process.platform} — staying alive (tray)`);
    });

    app.on('before-quit', () => {
      logger.info('[AgentPulseApp] before-quit');
      (app as unknown as { isQuitting: boolean }).isQuitting = true;
      this.usagePoller.stop();
      this.codexUsagePoller.stop();
      this.trayManager.destroy();
    });

    app.on('will-quit', () => {
      logger.info('[AgentPulseApp] will-quit');
    });
  }

  private setupIpc() {
    ipcMain.on('open-settings', () => {
      this.settingsWindow.show();
    });

    ipcMain.on('toggle-bubble', (_event, { toolId, enabled }: { toolId: ToolId; enabled: boolean }) => {
      logger.info(`[AgentPulseApp] toggle-bubble toolId=${toolId} enabled=${enabled}`);
      if (enabled) {
        this.bubbleManager.createBubble(toolId);
      } else {
        this.bubbleManager.destroyBubble(toolId);
      }
      // Persist the change
      this.userConfig.enabledBubbles[toolId] = enabled;
      saveConfig(this.userConfig);
    });

    // Settings panel calls this on load to get the real enabled state
    ipcMain.handle('get-config', () => {
      this.bubbleManager.syncEnabledBubbles(this.userConfig.enabledBubbles);
      return this.userConfig;
    });

    ipcMain.handle('get-bubble-states', () => {
      return this.bubbleManager.syncEnabledBubbles(this.userConfig.enabledBubbles);
    });

    ipcMain.handle('detect-tools', async () => {
      const detected = await this.detector.detectAll();
      for (const toolId of Object.keys(detected) as ToolId[]) {
        detected[toolId] = {
          ...detected[toolId],
          hookInstalled: this.writer.isHookInstalled(toolId),
        };
      }
      return detected;
    });

    ipcMain.handle('install-hook', async (_event, { toolId, projectPath }) => {
      return await this.writer.installHook(toolId, projectPath);
    });

    ipcMain.handle('uninstall-hook', async (_event, { toolId, projectPath }) => {
      return await this.writer.uninstallHook(toolId, projectPath);
    });

    ipcMain.handle('open-path', async (_event, filePath: string) => {
      await shell.openPath(filePath);
    });

    ipcMain.handle('usage:update-config', (_event, partial: Partial<UsageConfig>) => {
      this.userConfig.usage = { ...this.userConfig.usage, ...partial };
      saveConfig(this.userConfig);
      this.usagePoller.applyConfig(this.userConfig.usage);
      // Broadcast so bubble UIs (which never call get-config on their own)
      // can react to display-only flags like showSevenDayBar without a poll cycle.
      const updated = this.userConfig.usage;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('usage:config-updated', updated);
      }
      return updated;
    });

    ipcMain.handle('codex-usage:update-config', (_event, partial: Partial<CodexUsageConfig>) => {
      this.userConfig.codexUsage = { ...this.userConfig.codexUsage, ...partial };
      saveConfig(this.userConfig);
      this.codexUsagePoller.applyConfig(this.userConfig.codexUsage);
      const updated = this.userConfig.codexUsage;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('codex-usage:config-updated', updated);
      }
      return updated;
    });
  }
}

const pulseApp = new AgentPulseApp();
pulseApp.init();

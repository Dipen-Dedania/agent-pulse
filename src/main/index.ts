import { app, ipcMain, shell } from 'electron';
import { BubbleManager } from './windows/bubble-manager';
import { SettingsWindow } from './windows/settings-window';
import { StatusStateManager } from './bridge/state-manager';
import { StatusBridgeServer } from './bridge/server';
import { ToolDetector } from './installer/detector';
import { ConfigWriter } from './installer/config-writer';
import { loadConfig, saveConfig, UserConfig, UsageConfig } from './user-config';
import { ToolId } from '../common/types';
import { logger } from '../common/logger';
import { installFileLogSink } from './file-log-sink';
import { UsagePoller } from './usage/poller';

// Windows uses this to group windows under our identity and show our taskbar icon.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.agentpulse.app');
}

class AgentPulseApp {
  private bubbleManager: BubbleManager;
  private settingsWindow: SettingsWindow;
  private stateManager: StatusStateManager;
  private bridgeServer: StatusBridgeServer;
  private detector: ToolDetector;
  private writer: ConfigWriter;
  private userConfig: UserConfig;
  private usagePoller: UsagePoller;

  constructor() {
    this.stateManager = new StatusStateManager();
    this.bridgeServer = new StatusBridgeServer(this.stateManager);
    this.bubbleManager = new BubbleManager();
    this.settingsWindow = new SettingsWindow();
    this.detector = new ToolDetector();
    this.writer = new ConfigWriter();
    this.userConfig = loadConfig();
    this.usagePoller = new UsagePoller(this.userConfig.usage);
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

      // Restore bubbles from last saved state
      const enabled = this.userConfig.enabledBubbles;
      logger.info('[AgentPulseApp] restoring enabled bubbles:', JSON.stringify(enabled));
      this.bubbleManager.syncEnabledBubbles(enabled);

      this.settingsWindow.show();
    });

    app.on('window-all-closed', () => {
      logger.info(`[AgentPulseApp] window-all-closed platform=${process.platform}`);
      if (process.platform !== 'darwin') app.quit();
    });

    app.on('before-quit', () => {
      logger.info('[AgentPulseApp] before-quit');
      this.usagePoller.stop();
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
      return this.userConfig.usage;
    });
  }
}

const pulseApp = new AgentPulseApp();
pulseApp.init();

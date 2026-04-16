import { app, ipcMain } from 'electron';
import { BubbleManager } from './windows/bubble-manager';
import { SettingsWindow } from './windows/settings-window';
import { StatusStateManager } from './bridge/state-manager';
import { StatusBridgeServer } from './bridge/server';
import { ToolDetector } from './installer/detector';
import { ConfigWriter } from './installer/config-writer';
import { loadConfig, saveConfig, UserConfig } from './user-config';
import { ToolId } from '../common/types';

class AgentPulseApp {
  private bubbleManager: BubbleManager;
  private settingsWindow: SettingsWindow;
  private stateManager: StatusStateManager;
  private bridgeServer: StatusBridgeServer;
  private detector: ToolDetector;
  private writer: ConfigWriter;
  private userConfig: UserConfig;

  constructor() {
    this.stateManager = new StatusStateManager();
    this.bridgeServer = new StatusBridgeServer(this.stateManager);
    this.bubbleManager = new BubbleManager();
    this.settingsWindow = new SettingsWindow();
    this.detector = new ToolDetector();
    this.writer = new ConfigWriter();
    this.userConfig = loadConfig();
  }

  public init() {
    this.bridgeServer.start();

    app.on('ready', () => {
      this.setupIpc();
      this.bubbleManager.init();

      // Restore bubbles from last saved state
      const enabled = this.userConfig.enabledBubbles;
      (Object.keys(enabled) as ToolId[]).forEach(toolId => {
        if (enabled[toolId]) this.bubbleManager.createBubble(toolId);
      });

      this.settingsWindow.show();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }

  private setupIpc() {
    ipcMain.on('open-settings', () => {
      this.settingsWindow.show();
    });

    ipcMain.on('toggle-bubble', (_event, { toolId, enabled }: { toolId: ToolId; enabled: boolean }) => {
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
      return this.userConfig;
    });

    ipcMain.handle('detect-tools', async () => {
      return await this.detector.detectAll();
    });

    ipcMain.handle('install-hook', async (_event, { toolId, projectPath }) => {
      return await this.writer.installHook(toolId, projectPath);
    });

    ipcMain.handle('uninstall-hook', async (_event, { toolId, projectPath }) => {
      return await this.writer.uninstallHook(toolId, projectPath);
    });
  }
}

const pulseApp = new AgentPulseApp();
pulseApp.init();

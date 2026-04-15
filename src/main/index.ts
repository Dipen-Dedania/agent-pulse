import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { BubbleManager } from './windows/bubble-manager';
import { SettingsWindow } from './windows/settings-window';
import { StatusStateManager } from './bridge/state-manager';
import { StatusBridgeServer } from './bridge/server';
import { ToolDetector } from './installer/detector';
import { ConfigWriter } from './installer/config-writer';

class AgentPulseApp {
  private bubbleManager: BubbleManager;
  private settingsWindow: SettingsWindow;
  private stateManager: StatusStateManager;
  private bridgeServer: StatusBridgeServer;
  private detector: ToolDetector;
  private writer: ConfigWriter;

  constructor() {
    this.stateManager = new StatusStateManager();
    this.bridgeServer = new StatusBridgeServer(this.stateManager);
    this.bubbleManager = new BubbleManager();
    this.settingsWindow = new SettingsWindow();
    this.detector = new ToolDetector();
    this.writer = new ConfigWriter();
  }

  public init() {
    this.bridgeServer.start();

    app.on('ready', () => {
      this.setupIpc();
      this.bubbleManager.init();

      // Launch the settings window by default so the user has a starting point
      this.settingsWindow.show();

      // FOR DEMO PURPOSES: Spawn a few bubbles immediately so the user sees them
      this.bubbleManager.createBubble('claude-code');
      this.bubbleManager.createBubble('cursor');
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit();
    });
  }

  private setupIpc() {
    ipcMain.on('open-settings', () => {
      this.settingsWindow.show();
    });

    ipcMain.on('toggle-bubble', (event, { toolId, enabled }) => {
      if (enabled) {
        this.bubbleManager.createBubble(toolId);
      } else {
        this.bubbleManager.destroyBubble(toolId);
      }
    });

    ipcMain.handle('detect-tools', async () => {
      return await this.detector.detectAll();
    });

    ipcMain.handle('install-hook', async (event, { toolId, projectPath }) => {
      return await this.writer.installHook(toolId, projectPath);
    });

    ipcMain.handle('uninstall-hook', async (event, { toolId, projectPath }) => {
      return await this.writer.uninstallHook(toolId, projectPath);
    });
  }
}

const pulseApp = new AgentPulseApp();
pulseApp.init();

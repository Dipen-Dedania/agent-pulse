import { app, ipcMain, shell, BrowserWindow, Menu, dialog } from 'electron';
import { BubbleManager } from './windows/bubble-manager';
import { TooltipManager } from './windows/tooltip-window';
import { SettingsWindow } from './windows/settings-window';
import { TrayManager } from './windows/tray';
import { ENABLE_APP_MENU } from './feature-flags';
import { StatusStateManager } from './bridge/state-manager';
import { StatusBridgeServer } from './bridge/server';
import { ToolDetector } from './installer/detector';
import { ConfigWriter } from './installer/config-writer';
import { loadConfig, saveConfig, UserConfig, UsageConfig, CodexUsageConfig, AntigravityUsageConfig, AnalyticsConfig, SchedulerConfig } from './user-config';
import { ToolId, BubbleConfig, AttentionConfig } from '../common/types';
import { GuardrailConfig, GuardrailRule } from '../common/guardrails';
import { CORE_RULES } from './guardrails/rules.core';
import { isPatternSafe } from './guardrails/engine';
import { logger } from '../common/logger';
import { installFileLogSink } from './file-log-sink';
import { UsagePoller } from './usage/poller';
import { CodexUsagePoller } from './codex-usage/poller';
import { AntigravityUsagePoller } from './antigravity-usage/poller';
import { LlmPricingPoller } from './llm-pricing/poller';
import { Scheduler } from './scheduler/scheduler';
import { AttentionEngine } from './attention/engine';
import { isAutoLaunchEnabled, setAutoLaunch } from './auto-launch';
import { bootTimeline, TimelineHandle } from './timeline';
import { bootUpdater, UpdaterHandle } from './updater';

// Windows uses this to group windows under our identity and show our taskbar icon.
if (process.platform === 'win32') {
  app.setAppUserModelId('com.agentpulse.app');
}

// Single-instance lock: a second launch should resurface the running instance,
// not spawn a parallel one (which would also collide on the bridge port 4242).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

class AgentPulseApp {
  private bubbleManager: BubbleManager;
  private tooltipManager: TooltipManager;
  private settingsWindow: SettingsWindow;
  private trayManager: TrayManager;
  private stateManager: StatusStateManager;
  private bridgeServer: StatusBridgeServer;
  private detector: ToolDetector;
  private writer: ConfigWriter;
  private userConfig: UserConfig;
  private usagePoller: UsagePoller;
  private codexUsagePoller: CodexUsagePoller;
  private antigravityUsagePoller: AntigravityUsagePoller;
  private llmPricingPoller: LlmPricingPoller;
  private scheduler: Scheduler;
  private attentionEngine: AttentionEngine;
  private timeline: TimelineHandle | null = null;
  private updater!: UpdaterHandle;

  // Most-recent guardrail events kept in memory so a Settings window opened
  // after the fact still sees what happened. Capped at GUARDRAIL_LOG_SIZE.
  private guardrailLog: import('../common/guardrails').GuardrailEvent[] = [];
  private static readonly GUARDRAIL_LOG_SIZE = 50;

  constructor() {
    this.stateManager = new StatusStateManager();
    this.userConfig = loadConfig();
    this.bridgeServer = new StatusBridgeServer(this.stateManager, {
      getGuardrailConfig: () => this.userConfig.guardrails,
      onGuardrailEvent: (event) => this.handleGuardrailEvent(event),
      onListenError: (err, port) => this.handleBridgeListenError(err, port),
    });
    this.bubbleManager = new BubbleManager(this.userConfig.bubble);
    this.tooltipManager = new TooltipManager();
    this.settingsWindow = new SettingsWindow();
    this.trayManager = new TrayManager();
    this.detector = new ToolDetector();
    this.writer = new ConfigWriter();
    this.usagePoller = new UsagePoller(this.userConfig.usage);
    this.codexUsagePoller = new CodexUsagePoller(this.userConfig.codexUsage);
    this.antigravityUsagePoller = new AntigravityUsagePoller(this.userConfig.antigravityUsage);
    this.llmPricingPoller = new LlmPricingPoller();
    // Scheduler consumes the usage poller (live 5-hour resetsAt), so construct
    // it after the poller exists.
    this.scheduler = new Scheduler(this.userConfig.scheduler, { usagePoller: this.usagePoller });
    // Attention escalation watches state transitions from the bridge's state
    // manager, so it can be built as soon as the state manager exists.
    this.attentionEngine = new AttentionEngine(this.userConfig.attention, { stateManager: this.stateManager });
  }

  public init() {
    app.whenReady().then(() => installFileLogSink());
    this.bridgeServer.start();

    // Second-instance handler: surface settings window so the user sees a
    // response to clicking the shortcut again, instead of nothing happening.
    app.on('second-instance', () => {
      logger.info('[AgentPulseApp] second-instance detected — focusing settings');
      this.settingsWindow.show();
    });

    app.on('ready', () => {
      logger.info('[AgentPulseApp] app ready');
      if (!ENABLE_APP_MENU) {
        Menu.setApplicationMenu(null);
      }
      this.setupIpc();
      this.bubbleManager.init();
      this.tooltipManager.init();
      this.usagePoller.init();
      this.usagePoller.start();
      this.codexUsagePoller.init();
      this.codexUsagePoller.start();
      this.antigravityUsagePoller.init();
      this.antigravityUsagePoller.start();
      // Refresh model pricing from LiteLLM (cached daily; bundled fallback).
      this.llmPricingPoller.init();
      this.llmPricingPoller.start();

      // Scheduler starts after the pollers so it can subscribe to live window
      // state on its first reschedule.
      this.scheduler.init();
      this.scheduler.start();

      // Attention escalation: arms timers off waiting-state transitions.
      this.attentionEngine.init();
      this.attentionEngine.start();

      // Boot Pulse Timeline persistence. Subscribers wire up *after* the
      // pollers are init'd so we don't miss their first emit. If better-
      // sqlite3 is missing or won't load, this returns null and the rest of
      // the app keeps running.
      this.timeline = bootTimeline({
        stateManager: this.stateManager,
        usagePoller: this.usagePoller,
        codexUsagePoller: this.codexUsagePoller,
        antigravityUsagePoller: this.antigravityUsagePoller,
        redactTaskText: this.userConfig.analytics.redactTaskText,
        idleGapMinutes: this.userConfig.analytics.idleGapMinutes,
      });

      // Sync the OS login-item state to whatever we persisted. Cheap and
      // self-healing if the user toggled it externally.
      setAutoLaunch(this.userConfig.autoLaunch);

      // Boot updater before tray so the tray menu's "Check for updates"
      // entry can invoke updater.checkNow directly.
      this.updater = bootUpdater({
        getUserConfig: () => this.userConfig,
        applyUpdaterConfig: (next) => {
          this.userConfig.updates = next;
          saveConfig(this.userConfig);
        },
      });

      this.trayManager.init({
        onShowSettings: () => this.settingsWindow.show(),
        onCheckForUpdates: () => {
          this.settingsWindow.show();
          this.updater.checkNow();
        },
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
      this.antigravityUsagePoller.stop();
      this.llmPricingPoller.stop();
      this.scheduler.stop();
      this.tooltipManager.destroy();
      this.timeline?.shutdown();
      this.updater.shutdown();
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

    // Bubble appearance/behavior (size, stack corner, inactivity chime).
    // Resizes/restacks live windows immediately, then broadcasts so every
    // bubble renderer can re-scale its orb and switch its chime without a poll.
    ipcMain.handle('bubble:update-config', (_event, partial: Partial<BubbleConfig>) => {
      this.userConfig.bubble = { ...this.userConfig.bubble, ...partial };
      saveConfig(this.userConfig);
      this.bubbleManager.applyConfig(this.userConfig.bubble);
      const updated = this.userConfig.bubble;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('bubble:config-updated', updated);
      }
      return updated;
    });

    // Attention escalation config (threshold, channels, webhooks). Merges the
    // partial, persists, applies to the live engine, and broadcasts so any open
    // Settings view stays in sync. Returns the merged config.
    ipcMain.handle('attention:update-config', (_event, partial: Partial<AttentionConfig>) => {
      this.userConfig.attention = { ...this.userConfig.attention, ...partial };
      saveConfig(this.userConfig);
      this.attentionEngine.applyConfig(this.userConfig.attention);
      const updated = this.userConfig.attention;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('attention:config-updated', updated);
      }
      return updated;
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

    ipcMain.handle('antigravity-usage:update-config', (_event, partial: Partial<AntigravityUsageConfig>) => {
      this.userConfig.antigravityUsage = { ...this.userConfig.antigravityUsage, ...partial };
      saveConfig(this.userConfig);
      this.antigravityUsagePoller.applyConfig(this.userConfig.antigravityUsage);
      const updated = this.userConfig.antigravityUsage;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('antigravity-usage:config-updated', updated);
      }
      return updated;
    });

    ipcMain.handle('scheduler:update-config', (_event, partial: Partial<SchedulerConfig>) => {
      this.userConfig.scheduler = { ...this.userConfig.scheduler, ...partial };
      saveConfig(this.userConfig);
      this.scheduler.applyConfig(this.userConfig.scheduler);
      const updated = this.userConfig.scheduler;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('scheduler:config-updated', updated);
      }
      return updated;
    });

    // ── Guardrails IPC ────────────────────────────────────────────────────
    // Returns built-in rule metadata so the UI can render the rule list
    // without duplicating it. (Patterns are stringified — RegExp doesn't
    // serialize across IPC.)
    ipcMain.handle('guardrails:list-core-rules', () => {
      return CORE_RULES.map(r => ({
        ...r,
        pattern: r.pattern instanceof RegExp ? r.pattern.source : r.pattern,
        flags:   r.pattern instanceof RegExp ? r.pattern.flags  : (r.flags ?? 'i'),
      }));
    });

    ipcMain.handle('guardrails:get-config', () => this.userConfig.guardrails);

    ipcMain.handle('guardrails:update-config', (_event, partial: Partial<GuardrailConfig>) => {
      this.userConfig.guardrails = { ...this.userConfig.guardrails, ...partial };
      saveConfig(this.userConfig);
      return this.userConfig.guardrails;
    });

    // Validate a regex pattern before saving. Returns { ok, reason? }.
    ipcMain.handle('guardrails:validate-pattern', (_event, pattern: string) => {
      return isPatternSafe(pattern);
    });

    // Append a new custom rule (after pattern validation). Throws on invalid.
    ipcMain.handle('guardrails:add-custom-rule', (_event, rule: GuardrailRule) => {
      const check = typeof rule.pattern === 'string' ? isPatternSafe(rule.pattern) : { ok: true };
      if (!check.ok) throw new Error(`Invalid pattern: ${check.reason}`);
      const next = [...this.userConfig.guardrails.customRules, { ...rule, source: 'user' as const }];
      this.userConfig.guardrails = { ...this.userConfig.guardrails, customRules: next };
      saveConfig(this.userConfig);
      return this.userConfig.guardrails;
    });

    ipcMain.handle('guardrails:remove-custom-rule', (_event, ruleId: string) => {
      const next = this.userConfig.guardrails.customRules.filter(r => r.id !== ruleId);
      this.userConfig.guardrails = { ...this.userConfig.guardrails, customRules: next };
      saveConfig(this.userConfig);
      return this.userConfig.guardrails;
    });

    ipcMain.handle('guardrails:get-recent-events', () => this.guardrailLog);

    // ── Analytics IPC ─────────────────────────────────────────────────────
    ipcMain.handle('analytics:update-config', (_event, partial: Partial<AnalyticsConfig>) => {
      const next = { ...this.userConfig.analytics, ...partial };
      // Clamp idle-gap to a sane floor; 0/negative would close every event.
      if (typeof next.idleGapMinutes === 'number' && next.idleGapMinutes < 1) {
        next.idleGapMinutes = 1;
      }
      this.userConfig.analytics = next;
      saveConfig(this.userConfig);
      this.timeline?.updateOptions({
        redactTaskText: next.redactTaskText,
        idleGapMinutes: next.idleGapMinutes,
      });
      return next;
    });

    // ── Auto-launch IPC ───────────────────────────────────────────────────
    ipcMain.handle('auto-launch:get', () => ({
      enabled: this.userConfig.autoLaunch,
      effective: isAutoLaunchEnabled(),
      packaged: app.isPackaged,
    }));

    ipcMain.handle('auto-launch:set', (_event, enabled: boolean) => {
      const applied = setAutoLaunch(enabled);
      this.userConfig.autoLaunch = applied;
      saveConfig(this.userConfig);
      return {
        enabled: applied,
        effective: isAutoLaunchEnabled(),
        packaged: app.isPackaged,
      };
    });
  }

  // The bridge couldn't bind its port after retries. The self-collision case
  // (a second instance of our own app) is already prevented by the single-
  // instance lock, so reaching here means some *other* process holds the port.
  // Show one clean dialog explaining how to recover instead of the raw fatal
  // "A JavaScript error occurred in the main process" stack trace. The app
  // stays alive (tray + usage pollers still work); only live hook status is
  // unavailable until the port frees up.
  private handleBridgeListenError(err: NodeJS.ErrnoException, port: number) {
    const inUse = err.code === 'EADDRINUSE';
    const message = inUse
      ? `Agent Pulse couldn't start its status bridge because port ${port} is already in use by another program.`
      : `Agent Pulse couldn't start its status bridge on port ${port} (${err.code ?? 'error'}).`;
    const detail = inUse
      ? `Live agent status from your tools won't update until the port is free.\n\n` +
        `To fix this, close whatever is using port ${port}, or set a different port by ` +
        `launching with the AGENT_PULSE_PORT environment variable (then reinstall hooks from Settings).`
      : err.message;
    dialog.showMessageBox({
      type: 'warning',
      title: 'Agent Pulse',
      message,
      detail,
      buttons: ['OK'],
    }).catch((e) => logger.error('[AgentPulseApp] failed to show listen-error dialog', e));
  }

  // Push a guardrail event to every renderer window and append to the
  // in-memory ring so the Settings log shows history when opened post-event.
  // Also persisted to the timeline DB so the Analytics tab can aggregate
  // long-running counts; in-memory ring serves the live log only.
  private handleGuardrailEvent(event: import('../common/guardrails').GuardrailEvent) {
    this.guardrailLog = [event, ...this.guardrailLog].slice(0, AgentPulseApp.GUARDRAIL_LOG_SIZE);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('guardrail:event', event);
    }
    this.timeline?.db.insertGuardrailEvent({
      ts: event.ts,
      toolId: event.toolId,
      decision: event.decision,
      blockable: event.blockable ? 1 : 0,
      command: event.command,
      ruleIds: event.matched.map(m => m.ruleId).join(','),
      ruleMessages: JSON.stringify(
        event.matched.map(m => ({ ruleId: m.ruleId, message: m.message })),
      ),
    });
  }
}

// Only boot the app when we actually hold the single-instance lock. `app.quit()`
// above is async and does NOT halt this synchronous module code, so without this
// guard a second instance would still reach `init()` → `bridgeServer.start()` and
// collide on port 4242 (EADDRINUSE) before quitting.
if (gotSingleInstanceLock) {
  const pulseApp = new AgentPulseApp();
  pulseApp.init();
}

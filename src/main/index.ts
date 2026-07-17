import { app, ipcMain, shell, BrowserWindow, Menu, dialog, screen, nativeTheme } from 'electron';
import { BubbleManager } from './windows/bubble-manager';
import { TooltipManager } from './windows/tooltip-window';
import { TourManager } from './windows/tour-manager';
import { SettingsWindow } from './windows/settings-window';
import { TrayManager } from './windows/tray';
import { ENABLE_APP_MENU } from './feature-flags';
import { StatusStateManager } from './bridge/state-manager';
import { StatusBridgeServer } from './bridge/server';
import { ToolDetector } from './installer/detector';
import { ConfigWriter } from './installer/config-writer';
import path from 'path';
import { loadConfig, saveConfig, defaultStatusLineConfig, migrateBacklogScheduler, migrateBacklogTemplates, migrateAppearance, UserConfig, UsageConfig, CodexUsageConfig, CursorUsageConfig, CopilotUsageConfig, AntigravityUsageConfig, AnalyticsConfig, SchedulerConfig } from './user-config';
import { BacklogSchedulerConfig, BacklogTemplate } from '../common/backlog-types';
import { initBacklogDb, closeBacklogDb } from './backlog/db';
import { BacklogStore } from './backlog/store';
import { BacklogEngine } from './backlog/engine';
import { registerBacklogIpc } from './backlog/ipc';
import { ToolId, BubbleConfig, AttentionConfig, StatusLineConfig, StatusLineDetectInfo, DisplayInfo, TourState, AppearanceConfig } from '../common/types';
import { GuardrailConfig, GuardrailRule } from '../common/guardrails';
import { CORE_RULES } from './guardrails/rules.core';
import { isPatternSafe } from './guardrails/engine';
import { SecretProtectionConfig, SecretRule, SecretAccessEvent } from '../common/secretProtection';
import { CORE_SECRET_RULES } from './secretProtection/rules.core';
import { isGlobSafe, effectiveSecretRules } from './secretProtection/engine';
import { writeSecretFilesForTool, removeSecretFilesForTool, writeAiIgnore, removeAiIgnore } from './installer/secret-files';
import { logger } from '../common/logger';
import { installFileLogSink } from './file-log-sink';
import { UsagePoller } from './usage/poller';
import { CodexUsagePoller } from './codex-usage/poller';
import { CursorUsagePoller } from './cursor-usage/poller';
import { CopilotUsagePoller } from './copilot-usage/poller';
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
  private tourManager: TourManager;
  private settingsWindow: SettingsWindow;
  private trayManager: TrayManager;
  private stateManager: StatusStateManager;
  private bridgeServer: StatusBridgeServer;
  private detector: ToolDetector;
  private writer: ConfigWriter;
  private userConfig: UserConfig;
  private usagePoller: UsagePoller;
  private codexUsagePoller: CodexUsagePoller;
  private cursorUsagePoller: CursorUsagePoller;
  private copilotUsagePoller: CopilotUsagePoller;
  private antigravityUsagePoller: AntigravityUsagePoller;
  private llmPricingPoller: LlmPricingPoller;
  private scheduler: Scheduler;
  private attentionEngine: AttentionEngine;
  private backlogStore: BacklogStore | null = null;
  private backlogEngine: BacklogEngine | null = null;
  private timeline: TimelineHandle | null = null;
  private updater!: UpdaterHandle;

  // Most-recent guardrail events kept in memory so a Settings window opened
  // after the fact still sees what happened. Capped at GUARDRAIL_LOG_SIZE.
  private guardrailLog: import('../common/guardrails').GuardrailEvent[] = [];
  private static readonly GUARDRAIL_LOG_SIZE = 50;

  // Same ring-buffer treatment for Secret Protection read events.
  private secretAccessLog: SecretAccessEvent[] = [];
  private static readonly SECRET_LOG_SIZE = 50;
  // Alert-fatigue guard: collapse identical (tool+file+decision) read events
  // that fire within this window — agents often retry/re-read the same path.
  private lastSecretEventKey: string | null = null;
  private lastSecretEventTs = 0;
  private static readonly SECRET_DEDUP_MS = 10_000;

  constructor() {
    this.stateManager = new StatusStateManager();
    this.userConfig = loadConfig();
    this.bridgeServer = new StatusBridgeServer(this.stateManager, {
      getGuardrailConfig: () => this.userConfig.guardrails,
      onGuardrailEvent: (event) => this.handleGuardrailEvent(event),
      getSecretProtectionConfig: () => this.userConfig.secretProtection,
      onSecretAccessEvent: (event) => this.handleSecretAccessEvent(event),
      onListenError: (err, port) => this.handleBridgeListenError(err, port),
    });
    this.bubbleManager = new BubbleManager(this.userConfig.bubble);
    // Bubble clicks resolve focus PIDs from the bridge's state, not just the
    // renderer's mirror — covers PIDs rehydrated at boot (never broadcast).
    this.bubbleManager.getToolStatus = (toolId) => this.stateManager.getStatus(toolId);
    // Drag-end → persist the new stack anchor and let every renderer (open
    // Settings included) see the updated config. applyConfig restacks, which
    // clamps the anchor onto a live display and settles the grow direction.
    this.bubbleManager.onAnchorChange = (anchor) => {
      this.userConfig.bubble = { ...this.userConfig.bubble, anchor };
      saveConfig(this.userConfig);
      this.bubbleManager.applyConfig(this.userConfig.bubble);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('bubble:config-updated', this.userConfig.bubble);
      }
    };
    // Saved display id went stale (ids regenerate across reboots) but the
    // monitor was re-found by label/bounds — persist the fresh id. No
    // applyConfig here: the manager already healed its own state mid-restack,
    // and re-applying from inside that restack would recurse.
    this.bubbleManager.onDisplayRehome = (displayId, displayMatch) => {
      this.userConfig.bubble = { ...this.userConfig.bubble, displayId, displayMatch };
      saveConfig(this.userConfig);
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('bubble:config-updated', this.userConfig.bubble);
      }
    };
    this.tooltipManager = new TooltipManager();
    this.tourManager = new TourManager();
    // Tour ends (finished or skipped) → never auto-offer it again, land the
    // user on Settings where the setup checklist takes over the narrative.
    this.tourManager.onFinished = (completed) => {
      this.userConfig.tour = {
        ...this.userConfig.tour,
        hasSeenTour: true,
        completedAt: completed ? Date.now() : this.userConfig.tour.completedAt,
      };
      saveConfig(this.userConfig);
      this.broadcastTourState();
      this.settingsWindow.show();
      // The splash listens for this and navigates itself to the Settings view
      // (Hooks tab), where the setup checklist is waiting.
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('tour:completed', { completed });
      }
    };
    this.settingsWindow = new SettingsWindow();
    this.trayManager = new TrayManager();
    this.detector = new ToolDetector();
    this.writer = new ConfigWriter();
    this.usagePoller = new UsagePoller(this.userConfig.usage);
    this.codexUsagePoller = new CodexUsagePoller(this.userConfig.codexUsage);
    this.cursorUsagePoller = new CursorUsagePoller(this.userConfig.cursorUsage);
    this.copilotUsagePoller = new CopilotUsagePoller(this.userConfig.copilotUsage);
    this.antigravityUsagePoller = new AntigravityUsagePoller(this.userConfig.antigravityUsage);
    this.llmPricingPoller = new LlmPricingPoller();
    // Scheduler consumes the usage poller (live 5-hour resetsAt), so construct
    // it after the poller exists.
    this.scheduler = new Scheduler(this.userConfig.scheduler, {
      usagePoller: this.usagePoller,
      // Backlog runs spend + anchor windows themselves; skip redundant openers.
      shouldSkipOpener: () => this.backlogEngine?.isRunningCard() ?? false,
    });
    // Attention escalation watches state transitions from the bridge's state
    // manager, so it can be built as soon as the state manager exists.
    this.attentionEngine = new AttentionEngine(this.userConfig.attention, { stateManager: this.stateManager });
  }

  // Recover each tool's last-known agent PID from the timeline DB so bubble
  // clicks right after a restart can still PID-target the hosting window
  // (in-memory statuses start empty). Bounded to the last 24h: older PIDs
  // are almost certainly dead, and Windows recycles PIDs — walking a
  // recycled one could focus an unrelated window.
  private rehydrateAgentPids() {
    const db = this.timeline?.db;
    if (!db) return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const rows = db.query<{ toolId: ToolId; agentPid: number | null; ts: number }>(
      `SELECT tool_id AS toolId, agent_pid AS agentPid, MAX(timestamp) AS ts
       FROM events
       WHERE agent_pid IS NOT NULL AND timestamp > ?
       GROUP BY tool_id`,
      [cutoff],
    );
    for (const row of rows) {
      if (typeof row.agentPid === 'number' && row.agentPid > 0) {
        this.stateManager.seedAgentPid(row.toolId, row.agentPid, row.ts);
        logger.info(`[AgentPulseApp] rehydrated agentPid ${row.agentPid} for ${row.toolId}`);
      }
    }
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
      // Tray-only app on macOS: no Dock icon, no Cmd+Tab entry — the status
      // bar item is the app's home. Windows (settings, bubbles) still open
      // and focus normally. Packaged builds also set LSUIElement so the icon
      // never flashes in the Dock at launch; this covers dev runs.
      if (process.platform === 'darwin') {
        app.dock?.hide();
      }
      if (!ENABLE_APP_MENU) {
        Menu.setApplicationMenu(null);
      }
      this.setupIpc();
      this.applyThemeSource();
      // Refresh an already-installed status line to this app version so script
      // improvements (e.g. icon rendering) propagate on upgrade without a manual
      // re-apply. No-ops unless we own the installed status line.
      this.refreshDeployedStatusLine();
      this.bubbleManager.init();
      this.tooltipManager.init();
      this.tourManager.init();
      // Stamp the install's very first hook event — the setup checklist's
      // "first live status" item flips on this. One save, then unsubscribe.
      if (!this.userConfig.tour.firstEventAt) {
        const unsubscribe = this.stateManager.onEvent(() => {
          if (this.userConfig.tour.firstEventAt) return;
          this.userConfig.tour = { ...this.userConfig.tour, firstEventAt: Date.now() };
          saveConfig(this.userConfig);
          this.broadcastTourState();
          unsubscribe();
        });
      }
      this.usagePoller.init();
      this.usagePoller.start();
      this.codexUsagePoller.init();
      this.codexUsagePoller.start();
      this.cursorUsagePoller.init();
      this.cursorUsagePoller.start();
      this.copilotUsagePoller.init();
      this.copilotUsagePoller.start();
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
        cursorUsagePoller: this.cursorUsagePoller,
        antigravityUsagePoller: this.antigravityUsagePoller,
        redactTaskText: this.userConfig.analytics.redactTaskText,
        idleGapMinutes: this.userConfig.analytics.idleGapMinutes,
      });
      this.rehydrateAgentPids();

      // Boot the backlog board + scheduler. Separate SQLite file from the
      // timeline; if better-sqlite3 won't load, the board tab shows a clean
      // unavailable state and the rest of the app keeps running.
      const backlogDb = initBacklogDb();
      if (backlogDb) {
        this.backlogStore = new BacklogStore(backlogDb);
        this.backlogEngine = new BacklogEngine(this.userConfig.backlogScheduler, {
          store: this.backlogStore,
          usagePoller: this.usagePoller,
          artifactsDir: path.join(app.getPath('userData'), 'backlog-artifacts'),
          worktreesDir: path.join(app.getPath('userData'), 'backlog-worktrees'),
          // Usage latch: the engine pauses auto-claims while the Claude
          // 5-hour window is exhausted and re-arms at its reset time.
          getUsage: () => {
            const snap = this.usagePoller.getStatus().snapshot;
            return snap ? { utilization: snap.fiveHour.utilization, resetsAt: snap.fiveHour.resetsAt } : null;
          },
        });
        this.backlogEngine.start();
      }
      registerBacklogIpc({
        store: this.backlogStore,
        engine: this.backlogEngine,
        getTemplates: () => this.userConfig.backlogTemplates,
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

      // Restore bubbles from last saved state (seeds from detection on first run).
      this.restoreBubbles();

      // Refresh Layer-1 ignore files for installed tools so a list edited while
      // the app was closed (or a newly-installed agent) picks up the current set.
      void this.syncSecretFiles();

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
      this.cursorUsagePoller.stop();
      this.copilotUsagePoller.stop();
      this.antigravityUsagePoller.stop();
      this.llmPricingPoller.stop();
      this.scheduler.stop();
      // Engine stop kills any running claude process tree and finalizes the
      // card as Paused before the DB closes.
      this.backlogEngine?.stop();
      closeBacklogDb();
      this.tooltipManager.destroy();
      this.tourManager.destroy();
      this.timeline?.shutdown();
      this.updater.shutdown();
      this.trayManager.destroy();
    });

    app.on('will-quit', () => {
      logger.info('[AgentPulseApp] will-quit');
    });
  }

  // Decide which bubbles to show at launch. Normally this is just the user's
  // persisted choices. But on a fresh machine (nothing persisted yet) we seed
  // from detection so only *installed* tools get a bubble — never a phantom
  // Cursor bubble on a PC without Cursor. An explicit choice (any key present,
  // including `false` values from a user who turned bubbles off) is left alone.
  private async restoreBubbles() {
    let enabled = this.userConfig.enabledBubbles;
    const firstRun = !enabled || Object.keys(enabled).length === 0;
    if (firstRun) {
      try {
        const detected = await this.detector.detectAll();
        enabled = {};
        for (const toolId of Object.keys(detected) as ToolId[]) {
          if (detected[toolId]?.installed) enabled[toolId] = true;
        }
        this.userConfig.enabledBubbles = enabled;
        saveConfig(this.userConfig);
        logger.info('[AgentPulseApp] first-run bubble seed from detection:', JSON.stringify(enabled));
      } catch (e) {
        logger.warn('[AgentPulseApp] detection-based bubble seed failed; starting with none', e);
        enabled = {};
      }
    }
    logger.info('[AgentPulseApp] restoring enabled bubbles:', JSON.stringify(enabled));
    this.bubbleManager.syncEnabledBubbles(enabled);
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
      // Picking a corner preset or a monitor is an explicit placement choice —
      // either always overrides a drag-placed anchor, even if the renderer
      // forgot to clear it (a stale anchor would keep the stack pinned to
      // whatever monitor it was last dragged to).
      if ((partial.stackPosition !== undefined || partial.displayId !== undefined) && partial.anchor === undefined) {
        partial = { ...partial, anchor: null };
      }
      // Stamp the reboot-stable identity for the chosen monitor (ids
      // regenerate across restarts; label+bounds let us re-find it). The
      // renderer only ever sends displayId — the match is main's concern.
      if (partial.displayId !== undefined && partial.displayMatch === undefined) {
        const d = partial.displayId != null
          ? screen.getAllDisplays().find((dd) => dd.id === partial.displayId)
          : undefined;
        partial = {
          ...partial,
          displayMatch: d
            ? { label: d.label ?? '', bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height } }
            : null,
        };
      }
      this.userConfig.bubble = { ...this.userConfig.bubble, ...partial };
      saveConfig(this.userConfig);
      this.bubbleManager.applyConfig(this.userConfig.bubble);
      const updated = this.userConfig.bubble;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('bubble:config-updated', updated);
      }
      return updated;
    });

    // Connected monitors for the Settings display picker. Snapshotted into
    // plain objects (Electron Display instances don't survive IPC cloning).
    const snapshotDisplays = (): DisplayInfo[] => {
      const primaryId = screen.getPrimaryDisplay().id;
      return screen.getAllDisplays().map((d) => ({
        id: d.id,
        label: d.label ?? '',
        bounds: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height },
        primary: d.id === primaryId,
      }));
    };
    ipcMain.handle('screen:get-displays', () => snapshotDisplays());
    // Hotplug while Settings is open: push the fresh list so the picker
    // doesn't offer a monitor that's gone (or miss one just plugged in).
    const broadcastDisplays = () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('screen:displays-changed', snapshotDisplays());
      }
    };
    screen.on('display-added', broadcastDisplays);
    screen.on('display-removed', broadcastDisplays);

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
      const result = await this.writer.installHook(toolId, projectPath);
      // A freshly-hooked tool should also receive the current secret-glob list.
      this.writeSecretFilesForToolSafe(toolId, projectPath);
      return result;
    });

    ipcMain.handle('uninstall-hook', async (_event, { toolId, projectPath }) => {
      // Strip our managed secret-protection block when the hook is removed.
      try {
        removeSecretFilesForTool(toolId, { projectPath });
      } catch (e) {
        logger.warn(`[AgentPulseApp] removeSecretFiles failed for ${toolId}`, e);
      }
      return await this.writer.uninstallHook(toolId, projectPath);
    });

    ipcMain.handle('open-path', async (_event, filePath: string) => {
      await shell.openPath(filePath);
    });

    // Opens http(s) links (e.g. from a rendered markdown report) in the user's
    // default browser. Restricted to web schemes so a report can't invoke an
    // arbitrary protocol handler via shell.openExternal.
    ipcMain.handle('open-external', async (_event, url: string) => {
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        await shell.openExternal(url);
      }
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

    ipcMain.handle('cursor-usage:update-config', (_event, partial: Partial<CursorUsageConfig>) => {
      this.userConfig.cursorUsage = { ...this.userConfig.cursorUsage, ...partial };
      saveConfig(this.userConfig);
      this.cursorUsagePoller.applyConfig(this.userConfig.cursorUsage);
      const updated = this.userConfig.cursorUsage;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('cursor-usage:config-updated', updated);
      }
      return updated;
    });

    ipcMain.handle('copilot-usage:update-config', (_event, partial: Partial<CopilotUsageConfig>) => {
      this.userConfig.copilotUsage = { ...this.userConfig.copilotUsage, ...partial };
      saveConfig(this.userConfig);
      this.copilotUsagePoller.applyConfig(this.userConfig.copilotUsage);
      const updated = this.userConfig.copilotUsage;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('copilot-usage:config-updated', updated);
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

    ipcMain.handle('backlog:scheduler:update-config', (_event, partial: Partial<BacklogSchedulerConfig>) => {
      // Revalidate the merged result — renderer payloads get the same
      // guarantees as disk loads (parseable slot times, days clamped 0–6,
      // maxConcurrent pinned to 1 for Phase 1's sequential queue).
      this.userConfig.backlogScheduler = migrateBacklogScheduler({ ...this.userConfig.backlogScheduler, ...partial });
      saveConfig(this.userConfig);
      this.backlogEngine?.applyConfig(this.userConfig.backlogScheduler);
      const updated = this.userConfig.backlogScheduler;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('backlog:scheduler:config-updated', updated);
      }
      return updated;
    });

    ipcMain.handle('backlog:templates:update', (_event, templates: BacklogTemplate[]) => {
      this.userConfig.backlogTemplates = migrateBacklogTemplates(templates);
      saveConfig(this.userConfig);
      const updated = this.userConfig.backlogTemplates;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('backlog:templates-updated', updated);
      }
      return updated;
    });

    // ── Claude Code status line ───────────────────────────────────────────
    // Detect an available script runtime + the current install state so the
    // Settings UI can show a runtime badge and the right install/remove control.
    ipcMain.handle('status-line:detect', (): StatusLineDetectInfo => {
      const runtime = this.detector.detectStatusLineRuntime();
      return {
        runtime: runtime?.runtime ?? null,
        binPath: runtime?.binPath ?? null,
        state: this.writer.statusLineState(),
        settingsPath: this.writer.statusLineSettingsPath(),
      };
    });

    ipcMain.handle('status-line:get-config', () => this.userConfig.statusLine);

    // Merge + persist the segment/color config. If the status line is already
    // installed, re-project the deployed config file AND refresh the deployed
    // renderer script so changes (including script-level features like icons)
    // take effect immediately. Broadcast so other windows stay in sync.
    ipcMain.handle('status-line:update-config', (_event, partial: Partial<StatusLineConfig>) => {
      this.userConfig.statusLine = { ...this.userConfig.statusLine, ...partial };
      saveConfig(this.userConfig);
      this.refreshDeployedStatusLine();
      const updated = this.userConfig.statusLine;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('status-line:config-updated', updated);
      }
      return updated;
    });

    // Reset the status line to the shipped default (two-line layout with icons)
    // and re-project it live if installed. Lets a user on an older single-line
    // config jump to the current look without rebuilding it by hand.
    ipcMain.handle('status-line:reset-config', () => {
      this.userConfig.statusLine = defaultStatusLineConfig();
      saveConfig(this.userConfig);
      this.refreshDeployedStatusLine();
      const updated = this.userConfig.statusLine;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('status-line:config-updated', updated);
      }
      return updated;
    });

    // Install (or re-install) the status line. Refuses if no runtime is found,
    // and requires an explicit `replace` flag before clobbering a foreign one.
    ipcMain.handle('status-line:install', (_event, args: { replace?: boolean } = {}) => {
      const runtime = this.detector.detectStatusLineRuntime();
      if (!runtime) return { success: false, reason: 'no-runtime' as const };
      if (this.writer.statusLineState() === 'foreign' && !args.replace) {
        return { success: false, reason: 'needs-confirm' as const };
      }
      try {
        const result = this.writer.installStatusLine(this.userConfig.statusLine, runtime.runtime, runtime.binPath);
        return { ...result, runtime: runtime.runtime };
      } catch (e) {
        logger.error('[status-line] install failed', e);
        return { success: false, reason: 'error' as const, message: String(e) };
      }
    });

    ipcMain.handle('status-line:remove', () => this.writer.removeStatusLine());

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

    // ── Secret Protection IPC ─────────────────────────────────────────────
    // Mirrors the guardrails channels. Globs are plain strings, so no RegExp
    // serialization concerns as with command rules.
    ipcMain.handle('secret-protection:list-core-rules', () => CORE_SECRET_RULES);

    ipcMain.handle('secret-protection:get-config', () => this.userConfig.secretProtection);

    ipcMain.handle('secret-protection:update-config', (_event, partial: Partial<SecretProtectionConfig>) => {
      this.userConfig.secretProtection = { ...this.userConfig.secretProtection, ...partial };
      saveConfig(this.userConfig);
      // Re-run the Layer-1 fan-out so ignore files track the edited list.
      void this.syncSecretFiles();
      return this.userConfig.secretProtection;
    });

    ipcMain.handle('secret-protection:validate-glob', (_event, glob: string) => isGlobSafe(glob));

    ipcMain.handle('secret-protection:add-custom-rule', (_event, rule: SecretRule) => {
      const check = isGlobSafe(rule.glob);
      if (!check.ok) throw new Error(`Invalid glob: ${check.reason}`);
      const next = [...this.userConfig.secretProtection.customRules, { ...rule, source: 'user' as const }];
      this.userConfig.secretProtection = { ...this.userConfig.secretProtection, customRules: next };
      saveConfig(this.userConfig);
      void this.syncSecretFiles();
      return this.userConfig.secretProtection;
    });

    ipcMain.handle('secret-protection:remove-custom-rule', (_event, ruleId: string) => {
      const next = this.userConfig.secretProtection.customRules.filter((r) => r.id !== ruleId);
      this.userConfig.secretProtection = { ...this.userConfig.secretProtection, customRules: next };
      saveConfig(this.userConfig);
      void this.syncSecretFiles();
      return this.userConfig.secretProtection;
    });

    ipcMain.handle('secret-protection:get-recent-events', () => this.secretAccessLog);

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

    // ── Appearance IPC ────────────────────────────────────────────────────
    ipcMain.handle('appearance:update-config', (_event, partial: Partial<AppearanceConfig>) => {
      const next = migrateAppearance({ ...this.userConfig.appearance, ...partial });
      this.userConfig.appearance = next;
      saveConfig(this.userConfig);
      this.applyThemeSource();
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('appearance:config-updated', next);
      }
      return next;
    });

    // ── Tour / setup checklist IPC ────────────────────────────────────────
    // `tour:start`, `tour:demo-state`, `tour:card-measured`, and `tour:finish`
    // are owned by TourManager.init(); only the persisted state lives here.
    ipcMain.handle('tour:get-state', (): TourState => this.projectTourState());

    ipcMain.handle('tour:set-setup-dismissed', (_event, dismissed: boolean) => {
      this.userConfig.tour = { ...this.userConfig.tour, setupDismissed: !!dismissed };
      saveConfig(this.userConfig);
      this.broadcastTourState();
      return this.projectTourState();
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

  private applyThemeSource() {
    const t = this.userConfig.appearance.theme;
    nativeTheme.themeSource = t === 'auto' ? 'system' : t;
  }

  // Renderer-facing slice of the tour config (completedAt stays internal).
  private projectTourState(): TourState {
    const t = this.userConfig.tour;
    return {
      hasSeenTour: t.hasSeenTour,
      firstEventAt: t.firstEventAt,
      setupDismissed: t.setupDismissed,
    };
  }

  private broadcastTourState() {
    const state = this.projectTourState();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('tour:state-updated', state);
    }
  }

  // When the status line is installed (ours), push the current config to its
  // projected JSON and refresh the deployed renderer script to this app
  // version. The script refresh is what lets features added after first
  // install — e.g. icon prefixes — start rendering without a manual re-apply.
  private refreshDeployedStatusLine() {
    if (this.writer.statusLineState() !== 'ours') return;
    try {
      this.writer.writeStatusLineConfig(this.userConfig.statusLine);
      const runtime = this.writer.installedStatusLineRuntime();
      if (runtime) this.writer.deployStatusLineScript(runtime);
    } catch (e) {
      logger.error('[status-line] failed to refresh deployed status line', e);
    }
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

  // Push a Secret Protection event to every renderer (bubble alert + Settings
  // log) and append to the in-memory ring so a Settings window opened after the
  // fact still sees it. Mirrors handleGuardrailEvent's broadcast path.
  private handleSecretAccessEvent(event: SecretAccessEvent) {
    // Suppress a duplicate of the immediately-preceding event within the dedup
    // window so a retrying agent doesn't spam the bubble + log.
    const key = `${event.toolId}|${event.filePath}|${event.decision}`;
    if (key === this.lastSecretEventKey && event.ts - this.lastSecretEventTs < AgentPulseApp.SECRET_DEDUP_MS) {
      return;
    }
    this.lastSecretEventKey = key;
    this.lastSecretEventTs = event.ts;

    this.secretAccessLog = [event, ...this.secretAccessLog].slice(0, AgentPulseApp.SECRET_LOG_SIZE);
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('secret-access:event', event);
    }
    this.timeline?.db.insertSecretAccessEvent({
      ts: event.ts,
      toolId: event.toolId,
      decision: event.decision,
      blockable: event.blockable ? 1 : 0,
      filePath: event.filePath,
      viaShell: event.viaShell ? 1 : 0,
      ruleIds: event.matched.map(m => m.ruleId).join(','),
      ruleMessages: JSON.stringify(
        event.matched.map(m => ({ ruleId: m.ruleId, message: m.message ?? m.glob })),
      ),
    });
  }

  // Layer 1 fan-out: write the current secret-glob list into every installed
  // tool's ignore/deny artifact (or strip it when protection / ignore-file
  // writing is off). Global scope only in Phase 1. Best-effort and idempotent —
  // safe to call on config change, hook install, and app start.
  private async syncSecretFiles() {
    const cfg = this.userConfig.secretProtection;
    const globs = (cfg.enabled && cfg.writeIgnoreFiles)
      ? effectiveSecretRules(cfg).map((r) => r.glob)
      : [];
    let detected: Awaited<ReturnType<ToolDetector['detectAll']>>;
    try {
      detected = await this.detector.detectAll();
    } catch (e) {
      logger.warn('[AgentPulseApp] syncSecretFiles detection failed', e);
      return;
    }
    // Only touch tools we've actually hooked — avoids creating ignore files in
    // home/project dirs for agents the user never installed.
    const installed = (Object.keys(detected) as ToolId[]).filter((id) => this.writer.isHookInstalled(id));

    // Project scope (analysis §3): write into each recently-active project
    // directory rather than the home dir. Global scope writes once per tool.
    const targets: (string | undefined)[] =
      cfg.scope === 'project' ? this.recentProjectPaths() : [undefined];
    if (cfg.scope === 'project' && targets.length === 0) {
      logger.info('[AgentPulseApp] secret-protection project scope: no recent project paths to write');
      return;
    }

    for (const projectPath of targets) {
      for (const toolId of installed) {
        try {
          if (globs.length === 0) removeSecretFilesForTool(toolId, { projectPath });
          else writeSecretFilesForTool(toolId, globs, { projectPath });
        } catch (e) {
          logger.warn(`[AgentPulseApp] syncSecretFiles failed for ${toolId}`, e);
        }
      }
      // Phase 4 — emerging .aiignore standard, written alongside the per-tool files.
      try {
        if (globs.length === 0) removeAiIgnore({ projectPath });
        else writeAiIgnore(globs, { projectPath });
      } catch (e) {
        logger.warn('[AgentPulseApp] writeAiIgnore failed', e);
      }
    }
  }

  // Distinct project directories an agent worked in over the last 7 days, from
  // the timeline DB. Used for project-scope secret-file writes. Empty when the
  // timeline is unavailable or no project paths were recorded.
  private recentProjectPaths(): string[] {
    const db = this.timeline?.db;
    if (!db) return [];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    try {
      const rows = db.query<{ projectPath: string | null }>(
        `SELECT DISTINCT project_path AS projectPath
         FROM events
         WHERE project_path IS NOT NULL AND timestamp > ?
         LIMIT 50`,
        [cutoff],
      );
      return rows
        .map((r) => r.projectPath)
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
    } catch (e) {
      logger.warn('[AgentPulseApp] recentProjectPaths query failed', e);
      return [];
    }
  }

  // Write the current secret-glob list for a single tool, honouring the master
  // + ignore-file toggles. Used right after a hook install (projectPath is the
  // install target when the user scoped the hook to a project).
  private writeSecretFilesForToolSafe(toolId: ToolId, projectPath?: string) {
    const cfg = this.userConfig.secretProtection;
    try {
      if (cfg.enabled && cfg.writeIgnoreFiles) {
        const globs = effectiveSecretRules(cfg).map((r) => r.glob);
        writeSecretFilesForTool(toolId, globs, { projectPath });
        writeAiIgnore(globs, { projectPath });
      }
    } catch (e) {
      logger.warn(`[AgentPulseApp] writeSecretFiles failed for ${toolId}`, e);
    }
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

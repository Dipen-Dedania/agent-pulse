// "Needs you" attention engine. When a tool enters the `waiting` state (agent
// finished, blocked on the user) and stays there longer than the configured
// threshold, this escalates: it broadcasts `attention:escalate` so the bubble
// renderer intensifies, fires the user's chat webhook(s), and optionally raises
// an OS notification. Notify-once per waiting episode.
//
// Lifecycle mirrors Scheduler/UsagePoller: constructor → init() → start()/stop()
// /applyConfig(). It subscribes to StatusStateManager.onEvent (the same choke
// point the timeline uses) and owns one timer per tool. The authoritative
// "waiting" state lives in the main process, so the timer survives even when no
// bubble window is focused.

import { BrowserWindow, Notification, ipcMain } from 'electron';
import { logger } from '../../common/logger';
import { AgentState, AttentionConfig, NormalizedEvent, ToolId, WebhookTarget } from '../../common/types';
import { TOOL_META } from '../../common/toolMeta';
import { sendWebhook } from '../notifications/webhook';
import { StatusStateManager } from '../bridge/state-manager';

// Discord embed accent for the escalation message — a warm orange that matches
// the bubble's attention badge (and avoids the teal nudge / red guardrail hues).
const ATTENTION_ACCENT = 0xf97316;

export interface AttentionDeps {
  stateManager: StatusStateManager;
}

// Per-tool escalation bookkeeping. `lastState` is null until the first event so
// that a tool whose very first event is `waiting` still arms (prev !== waiting).
interface ToolEntry {
  lastState: AgentState | null;
  timer: NodeJS.Timeout | null;
  escalated: boolean;
  task?: string; // last taskSummary seen, for the webhook body
}

export class AttentionEngine {
  private config: AttentionConfig;
  private readonly stateManager: StatusStateManager;
  private entries: Map<ToolId, ToolEntry> = new Map();
  private unsubscribe: (() => void) | null = null;
  private stopped = true;

  constructor(config: AttentionConfig, deps: AttentionDeps) {
    this.config = config;
    this.stateManager = deps.stateManager;
  }

  public init() {
    // Manual webhook test from Settings — POSTs a canned message so the user
    // can confirm a URL before relying on it.
    ipcMain.handle('attention:test-webhook', async (_event, target: WebhookTarget) => {
      logger.info(`[Attention] test webhook kind=${target?.kind}`);
      return sendWebhook(target, {
        title: 'Agent Pulse test',
        body: 'If you can read this, your webhook is wired up. 🎉',
        accentColor: ATTENTION_ACCENT,
      });
    });

    // Clicking a bubble acknowledges the escalation for that tool.
    ipcMain.on('attention:ack', (_event, { toolId }: { toolId: ToolId }) => {
      this.acknowledge(toolId);
    });
  }

  public start() {
    if (!this.stopped) return;
    this.stopped = false;
    logger.info(`[Attention] starting, enabled=${this.config.enabled} threshold=${this.config.escalateAfterSeconds}s`);
    this.unsubscribe = this.stateManager.onEvent((e) => this.onEvent(e));
  }

  public stop() {
    logger.info('[Attention] stopping');
    this.stopped = true;
    if (this.unsubscribe) { this.unsubscribe(); this.unsubscribe = null; }
    for (const entry of this.entries.values()) this.clearTimer(entry);
  }

  public applyConfig(config: AttentionConfig) {
    const wasEnabled = this.config.enabled;
    this.config = config;
    // If the feature was just turned off, cancel everything in flight and
    // clear any visible escalation on the bubbles.
    if (wasEnabled && !config.enabled) {
      for (const [toolId, entry] of this.entries) {
        this.clearTimer(entry);
        if (entry.escalated) {
          entry.escalated = false;
          this.broadcastClear(toolId);
        }
      }
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private onEvent(e: NormalizedEvent) {
    if (this.stopped) return;
    const { toolId, state } = e;
    const entry = this.entries.get(toolId) ?? { lastState: null, timer: null, escalated: false };
    const prev = entry.lastState;
    entry.lastState = state;
    if (e.payload.taskSummary) entry.task = e.payload.taskSummary;

    if (state === 'waiting') {
      // (Re)arm only on the transition INTO waiting, not on repeat waiting
      // events, so a burst of Stop hooks doesn't reset the clock endlessly.
      if (prev !== 'waiting') this.arm(toolId, entry);
    } else {
      // Left waiting → the user (or the agent) moved on. Cancel + clear.
      this.clearTimer(entry);
      if (entry.escalated) {
        entry.escalated = false;
        this.broadcastClear(toolId);
      }
    }

    this.entries.set(toolId, entry);
  }

  private arm(toolId: ToolId, entry: ToolEntry) {
    this.clearTimer(entry);
    if (!this.config.enabled) return;
    const delayMs = Math.max(1, this.config.escalateAfterSeconds) * 1000;
    entry.escalated = false;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.escalate(toolId, entry);
    }, delayMs);
    entry.timer.unref?.();
    logger.debug(`[Attention] armed ${toolId} for ${this.config.escalateAfterSeconds}s`);
  }

  private async escalate(toolId: ToolId, entry: ToolEntry) {
    // Re-check the guards: config may have been disabled, or the tool may have
    // left waiting in a race with the timer.
    if (this.stopped || !this.config.enabled || entry.lastState !== 'waiting') return;
    entry.escalated = true;

    const label = TOOL_META[toolId]?.label ?? toolId;
    logger.info(`[Attention] escalating ${toolId} (waited ${this.config.escalateAfterSeconds}s)`);

    if (this.config.intensifyBubble) this.broadcastEscalate(toolId);

    const title = `${label} needs your input`;
    const bodyParts: string[] = [];
    if (entry.task) bodyParts.push(entry.task);
    bodyParts.push(`Idle for ${this.config.escalateAfterSeconds}s`);
    const body = bodyParts.join(' · ');

    // Fire webhooks (fire-and-forget; each swallows its own errors).
    for (const target of this.config.webhooks) {
      if (!target.enabled) continue;
      void sendWebhook(target, { title, body, accentColor: ATTENTION_ACCENT });
    }

    if (this.config.osNotification) {
      try {
        new Notification({ title, body, silent: false }).show();
      } catch (err) {
        logger.warn('[Attention] OS notification failed:', err);
      }
    }
  }

  private acknowledge(toolId: ToolId) {
    const entry = this.entries.get(toolId);
    if (!entry) return;
    this.clearTimer(entry);
    if (entry.escalated) {
      entry.escalated = false;
      this.broadcastClear(toolId);
    }
    logger.debug(`[Attention] acknowledged ${toolId}`);
  }

  private clearTimer(entry: ToolEntry) {
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
  }

  private broadcastEscalate(toolId: ToolId) {
    this.send('attention:escalate', { toolId });
  }

  private broadcastClear(toolId: ToolId) {
    this.send('attention:clear', { toolId });
  }

  private send(channel: string, payload: unknown) {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }
}

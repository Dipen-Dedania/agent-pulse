import React, { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { ToolId, AgentState, ToolStatus, UsageStatus, UsageWindow, CodexUsageStatus, AntigravityUsageStatus, AntigravityModelWindow, SchedulerStatus, BubbleSize, BubbleSoundId, BubbleConfig, BubbleFillMode, BubbleTooltipPayload } from '../../../common/types';
import { GuardrailEvent } from '../../../common/guardrails';
import { TOOL_META } from '../../../common/toolMeta';
import { colorsFor } from '../../../common/stateColors';
import { logger } from '../../../common/logger';
import { motion } from 'framer-motion';
import { useStatusStore } from '../../store/useStatusStore';
import { playBubbleSound } from '../../sound';

// Orb/icon/ring pixel sizes per bubble size, plus the usage-bar geometry
// (width / thickness / inter-bar gap) so the bars scale in step with the orb.
// The window footprint is set in the main process
// (BubbleManager.BUBBLE_DIMENSIONS); these scale the visuals to fit.
interface BubbleDims {
  orb: number;
  icon: number;
  ring: number;
  bar: { width: number; height: number; gap: number };
}
const ORB_DIMENSIONS: Record<BubbleSize, BubbleDims> = {
  small: { orb: 38, icon: 19, ring: 46, bar: { width: 40, height: 2, gap: 2 } },
  medium: { orb: 48, icon: 24, ring: 56, bar: { width: 50, height: 3, gap: 2 } },
  large: { orb: 60, icon: 30, ring: 70, bar: { width: 64, height: 4, gap: 3 } },
};


interface BubbleProps {
  toolId: ToolId;
}

function useDarkMode() {
  const [isDark, setIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDark;
}

function formatLastSeen(ts: number | undefined): string {
  if (!ts) return 'Never';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 5) return 'Just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function formatRelativeReset(targetMs: number | undefined): string {
  if (!targetMs) return '—';
  const diff = targetMs - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) {
    const remMins = mins % 60;
    return remMins > 0 ? `in ${hours}h ${remMins}m` : `in ${hours}h`;
  }
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

// Compact scheduler glance for the usage tooltip. Prefers the live window's
// remaining time; falls back to the next scheduled opener/nudge. Returns
// undefined when the scheduler is idle with nothing to show.
function schedulerGlance(status: SchedulerStatus | null): string | undefined {
  if (!status) return undefined;
  if (status.windowResetsAt && status.windowResetsAt > Date.now()) {
    return `Window resets ${formatRelativeReset(status.windowResetsAt)}`;
  }
  if (status.nextFireAt) {
    const clock = new Date(status.nextFireAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const label = status.nextEventKind === 'nudge' ? 'Token refresh' : 'Next window';
    return `${label} ${clock}`;
  }
  return undefined;
}

function fillColorForRemaining(remaining: number, isDark: boolean): string {
  // Bar reads as an "opportunity gauge": full bar = lots of credit left.
  // Green when plenty remains, amber as it depletes, red when nearly out.
  if (remaining > 50) {
    return isDark ? 'rgba(34,197,94,0.7)' : 'rgba(22,163,74,0.6)';
  }
  if (remaining > 20) {
    return isDark ? 'rgba(245,158,11,0.75)' : 'rgba(217,119,6,0.65)';
  }
  return isDark ? 'rgba(239,68,68,0.8)' : 'rgba(220,38,38,0.7)';
}

// ── Tooltip line builders ─────────────────────────────────────────────────
// Produce the human-readable lines shown in the rich hover tooltip. Kept as
// module functions (rather than inline in the bar components) so the Bubble
// can assemble one consolidated tooltip card per tool.

function claudeTooltipLines(status: UsageStatus, showSevenDay: boolean, schedulerLine?: string): string[] {
  const lines: string[] = [];
  if (status.state === 'ok' && status.snapshot) {
    const { fiveHour, sevenDay } = status.snapshot;
    lines.push(`5h · ${100 - fiveHour.utilization}% left · resets ${formatRelativeReset(fiveHour.resetsAt)}`);
    if (showSevenDay) {
      lines.push(`7d · ${100 - sevenDay.utilization}% left · resets ${formatRelativeReset(sevenDay.resetsAt)}`);
    }
  } else {
    lines.push(status.message ?? `Claude usage: ${status.state}`);
  }
  if (schedulerLine) lines.push(schedulerLine);
  return lines;
}

function codexTooltipLines(status: CodexUsageStatus): string[] {
  if (status.state === 'ok' && status.snapshot) {
    const { primary, secondary } = status.snapshot;
    const lines = [`Weekly · ${100 - primary.utilization}% left · resets ${formatRelativeReset(primary.resetsAt)}`];
    if (secondary) {
      lines.push(`Secondary · ${100 - secondary.utilization}% left · resets ${formatRelativeReset(secondary.resetsAt)}`);
    }
    return lines;
  }
  return [status.message ?? `Codex usage: ${status.state}`];
}

function antigravityTooltipLines(status: AntigravityUsageStatus, visible: AntigravityModelWindow[]): string[] {
  if (status.state === 'ok' && visible.length > 0) {
    return visible.map((m) => `${m.displayName} · ${Math.round(100 - m.utilization)}% · resets ${formatRelativeReset(m.resetsAt)}`);
  }
  if (status.state === 'ok') return ['No gated quotas reported.'];
  return [status.message ?? `Antigravity usage: ${status.state}`];
}

// Pick the two Antigravity models surfaced on the bubble. Shared by the bars
// and the tooltip so both stay in sync.
function visibleAntigravityModels(status: AntigravityUsageStatus): AntigravityModelWindow[] {
  if (status.state !== 'ok' || !status.snapshot) return [];
  return BUBBLE_MODEL_MATCHERS
    .map((re) => status.snapshot!.models.find((m) => re.test(m.displayName) || re.test(m.modelKey)))
    .filter((m): m is AntigravityModelWindow => !!m);
}

interface BarDims { width: number; height: number; gap: number }

interface UsageBarsProps {
  status: UsageStatus;
  isDark: boolean;
  showSevenDay: boolean;
  bar: BarDims;
}

const UsageBars: React.FC<UsageBarsProps> = ({ status, isDark, showSevenDay, bar }) => {
  const isOk = status.state === 'ok' && !!status.snapshot;
  const fiveHour: UsageWindow | undefined = status.snapshot?.fiveHour;
  const sevenDay: UsageWindow | undefined = status.snapshot?.sevenDay;

  const trackColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const inactiveFill = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';

  // Bar fill represents REMAINING credit, not consumed credit — so a full
  // green bar = lots of headroom left, an empty red bar = nearly out.
  const renderBar = (window: UsageWindow | undefined) => {
    const remaining = isOk && window ? 100 - window.utilization : 0;
    const fill = isOk && window ? fillColorForRemaining(remaining, isDark) : inactiveFill;
    const widthPct = isOk && window ? Math.max(2, Math.min(100, remaining)) : 0;
    return (
      <div
        className='relative rounded-full overflow-hidden'
        style={{ width: bar.width, height: bar.height, background: trackColor }}
      >
        {widthPct > 0 && (
          <div
            className='absolute left-0 top-0 h-full rounded-full transition-all duration-500'
            style={{ width: `${widthPct}%`, background: fill }}
          />
        )}
      </div>
    );
  };

  return (
    <div
      className='flex flex-col items-center mt-1 pointer-events-auto'
      style={{ gap: bar.gap }}
    >
      {renderBar(fiveHour)}
      {showSevenDay && renderBar(sevenDay)}
    </div>
  );
};

interface CodexUsageBarsProps {
  status: CodexUsageStatus;
  isDark: boolean;
  bar: BarDims;
}

const CodexUsageBars: React.FC<CodexUsageBarsProps> = ({ status, isDark, bar }) => {
  const isOk = status.state === 'ok' && !!status.snapshot;
  const primary = status.snapshot?.primary;
  const secondary = status.snapshot?.secondary;

  const trackColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const inactiveFill = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';

  const renderBar = (window: UsageWindow | undefined) => {
    const remaining = isOk && window ? 100 - window.utilization : 0;
    const fill = isOk && window ? fillColorForRemaining(remaining, isDark) : inactiveFill;
    const widthPct = isOk && window ? Math.max(2, Math.min(100, remaining)) : 0;
    return (
      <div
        className='relative rounded-full overflow-hidden'
        style={{ width: bar.width, height: bar.height, background: trackColor }}
      >
        {widthPct > 0 && (
          <div
            className='absolute left-0 top-0 h-full rounded-full transition-all duration-500'
            style={{ width: `${widthPct}%`, background: fill }}
          />
        )}
      </div>
    );
  };

  return (
    <div
      className='flex flex-col items-center mt-1 pointer-events-auto'
      style={{ gap: bar.gap }}
    >
      {renderBar(primary)}
      {secondary && renderBar(secondary)}
    </div>
  );
};

// The Antigravity bubble surfaces exactly two models — the ones the user
// cares about day-to-day. Matched against displayName (and modelKey as a
// fallback) case-insensitively so format drift on either side won't drop
// a bar silently.
const BUBBLE_MODEL_MATCHERS: Array<RegExp> = [
  /claude\s+opus\s+4\.6/i,
  /gemini\s+3\.5\s+flash\s*\(\s*high\s*\)/i,
];

interface AntigravityUsageBarsProps {
  status: AntigravityUsageStatus;
  isDark: boolean;
  bar: BarDims;
}

const AntigravityUsageBars: React.FC<AntigravityUsageBarsProps> = ({ status, isDark, bar }) => {
  const isOk = status.state === 'ok' && !!status.snapshot;
  const visible = visibleAntigravityModels(status);

  const trackColor = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const inactiveFill = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';

  const renderBar = (model: AntigravityModelWindow | undefined) => {
    const remaining = isOk && model ? 100 - model.utilization : 0;
    const fill = isOk && model ? fillColorForRemaining(remaining, isDark) : inactiveFill;
    const widthPct = isOk && model ? Math.max(2, Math.min(100, remaining)) : 0;
    return (
      <div
        key={model?.modelKey ?? '_'}
        className='relative rounded-full overflow-hidden'
        style={{ width: bar.width, height: bar.height, background: trackColor }}
      >
        {widthPct > 0 && (
          <div
            className='absolute left-0 top-0 h-full rounded-full transition-all duration-500'
            style={{ width: `${widthPct}%`, background: fill }}
          />
        )}
      </div>
    );
  };

  // When OK but empty, render one placeholder bar so the bubble height
  // stays consistent with other tools' usage display.
  const bars = isOk && visible.length === 0 ? [undefined] : visible;

  return (
    <div
      className='flex flex-col items-center mt-1 pointer-events-auto'
      style={{ gap: bar.gap }}
    >
      {bars.map((m) => renderBar(m))}
    </div>
  );
};

export const Bubble: React.FC<BubbleProps> = ({ toolId }) => {
  const status = useStatusStore((state) => state.statuses[toolId]);
  const updateStatus = useStatusStore((state) => state.updateStatus);
  const state = status?.state || 'idle';
  const isDark = useDarkMode();
  const meta = TOOL_META[toolId];
  const [hovered, setHovered] = useState(false);
  const [usageStatus, setUsageStatus] = useState<UsageStatus>({ state: 'unknown' });
  const [showSevenDay, setShowSevenDay] = useState(true);
  const [codexUsageStatus, setCodexUsageStatus] = useState<CodexUsageStatus>({ state: 'unknown' });
  const [antigravityUsageStatus, setAntigravityUsageStatus] = useState<AntigravityUsageStatus>({ state: 'unknown' });
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [bubbleSize, setBubbleSize] = useState<BubbleSize>('medium');
  const [bubbleSound, setBubbleSound] = useState<BubbleSoundId>('pop');
  const [fillMode, setFillMode] = useState<BubbleFillMode>('glass');
  const [fillColor, setFillColor] = useState<string>('#ffffff');

  // Pull bubble appearance/behavior prefs on mount and stay in sync with live
  // edits from Settings. Every bubble listens so size/sound/fill changes apply
  // without recreating the window.
  useEffect(() => {
    const applyBubble = (b?: Partial<BubbleConfig>) => {
      if (!b) return;
      if (b.size) setBubbleSize(b.size);
      if (b.sound) setBubbleSound(b.sound);
      if (b.fillMode) setFillMode(b.fillMode);
      if (b.fillColor) setFillColor(b.fillColor);
    };

    window.electron
      .invoke('get-config')
      .then((cfg: { bubble?: Partial<BubbleConfig> } | null) => applyBubble(cfg?.bubble))
      .catch((e: unknown) => logger.debug(`[Bubble:${toolId}] get-config (bubble) failed`, e));

    const handler = (_event: unknown, cfg: Partial<BubbleConfig>) => applyBubble(cfg);
    window.electron.on('bubble:config-updated', handler);
    return () => window.electron.off('bubble:config-updated', handler);
  }, [toolId]);

  // Subscribe to usage updates. Only meaningful for the Claude bubble, but
  // we listen in every renderer so the IPC channel doesn't depend on bubble
  // identity. Unused snapshots are cheap.
  useEffect(() => {
    if (toolId !== 'claude-code') return;
    window.electron
      .invoke('usage:get-current')
      .then((s: UsageStatus) => setUsageStatus(s))
      .catch((e: unknown) => logger.debug(`[Bubble:${toolId}] usage:get-current failed`, e));

    // Pull initial config so the bar visibility matches saved prefs on bubble launch.
    window.electron
      .invoke('get-config')
      .then((cfg: { usage?: { showSevenDayBar?: boolean } } | null) => {
        if (cfg?.usage && typeof cfg.usage.showSevenDayBar === 'boolean') {
          setShowSevenDay(cfg.usage.showSevenDayBar);
        }
      })
      .catch((e: unknown) => logger.debug(`[Bubble:${toolId}] get-config failed`, e));

    const handler = (_event: unknown, incoming: UsageStatus) => {
      setUsageStatus(incoming);
    };
    const configHandler = (_event: unknown, cfg: { showSevenDayBar?: boolean }) => {
      if (typeof cfg?.showSevenDayBar === 'boolean') setShowSevenDay(cfg.showSevenDayBar);
    };
    window.electron.on('usage:updated', handler);
    window.electron.on('usage:config-updated', configHandler);
    return () => {
      window.electron.off('usage:updated', handler);
      window.electron.off('usage:config-updated', configHandler);
    };
  }, [toolId]);

  // Codex usage — only meaningful for the openai-codex bubble.
  useEffect(() => {
    if (toolId !== 'openai-codex') return;
    window.electron
      .invoke('codex-usage:get-current')
      .then((s: CodexUsageStatus) => setCodexUsageStatus(s))
      .catch((e: unknown) => logger.debug(`[Bubble:${toolId}] codex-usage:get-current failed`, e));

    const handler = (_event: unknown, incoming: CodexUsageStatus) => {
      setCodexUsageStatus(incoming);
    };
    window.electron.on('codex-usage:updated', handler);
    return () => {
      window.electron.off('codex-usage:updated', handler);
    };
  }, [toolId]);

  // Antigravity usage — only meaningful for the antigravity-cli bubble.
  useEffect(() => {
    if (toolId !== 'antigravity-cli') return;
    window.electron
      .invoke('antigravity-usage:get-current')
      .then((s: AntigravityUsageStatus) => setAntigravityUsageStatus(s))
      .catch((e: unknown) => logger.debug(`[Bubble:${toolId}] antigravity-usage:get-current failed`, e));

    const handler = (_event: unknown, incoming: AntigravityUsageStatus) => {
      setAntigravityUsageStatus(incoming);
    };
    window.electron.on('antigravity-usage:updated', handler);
    return () => {
      window.electron.off('antigravity-usage:updated', handler);
    };
  }, [toolId]);

  // Scheduler window-state glance — only meaningful for the Claude bubble.
  useEffect(() => {
    if (toolId !== 'claude-code') return;
    window.electron
      .invoke('scheduler:get-current')
      .then((s: SchedulerStatus) => setSchedulerStatus(s))
      .catch((e: unknown) => logger.debug(`[Bubble:${toolId}] scheduler:get-current failed`, e));

    const handler = (_event: unknown, incoming: SchedulerStatus) => setSchedulerStatus(incoming);
    window.electron.on('scheduler:updated', handler);
    return () => {
      window.electron.off('scheduler:updated', handler);
    };
  }, [toolId]);

  useEffect(() => {
    logger.debug(`[Bubble:${toolId}] mounted href=${window.location.href}`);

    const onBeforeUnload = () => {
      logger.debug(`[Bubble:${toolId}] beforeunload`);
    };
    const onPageHide = (event: PageTransitionEvent) => {
      logger.debug(`[Bubble:${toolId}] pagehide persisted=${event.persisted}`);
    };
    const onVisibilityChange = () => {
      logger.debug(`[Bubble:${toolId}] visibilitychange hidden=${document.hidden}`);
    };
    const onError = (event: ErrorEvent) => {
      logger.error(
        `[Bubble:${toolId}] window error message="${event.message}" source="${event.filename}" line=${event.lineno} col=${event.colno}`,
      );
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      logger.error(`[Bubble:${toolId}] unhandledrejection`, event.reason);
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      logger.debug(`[Bubble:${toolId}] unmounted`);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [toolId]);

  // Subtle chime when the bubble flips into "waiting for input" so the user
  // can context-switch away without missing it. Tracks prior state to fire
  // only on the transition, never on the initial mount or re-renders. The
  // chime sound is user-selectable (see bubbleSound); 'none' is silent.
  const prevState = useRef<AgentState | null>(null);
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;
    if (prev === null || prev === 'waiting' || state !== 'waiting') return;
    playBubbleSound(bubbleSound);
  }, [state, bubbleSound]);

  // Hover drives the rich tooltip overlay (a separate window — see
  // TooltipManager). We only flip `hovered`; the payload + show/hide IPC is
  // handled by the effect below so the content stays live while hovering.
  const onMouseEnter = useCallback(() => setHovered(true), []);
  const onMouseLeave = useCallback(() => {
    setHovered(false);
    window.electron.send('tooltip:hide');
  }, []);

  // Make transparent areas of the window click-through (paused during drag)
  const isDragging = useRef(false);
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDragging.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const isOverContent =
        el !== null && el !== document.documentElement && el !== document.body;
      window.electron.send('set-ignore-mouse', { ignore: !isOverContent });
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  useEffect(() => {
    logger.debug(`[Bubble:${toolId}] Registering status-update listener`);
    const handler = (_event: any, incoming: ToolStatus) => {
      // console.log(`[Bubble:${toolId}] status-update received:`, incoming);
      if (incoming.toolId === toolId) {
        // console.log(
        //   `[Bubble:${toolId}] Applying state update: ${incoming.state}`,
        // );
        updateStatus(incoming);
      } else {
        // console.log(
        //   `[Bubble:${toolId}] Ignoring update for ${incoming.toolId}`,
        // );
      }
    };
    window.electron.on('status-update', handler);
    return () => {
      logger.debug(`[Bubble:${toolId}] Removing status-update listener`);
      window.electron.off('status-update', handler);
    };
  }, [toolId, updateStatus]);

  // Attention escalation — the main-process engine flips this on when the tool
  // has sat in "waiting" past the user's threshold, and off when it's
  // acknowledged or the agent moves on. Mirrors the guardrail listener below.
  const [escalated, setEscalated] = useState(false);
  useEffect(() => {
    const onEscalate = (_e: unknown, { toolId: id }: { toolId: ToolId }) => {
      if (id === toolId) setEscalated(true);
    };
    const onClear = (_e: unknown, { toolId: id }: { toolId: ToolId }) => {
      if (id === toolId) setEscalated(false);
    };
    window.electron.on('attention:escalate', onEscalate);
    window.electron.on('attention:clear', onClear);
    return () => {
      window.electron.off('attention:escalate', onEscalate);
      window.electron.off('attention:clear', onClear);
    };
  }, [toolId]);

  // Belt-and-suspenders: drop the local escalation the moment we leave waiting,
  // so the badge never lingers if the clear broadcast is missed.
  useEffect(() => {
    if (state !== 'waiting') setEscalated(false);
  }, [state]);

  // Guardrail signal — amber pulse for warn (~6s auto-fade), red dot for
  // block (persistent until the next event or click). Each bubble listens
  // independently and filters by toolId.
  const [guardrailSignal, setGuardrailSignal] = useState<GuardrailEvent | null>(null);
  useEffect(() => {
    const handler = (_e: unknown, evt: GuardrailEvent) => {
      if (evt.toolId !== toolId) return;
      setGuardrailSignal(evt);
      if (evt.decision === 'warn') {
        const t = window.setTimeout(() => setGuardrailSignal((cur) => (cur === evt ? null : cur)), 6000);
        return () => window.clearTimeout(t);
      }
    };
    window.electron.on('guardrail:event', handler);
    return () => window.electron.off('guardrail:event', handler);
  }, [toolId]);

  const dismissGuardrailSignal = useCallback(() => {
    setGuardrailSignal(null);
    window.electron.send('open-settings');
  }, []);

  const dragOrigin = useRef<{ x: number; y: number } | null>(null);

  // Pixels of movement required before a mousedown is treated as a drag.
  // Anything below this is considered a click → focus the tool window.
  const DRAG_THRESHOLD = 4;

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const startX = e.screenX;
    const startY = e.screenY;
    let hasDragged = false;

    dragOrigin.current = { x: startX, y: startY };
    isDragging.current = true;
    window.electron.send('set-ignore-mouse', { ignore: false });

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragOrigin.current) return;

      // Promote to drag once the pointer has moved beyond the threshold
      if (
        !hasDragged &&
        (Math.abs(ev.screenX - startX) > DRAG_THRESHOLD ||
          Math.abs(ev.screenY - startY) > DRAG_THRESHOLD)
      ) {
        hasDragged = true;
      }

      if (hasDragged) {
        const dx = ev.screenX - dragOrigin.current.x;
        const dy = ev.screenY - dragOrigin.current.y;
        dragOrigin.current = { x: ev.screenX, y: ev.screenY };
        window.electron.send('move-bubble', { dx, dy });
      }
    };

    const onMouseUp = () => {
      dragOrigin.current = null;
      isDragging.current = false;
      window.electron.send('set-ignore-mouse', { ignore: true });
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);

      // No meaningful movement → treat as a click, bring the tool to front.
      // Pass the latest known agent PID + ancestor chain so the main process
      // can walk up the process tree to the specific terminal/window hosting
      // this session, even when the immediate parent has already died.
      if (!hasDragged) {
        const status = useStatusStore.getState().statuses[toolId];
        const agentPid = status?.agentPid;
        const agentPidChain = status?.agentPidChain;
        logger.debug(
          `[Bubble:${toolId}] click detected, sending focus-tool pid=${agentPid ?? 'none'} chain=${agentPidChain ? agentPidChain.join(',') : 'none'
          }`,
        );
        window.electron.send('focus-tool', { toolId, agentPid, agentPidChain });
        // Clicking the bubble counts as "I've seen it" — clear any attention
        // escalation locally (instant) and tell the engine to stop/cancel.
        setEscalated(false);
        window.electron.send('attention:ack', { toolId });
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [toolId]);

  const { fill, glow, ring } = colorsFor(state, isDark);
  const borderColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.12)';
  const dims = ORB_DIMENSIONS[bubbleSize] ?? ORB_DIMENSIONS.medium;

  const animations: Record<AgentState, any> = {
    idle: {
      scale: [1, 1.04, 1],
      opacity: [0.45, 0.65, 0.45],
      transition: { duration: 5, repeat: Infinity, ease: 'easeInOut' },
    },
    'idle-active': {
      scale: [1, 1.05, 1],
      opacity: [0.7, 0.9, 0.7],
      transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
    },
    waiting: {
      opacity: [0.6, 1, 0.6],
      boxShadow: [
        `0 0 0px 0px ${glow}`,
        `0 0 8px 4px ${glow}`,
        `0 0 0px 0px ${glow}`,
      ],
      transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
    },
    working: {
      scale: [1, 1.06, 1],
      boxShadow: [
        `0 0 0px 0px ${glow}`,
        `0 0 8px 6px ${glow}`,
        `0 0 0px 0px ${glow}`,
      ],
      transition: { duration: 1.8, repeat: Infinity, ease: 'easeInOut' },
    },
    error: {
      x: [0, -5, 5, -5, 5, 0],
      transition: { duration: 0.5, repeat: Infinity, repeatDelay: 2 },
    },
  };

  // Escalated "needs you" variant — a faster, larger, bobbing pulse that reads
  // as more urgent than the calm waiting breath. Only used while still waiting.
  const escalatedAnimation = {
    y: [0, -3, 0],
    boxShadow: [
      `0 0 2px 1px ${glow}`,
      `0 0 14px 7px ${glow}`,
      `0 0 2px 1px ${glow}`,
    ],
    transition: { duration: 0.8, repeat: Infinity, ease: 'easeInOut' },
  };
  const isEscalated = escalated && state === 'waiting';
  const activeAnimation = isEscalated ? escalatedAnimation : animations[state];

  const stateLabel: Record<AgentState, string> = {
    idle: 'Idle',
    'idle-active': 'Idle',
    waiting: 'Waiting',
    working: 'Working',
    error: 'Error',
  };

  // Assemble the consolidated tooltip card content for this tool.
  const tooltipPayload = useMemo<BubbleTooltipPayload>(() => {
    const subtitle: string[] = [stateLabel[state]];
    if (status?.activeAgents && status.activeAgents > 0) {
      subtitle.push(`${status.activeAgents} agent${status.activeAgents > 1 ? 's' : ''}`);
    }
    subtitle.push(formatLastSeen(status?.lastUpdated));

    const lines: string[] = [];
    if (toolId === 'claude-code') {
      lines.push(...claudeTooltipLines(usageStatus, showSevenDay));
    } else if (toolId === 'openai-codex') {
      lines.push(...codexTooltipLines(codexUsageStatus));
    } else if (toolId === 'antigravity-cli') {
      lines.push(...antigravityTooltipLines(antigravityUsageStatus, visibleAntigravityModels(antigravityUsageStatus)));
    }
    if (status?.currentTask) lines.unshift(status.currentTask);

    return { title: meta.label, subtitle: subtitle.join(' · '), lines, accent: glow };
  }, [toolId, state, status?.activeAgents, status?.lastUpdated, status?.currentTask, usageStatus, codexUsageStatus, antigravityUsageStatus, schedulerStatus, showSevenDay, meta.label, glow]);

  // Push fresh content to the overlay while hovering (so usage updates show
  // live); the show/position/visibility is handled by the main process.
  useEffect(() => {
    if (!hovered) return;
    window.electron.send('tooltip:show', tooltipPayload);
  }, [hovered, tooltipPayload]);

  // Heartbeat while hovering: pings keep the overlay alive (resetting its
  // watchdog), and the cleanup guarantees a hide when the pointer leaves OR
  // the bubble unmounts (e.g. the tool is toggled off) without a mouseleave.
  useEffect(() => {
    if (!hovered) return;
    const heartbeat = window.setInterval(() => {
      window.electron.send('tooltip:ping');
    }, 1500);
    return () => {
      window.clearInterval(heartbeat);
      window.electron.send('tooltip:hide');
    };
  }, [hovered]);

  // The main process owns the authoritative hover check (it polls the real
  // cursor against this bubble's rect, since DOM mouseleave is unreliable on
  // the tiny click-through window). When it dismisses, clear our hover state
  // so the heartbeat stops and we don't re-show on the next content update.
  useEffect(() => {
    const handler = () => setHovered(false);
    window.electron.on('tooltip:dismissed', handler);
    return () => window.electron.off('tooltip:dismissed', handler);
  }, []);

  return (
    <div
      className='flex flex-col items-center justify-end h-full w-full pb-2'
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <motion.div
        onMouseDown={onMouseDown}
        animate={activeAnimation}
        className='relative rounded-full flex items-center justify-center cursor-pointer select-none shrink-0'
        style={{
          width: dims.orb,
          height: dims.orb,
          marginTop: '5px',
          // Solid fill paints an opaque backdrop so logos stay legible over busy
          // desktops; glass keeps the frosted, state-tinted gradient. The
          // state-color glow (boxShadow animation) still reads in both modes.
          background:
            fillMode === 'solid'
              ? fillColor
              : `radial-gradient(circle, ${fill} 0%, rgba(128,128,128,0.06) 100%)`,
          backdropFilter: fillMode === 'solid' ? undefined : 'blur(14px)',
          WebkitBackdropFilter: fillMode === 'solid' ? undefined : 'blur(14px)',
          border: `1.5px solid ${borderColor}`,
          boxShadow: isDark
            ? '0 8px 8px 0 rgba(0,0,0,0.4)'
            : '0 4px 16px 0 rgba(0,0,0,0.15)',
        }}
      >
        <img
          src={meta.icon}
          alt={meta.label}
          draggable={false}
          className='object-contain'
          style={{
            width: dims.icon,
            height: dims.icon,
            filter: isDark ? 'none' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))',
          }}
        />

        {/* Orbiting ring – waiting state (slow dots) */}
        {state === 'waiting' && ring && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            className='absolute rounded-full'
            style={{ width: dims.ring, height: dims.ring, border: `2px dotted ${ring}` }}
          />
        )}

        {/* Orbiting ring – working state (fast dashes) */}
        {state === 'working' && ring && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
            className='absolute rounded-full'
            style={{ width: dims.ring, height: dims.ring, border: `2px dashed ${ring}` }}
          />
        )}

        {/* Attention escalation — warm-orange ring + bell badge when the tool
            has waited on the user past the threshold. Distinct from the teal
            nudge badge and amber/red guardrail ring. */}
        {isEscalated && (
          <motion.div
            animate={{
              opacity: [0.5, 1, 0.5],
              boxShadow: [
                '0 0 0px 0px rgba(249,115,22,0.0)',
                '0 0 12px 5px rgba(249,115,22,0.75)',
                '0 0 0px 0px rgba(249,115,22,0.0)',
              ],
            }}
            transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
            className='absolute rounded-full pointer-events-none'
            style={{
              width: dims.ring + 4,
              height: dims.ring + 4,
              border: `2px solid ${isDark ? 'rgba(249,115,22,0.9)' : 'rgba(234,88,12,0.9)'}`,
            }}
          />
        )}
        {isEscalated && (
          <div
            className='absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center'
            style={{
              background: isDark ? 'rgba(249,115,22,0.95)' : 'rgba(234,88,12,0.95)',
              boxShadow: isDark ? '0 0 8px rgba(249,115,22,0.7)' : '0 0 6px rgba(234,88,12,0.5)',
            }}
            title='Waiting on you'
          >
            <svg viewBox='0 0 24 24' className='w-2.5 h-2.5' fill='white'>
              <path d='M12 2a6 6 0 0 0-6 6v3.6L4.3 15a1 1 0 0 0 .9 1.4h13.6a1 1 0 0 0 .9-1.4L18 11.6V8a6 6 0 0 0-6-6zm0 20a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22z' />
            </svg>
          </div>
        )}

        {/* Error dot */}
        {state === 'error' && (
          <div
            className='absolute -top-1 -right-1 w-3 h-3 rounded-full'
            style={{
              background: isDark ? '#ef4444' : '#dc2626',
              boxShadow: `0 0 6px ${glow}`,
            }}
          />
        )}

        {/* Guardrail ring — amber pulse on warn, solid red on block. Sits
            outside the orb so it doesn't fight the working/waiting orbits. */}
        {guardrailSignal && (
          <motion.div
            animate={
              guardrailSignal.decision === 'block'
                ? { opacity: 1 }
                : {
                  opacity: [0.4, 1, 0.4],
                  boxShadow: [
                    '0 0 0px 0px rgba(245,158,11,0.0)',
                    '0 0 10px 4px rgba(245,158,11,0.7)',
                    '0 0 0px 0px rgba(245,158,11,0.0)',
                  ],
                }
            }
            transition={
              guardrailSignal.decision === 'block'
                ? { duration: 0.2 }
                : { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
            }
            className='absolute rounded-full pointer-events-none'
            style={{
              width: dims.ring + 2,
              height: dims.ring + 2,
              border: `2px solid ${guardrailSignal.decision === 'block'
                ? (isDark ? 'rgba(239,68,68,0.95)' : 'rgba(220,38,38,0.95)')
                : (isDark ? 'rgba(245,158,11,0.85)' : 'rgba(217,119,6,0.85)')
                }`,
            }}
          />
        )}

        {/* Guardrail badge — click opens Settings (where the events log is). */}
        {guardrailSignal && (
          <button
            onClick={(e) => { e.stopPropagation(); dismissGuardrailSignal(); }}
            className='absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center cursor-pointer'
            style={{
              background: guardrailSignal.decision === 'block'
                ? (isDark ? 'rgba(239,68,68,0.95)' : 'rgba(220,38,38,0.95)')
                : (isDark ? 'rgba(245,158,11,0.95)' : 'rgba(217,119,6,0.95)'),
              boxShadow: guardrailSignal.decision === 'block'
                ? '0 0 6px rgba(239,68,68,0.8)'
                : '0 0 6px rgba(245,158,11,0.7)',
            }}
            title={`${guardrailSignal.decision === 'block' ? 'Blocked' : 'Warning'}: ${guardrailSignal.matched.map(m => m.message).join(' | ')}`}
          >
            <span className='text-white text-[9px] font-bold leading-none'>!</span>
          </button>
        )}

        {/* Use-it-or-lose-it nudge badge — only on the Claude bubble, only when
            either window has unused credit + an imminent reset. Distinct teal
            colour to avoid colliding with the green/amber/red bar palette and
            the working/waiting state animations. */}
        {toolId === 'claude-code' &&
          (usageStatus.nudgeActive?.fiveHour || usageStatus.nudgeActive?.sevenDay) && (
            <div
              className='absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center'
              style={{
                background: isDark ? 'rgba(20,184,166,0.95)' : 'rgba(13,148,136,0.95)',
                boxShadow: isDark
                  ? '0 0 8px rgba(20,184,166,0.7)'
                  : '0 0 6px rgba(13,148,136,0.5)',
              }}
              title='Unused Claude credit about to reset'
            >
              <svg viewBox='0 0 24 24' className='w-2.5 h-2.5' fill='white'>
                <path d='M13 2L4.09 13.6h7.41L11 22l8.91-11.6h-7.41L13 2z' />
              </svg>
            </div>
          )}

        {/* Same use-it-or-lose-it badge for the Codex bubble. */}
        {toolId === 'openai-codex' &&
          (codexUsageStatus.nudgeActive?.primary || codexUsageStatus.nudgeActive?.secondary) && (
            <div
              className='absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center'
              style={{
                background: isDark ? 'rgba(20,184,166,0.95)' : 'rgba(13,148,136,0.95)',
                boxShadow: isDark
                  ? '0 0 8px rgba(20,184,166,0.7)'
                  : '0 0 6px rgba(13,148,136,0.5)',
              }}
              title='Unused Codex credit about to reset'
            >
              <svg viewBox='0 0 24 24' className='w-2.5 h-2.5' fill='white'>
                <path d='M13 2L4.09 13.6h7.41L11 22l8.91-11.6h-7.41L13 2z' />
              </svg>
            </div>
          )}

        {/* Antigravity nudge — active when ANY model is about to reset with
            unused quota above the threshold. */}
        {toolId === 'antigravity-cli' &&
          antigravityUsageStatus.nudgeActive &&
          Object.values(antigravityUsageStatus.nudgeActive).some(Boolean) && (
            <div
              className='absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center'
              style={{
                background: isDark ? 'rgba(20,184,166,0.95)' : 'rgba(13,148,136,0.95)',
                boxShadow: isDark
                  ? '0 0 8px rgba(20,184,166,0.7)'
                  : '0 0 6px rgba(13,148,136,0.5)',
              }}
              title='Unused Antigravity credit about to reset'
            >
              <svg viewBox='0 0 24 24' className='w-2.5 h-2.5' fill='white'>
                <path d='M13 2L4.09 13.6h7.41L11 22l8.91-11.6h-7.41L13 2z' />
              </svg>
            </div>
          )}
      </motion.div>

      {/* Claude subscription usage bars — only rendered for the Claude bubble.
          Sits below the orb; window height was sized to fit (see BUBBLE_HEIGHT). */}
      {toolId === 'claude-code' && (
        <UsageBars
          status={usageStatus}
          isDark={isDark}
          showSevenDay={showSevenDay}
          bar={dims.bar}
        />
      )}

      {/* Codex subscription usage bars — only rendered for the Codex bubble. */}
      {toolId === 'openai-codex' && (
        <CodexUsageBars status={codexUsageStatus} isDark={isDark} bar={dims.bar} />
      )}

      {/* Antigravity per-model usage bars — only rendered for the Antigravity bubble. */}
      {toolId === 'antigravity-cli' && (
        <AntigravityUsageBars status={antigravityUsageStatus} isDark={isDark} bar={dims.bar} />
      )}
    </div>
  );
};

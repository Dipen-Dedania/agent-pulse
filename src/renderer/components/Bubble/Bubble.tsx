import React, { useRef, useCallback, useEffect, useState } from 'react';
import { ToolId, AgentState, ToolStatus, UsageStatus, UsageWindow, CodexUsageStatus } from '../../../common/types';
import { GuardrailEvent } from '../../../common/guardrails';
import { TOOL_META } from '../../../common/toolMeta';
import { colorsFor } from '../../../common/stateColors';
import { logger } from '../../../common/logger';
import { motion } from 'framer-motion';
import { useStatusStore } from '../../store/useStatusStore';

// TODO: re-enable once tooltip flicker & width-growth are fixed
const TOOLTIP_ENABLED = false;

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
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
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

interface UsageBarsProps {
  status: UsageStatus;
  isDark: boolean;
  showSevenDay: boolean;
}

const UsageBars: React.FC<UsageBarsProps> = ({ status, isDark, showSevenDay }) => {
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
        style={{ width: 50, height: 3, background: trackColor }}
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

  const tooltip = isOk && fiveHour && sevenDay
    ? showSevenDay
      ? `5h: ${100 - fiveHour.utilization}% available · resets ${formatRelativeReset(fiveHour.resetsAt)}\n7d: ${100 - sevenDay.utilization}% available · resets ${formatRelativeReset(sevenDay.resetsAt)}`
      : `5h: ${100 - fiveHour.utilization}% available · resets ${formatRelativeReset(fiveHour.resetsAt)}`
    : status.message ?? `Claude usage: ${status.state}`;

  return (
    <div
      className='flex flex-col items-center gap-[2px] mt-1 pointer-events-auto'
      title={tooltip}
    >
      {renderBar(fiveHour)}
      {showSevenDay && renderBar(sevenDay)}
    </div>
  );
};

interface CodexUsageBarsProps {
  status: CodexUsageStatus;
  isDark: boolean;
}

const CodexUsageBars: React.FC<CodexUsageBarsProps> = ({ status, isDark }) => {
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
        style={{ width: 50, height: 3, background: trackColor }}
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

  const tooltip = isOk && primary
    ? secondary
      ? `Primary: ${100 - primary.utilization}% available · resets ${formatRelativeReset(primary.resetsAt)}\nSecondary: ${100 - secondary.utilization}% available · resets ${formatRelativeReset(secondary.resetsAt)}`
      : `Weekly: ${100 - primary.utilization}% available · resets ${formatRelativeReset(primary.resetsAt)}`
    : status.message ?? `Codex usage: ${status.state}`;

  return (
    <div
      className='flex flex-col items-center gap-[2px] mt-1 pointer-events-auto'
      title={tooltip}
    >
      {renderBar(primary)}
      {secondary && renderBar(secondary)}
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
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [usageStatus, setUsageStatus] = useState<UsageStatus>({ state: 'unknown' });
  const [showSevenDay, setShowSevenDay] = useState(true);
  const [codexUsageStatus, setCodexUsageStatus] = useState<CodexUsageStatus>({ state: 'unknown' });

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
  // only on the transition, never on the initial mount or re-renders.
  const prevState = useRef<AgentState | null>(null);
  const chimeRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const audio = new Audio('./media/pop.wav');
    audio.volume = 0.4;
    audio.preload = 'auto';
    audio.addEventListener('error', () => {
      logger.warn(`[Bubble:${toolId}] chime failed to load`, audio.error);
    });
    audio.addEventListener('canplaythrough', () => {
      // console.log(`[Bubble:${toolId}] chime ready`);
    });
    chimeRef.current = audio;
    audio.load();
  }, [toolId]);
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;
    if (prev === null || prev === 'waiting' || state !== 'waiting') return;
    const audio = chimeRef.current;
    if (!audio) return;
    // console.log(`[Bubble:${toolId}] playing chime (${prev} → waiting)`);
    audio.currentTime = 0;
    const result = audio.play();
    if (result && typeof result.then === 'function') {
      // result.then(
      //   () => console.log(`[Bubble:${toolId}] chime started`),
      //   (err) => console.warn(`[Bubble:${toolId}] chime play() rejected`, err),
      // );
    }
  }, [state, toolId]);

  const onMouseEnter = useCallback(() => {
    if (!TOOLTIP_ENABLED) return;
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    setHovered(true);
    window.electron.send('bubble-hover', { hovered: true });
  }, []);

  const onMouseLeave = useCallback(() => {
    if (!TOOLTIP_ENABLED) return;
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      setHovered(false);
      window.electron.send('bubble-hover', { hovered: false });
    }, 120);
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

      // No meaningful movement → treat as a click, bring the tool to front
      if (!hasDragged) {
        logger.debug(`[Bubble:${toolId}] click detected, sending focus-tool`);
        window.electron.send('focus-tool', { toolId });
      }
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [toolId]);

  const { fill, glow, ring } = colorsFor(state, isDark);
  const borderColor = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.12)';

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

  const stateLabel: Record<AgentState, string> = {
    idle: 'Idle',
    'idle-active': 'Idle',
    waiting: 'Waiting',
    working: 'Working',
    error: 'Error',
  };

  return (
    <div
      className='flex flex-col items-center justify-end h-full w-full pb-2'
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Tooltip — occupies the top portion when window expands */}
      {TOOLTIP_ENABLED && (
        <motion.div
          initial={false}
          animate={{ opacity: hovered ? 1 : 0, y: hovered ? 0 : 6 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className='w-full px-2 mb-2 pointer-events-none'
          style={{ minHeight: 0 }}
        >
          <div
            className='rounded-xl px-3 py-2 text-left'
            style={{
              background: isDark
                ? 'rgba(15,15,20,0.82)'
                : 'rgba(255,255,255,0.82)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
              boxShadow: isDark
                ? '0 4px 20px rgba(0,0,0,0.5)'
                : '0 4px 20px rgba(0,0,0,0.12)',
            }}
          >
            <p
              className='text-[11px] font-semibold leading-tight truncate'
              style={{
                color: isDark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)',
              }}
            >
              {meta.label}
            </p>
            <p
              className='text-[10px] mt-0.5'
              style={{
                color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)',
              }}
            >
              {stateLabel[state]}
              {status?.activeAgents
                ? ` · ${status.activeAgents} agent${status.activeAgents > 1 ? 's' : ''}`
                : ''}
            </p>
            {status?.currentTask && (
              <p
                className='text-[10px] mt-1 truncate'
                style={{
                  color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)',
                }}
              >
                {status.currentTask}
              </p>
            )}
            <p
              className='text-[9px] mt-1'
              style={{
                color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)',
              }}
            >
              {formatLastSeen(status?.lastUpdated)}
            </p>
          </div>
        </motion.div>
      )}

      <motion.div
        onMouseDown={onMouseDown}
        animate={animations[state]}
        className='relative w-12 h-12 rounded-full flex items-center justify-center cursor-pointer select-none shrink-0'
        style={{
          marginTop: '5px',
          background: `radial-gradient(circle, ${fill} 0%, rgba(128,128,128,0.06) 100%)`,
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
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
          className='w-6 h-6 object-contain'
          style={{
            filter: isDark ? 'none' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))',
          }}
        />

        {/* Orbiting ring – waiting state (slow dots) */}
        {state === 'waiting' && ring && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            className='absolute w-[56px] h-[56px] rounded-full'
            style={{ border: `2px dotted ${ring}` }}
          />
        )}

        {/* Orbiting ring – working state (fast dashes) */}
        {state === 'working' && ring && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
            className='absolute w-[56px] h-[56px] rounded-full'
            style={{ border: `2px dashed ${ring}` }}
          />
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
            className='absolute w-[58px] h-[58px] rounded-full pointer-events-none'
            style={{
              border: `2px solid ${
                guardrailSignal.decision === 'block'
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
      </motion.div>

      {/* Claude subscription usage bars — only rendered for the Claude bubble.
          Sits below the orb; window height was sized to fit (see BUBBLE_HEIGHT). */}
      {toolId === 'claude-code' && (
        <UsageBars status={usageStatus} isDark={isDark} showSevenDay={showSevenDay} />
      )}

      {/* Codex subscription usage bars — only rendered for the Codex bubble. */}
      {toolId === 'openai-codex' && (
        <CodexUsageBars status={codexUsageStatus} isDark={isDark} />
      )}
    </div>
  );
};

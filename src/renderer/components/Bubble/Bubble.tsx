import React, { useRef, useCallback, useEffect, useState } from 'react';
import { ToolId, AgentState, ToolStatus } from '../../../common/types';
import { TOOL_META } from '../../../common/toolMeta';
import { motion } from 'framer-motion';
import { useStatusStore } from '../../store/useStatusStore';

// TODO: re-enable once tooltip flicker & width-growth are fixed
const TOOLTIP_ENABLED = false;

interface BubbleProps {
  toolId: ToolId;
}

function useDarkMode() {
  const [isDark, setIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
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
  if (secs < 5)  return 'Just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

export const Bubble: React.FC<BubbleProps> = ({ toolId }) => {
  const status = useStatusStore((state) => state.statuses[toolId]);
  const updateStatus = useStatusStore((state) => state.updateStatus);
  const state = status?.state || 'idle';
  const isDark = useDarkMode();
  const meta = TOOL_META[toolId];
  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      const isOverContent = el !== null && el !== document.documentElement && el !== document.body;
      window.electron.send('set-ignore-mouse', { ignore: !isOverContent });
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, []);

  useEffect(() => {
    console.log(`[Bubble:${toolId}] Registering status-update listener`);
    const handler = (_event: any, incoming: ToolStatus) => {
      console.log(`[Bubble:${toolId}] status-update received:`, incoming);
      if (incoming.toolId === toolId) {
        console.log(`[Bubble:${toolId}] Applying state update: ${incoming.state}`);
        updateStatus(incoming);
      } else {
        console.log(`[Bubble:${toolId}] Ignoring update for ${incoming.toolId}`);
      }
    };
    window.electron.on('status-update', handler);
    return () => {
      console.log(`[Bubble:${toolId}] Removing status-update listener`);
      window.electron.off('status-update', handler);
    };
  }, [toolId, updateStatus]);

  const dragOrigin = useRef<{ x: number; y: number } | null>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragOrigin.current = { x: e.screenX, y: e.screenY };
    isDragging.current = true;
    // Fully capture mouse during drag — stop click-through
    window.electron.send('set-ignore-mouse', { ignore: false });

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragOrigin.current) return;
      const dx = ev.screenX - dragOrigin.current.x;
      const dy = ev.screenY - dragOrigin.current.y;
      dragOrigin.current = { x: ev.screenX, y: ev.screenY };
      window.electron.send('move-bubble', { dx, dy });
    };

    const onMouseUp = () => {
      dragOrigin.current = null;
      isDragging.current = false;
      // Restore click-through
      window.electron.send('set-ignore-mouse', { ignore: true });
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  // Accent colours adapt so the glow reads well on both dark and light desktops
  const accent = {
    idle:    isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)',
    waiting: isDark ? 'rgba(245,158,11,0.5)'   : 'rgba(217,119,6,0.4)',
    working: isDark ? 'rgba(59,130,246,0.55)'  : 'rgba(37,99,235,0.45)',
    error:   isDark ? 'rgba(239,68,68,0.55)'   : 'rgba(220,38,38,0.45)',
  };

  const glowColor = {
    idle:    'rgba(255,255,255,0)',
    waiting: isDark ? 'rgba(245,158,11,0.5)'  : 'rgba(217,119,6,0.4)',
    working: isDark ? 'rgba(59,130,246,0.5)'  : 'rgba(37,99,235,0.4)',
    error:   isDark ? 'rgba(239,68,68,0.5)'   : 'rgba(220,38,38,0.4)',
  };

  const borderColor = isDark
    ? 'rgba(255,255,255,0.25)'
    : 'rgba(0,0,0,0.12)';

  const animations: Record<AgentState, any> = {
    idle: {
      scale: [1, 1.05, 1],
      opacity: [0.7, 0.9, 0.7],
      transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
    },
    waiting: {
      opacity: [0.6, 1, 0.6],
      boxShadow: [
        `0 0 0px 0px ${glowColor.waiting}`,
        `0 0 14px 4px ${glowColor.waiting}`,
        `0 0 0px 0px ${glowColor.waiting}`,
      ],
      transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' },
    },
    working: {
      scale: [1, 1.18, 1],
      boxShadow: [
        `0 0 0px 0px ${glowColor.working}`,
        `0 0 22px 6px ${glowColor.working}`,
        `0 0 0px 0px ${glowColor.working}`,
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
    waiting: 'Waiting',
    working: 'Working',
    error: 'Error',
  };

  return (
    <div
      className="flex flex-col items-center justify-end h-full w-full pb-2"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Tooltip — occupies the top portion when window expands */}
      {TOOLTIP_ENABLED && <motion.div
        initial={false}
        animate={{ opacity: hovered ? 1 : 0, y: hovered ? 0 : 6 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="w-full px-2 mb-2 pointer-events-none"
        style={{ minHeight: 0 }}
      >
        <div
          className="rounded-xl px-3 py-2 text-left"
          style={{
            background: isDark ? 'rgba(15,15,20,0.82)' : 'rgba(255,255,255,0.82)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
            boxShadow: isDark ? '0 4px 20px rgba(0,0,0,0.5)' : '0 4px 20px rgba(0,0,0,0.12)',
          }}
        >
          <p className="text-[11px] font-semibold leading-tight truncate"
             style={{ color: isDark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)' }}>
            {meta.label}
          </p>
          <p className="text-[10px] mt-0.5"
             style={{ color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)' }}>
            {stateLabel[state]}
            {status?.activeAgents ? ` · ${status.activeAgents} agent${status.activeAgents > 1 ? 's' : ''}` : ''}
          </p>
          {status?.currentTask && (
            <p className="text-[10px] mt-1 truncate"
               style={{ color: isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)' }}>
              {status.currentTask}
            </p>
          )}
          <p className="text-[9px] mt-1"
             style={{ color: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)' }}>
            {formatLastSeen(status?.lastUpdated)}
          </p>
        </div>
      </motion.div>}

      <motion.div
        onMouseDown={onMouseDown}
        animate={animations[state]}
        className="relative w-16 h-16 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing select-none shrink-0"
        style={{
          background: `radial-gradient(circle, ${accent[state]} 0%, rgba(128,128,128,0.06) 100%)`,
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: `1.5px solid ${borderColor}`,
          boxShadow: isDark
            ? '0 8px 32px 0 rgba(0,0,0,0.4)'
            : '0 4px 16px 0 rgba(0,0,0,0.15)',
        }}
      >
        <img
          src={meta.icon}
          alt={meta.label}
          draggable={false}
          className="w-8 h-8 object-contain"
          style={{ filter: isDark ? 'none' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
        />

        {/* Orbiting ring – waiting state (slow amber dots) */}
        {state === 'waiting' && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            className="absolute w-[72px] h-[72px] rounded-full"
            style={{
              border: `2px dotted ${isDark ? 'rgba(245,158,11,0.55)' : 'rgba(217,119,6,0.5)'}`,
            }}
          />
        )}

        {/* Orbiting ring – working state (fast blue dashes) */}
        {state === 'working' && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
            className="absolute w-[72px] h-[72px] rounded-full"
            style={{
              border: `2px dashed ${isDark ? 'rgba(59,130,246,0.4)' : 'rgba(37,99,235,0.35)'}`,
            }}
          />
        )}

        {/* Error dot */}
        {state === 'error' && (
          <div
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full"
            style={{ background: isDark ? '#ef4444' : '#dc2626', boxShadow: `0 0 6px ${glowColor.error}` }}
          />
        )}
      </motion.div>
    </div>
  );
};


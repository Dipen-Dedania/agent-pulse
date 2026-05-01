import React, { useRef, useCallback, useEffect, useState } from 'react';
import { ToolId, AgentState, ToolStatus } from '../../../common/types';
import { TOOL_META } from '../../../common/toolMeta';
import { colorsFor } from '../../../common/stateColors';
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

export const Bubble: React.FC<BubbleProps> = ({ toolId }) => {
  const status = useStatusStore((state) => state.statuses[toolId]);
  const updateStatus = useStatusStore((state) => state.updateStatus);
  const state = status?.state || 'idle';
  const isDark = useDarkMode();
  const meta = TOOL_META[toolId];
  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subtle chime when the bubble flips into "waiting for input" so the user
  // can context-switch away without missing it. Tracks prior state to fire
  // only on the transition, never on the initial mount or re-renders.
  const prevState = useRef<AgentState | null>(null);
  const chimeRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = state;
    if (prev === null || prev === 'waiting' || state !== 'waiting') return;
    if (typeof Audio === 'undefined') return;
    if (!chimeRef.current) {
      const audio = new Audio('./media/pop.wav');
      audio.volume = 0.4;
      chimeRef.current = audio;
    }
    const audio = chimeRef.current;
    audio.currentTime = 0;
    const result = audio.play();
    // Autoplay can be blocked until the user interacts with the window —
    // swallow the rejection so it doesn't surface as an unhandled error.
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  }, [state]);

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
    console.log(`[Bubble:${toolId}] Registering status-update listener`);
    const handler = (_event: any, incoming: ToolStatus) => {
      console.log(`[Bubble:${toolId}] status-update received:`, incoming);
      if (incoming.toolId === toolId) {
        console.log(
          `[Bubble:${toolId}] Applying state update: ${incoming.state}`,
        );
        updateStatus(incoming);
      } else {
        console.log(
          `[Bubble:${toolId}] Ignoring update for ${incoming.toolId}`,
        );
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
        className='relative w-12 h-12 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing select-none shrink-0'
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
      </motion.div>
    </div>
  );
};

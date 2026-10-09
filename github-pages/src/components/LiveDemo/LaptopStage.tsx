/**
 * The demo played on a laptop: a CSS-drawn MacBook (lid, notch, base) whose
 * screen is a fixed 960 × 600 desktop scaled to fit, so the layout is the same
 * at every width. The desktop has a menu bar with the Agent Pulse tray icon,
 * an app window (with an Agent Pulse window over it in some chapters), the
 * agent's floating bubble — draggable, like the real always-on-top one —
 * notifications, a dock, and the waiting-escalation edge glow. Everything else
 * shown comes from the current Frame.
 */
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import LiveCharacter from './LiveCharacter';
import { BoardPanel, OverlayWindow, TerminalPanel, ToastCard } from './panels';
import { STATE_META, prefersReducedMotion, type Character } from './stateMeta';
import { useInView } from './useInView';
import type { Frame } from './scenes';
import { LOGO_URL, tools } from '../../data/tools';

/** The virtual screen every laptop frame is laid out on. */
const SCREEN_W = 960;
const SCREEN_H = 600;

/** Below this the screen text gets too small to read; use the compact stage. */
export const MIN_LAPTOP_SCALE = 0.7;

/** Chassis measurements for a stage `width` px wide (the base spans all of it). */
export function laptopGeometry(width: number) {
  const lidW = Math.round(width * 0.9);
  const bezel = Math.max(8, Math.round(lidW * 0.016));
  const screenW = lidW - bezel * 2;
  const scale = screenW / SCREEN_W;
  return {
    lidW,
    bezel,
    screenW,
    screenH: Math.round(SCREEN_H * scale),
    scale,
    baseH: Math.max(10, Math.round(width * 0.018)),
  };
}

// The lid opens once per page load, not on every scroll past.
let lidOpened = false;

function useLidOpen() {
  const [ref, inView] = useInView<HTMLDivElement>('0px', 0.2);
  const [closed, setClosed] = useState(() => !lidOpened && !prefersReducedMotion());
  useEffect(() => {
    if (!closed || !inView) return;
    lidOpened = true;
    // Next frame, so the closed pose is painted before the transition starts.
    const id = requestAnimationFrame(() => setClosed(false));
    return () => cancelAnimationFrame(id);
  }, [closed, inView]);
  return [ref, closed] as const;
}

function MenuBar({ frame }: { frame: Frame }) {
  return (
    <div className="absolute inset-x-0 top-0 flex h-[26px] items-center justify-between bg-[#1b1440]/35 px-4 text-[12px] font-medium text-white backdrop-blur-md">
      <div className="flex items-center gap-4">
        <span className="font-bold">{frame.panel === 'board' ? 'Agent Pulse' : 'Terminal'}</span>
        <span className="text-white/85">File</span>
        <span className="text-white/85">Edit</span>
        <span className="text-white/85">View</span>
        <span className="text-white/85">Window</span>
      </div>
      <div className="flex items-center gap-3.5">
        {/* Agent Pulse tray icon: the dot follows the agent's state */}
        <span className="relative flex h-[16px] w-[16px] items-center justify-center">
          <img src={LOGO_URL} alt="" width={16} height={16} draggable={false} />
          <span
            className="absolute -bottom-[2px] -right-[3px] h-[7px] w-[7px] rounded-full ring-[1.5px] ring-[#2a1f63] transition-colors duration-300"
            style={{ background: STATE_META[frame.state].dot }}
          />
        </span>
        <span className="tabular-nums">{frame.clock}</span>
      </div>
    </div>
  );
}

function Dock() {
  return (
    <div className="absolute bottom-[10px] left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-[18px] border border-white/30 bg-white/20 px-3 py-2 backdrop-blur-md">
      {tools.slice(0, 5).map((tool) => (
        <img
          key={tool.id}
          src={tool.logo}
          alt=""
          width={36}
          height={36}
          draggable={false}
          className="h-9 w-9 rounded-[9px] bg-white object-contain p-1 shadow-sm"
        />
      ))}
      <span className="mx-0.5 h-8 w-px bg-white/40" />
      <img
        src={LOGO_URL}
        alt=""
        width={36}
        height={36}
        draggable={false}
        className="h-9 w-9 rounded-[9px] bg-white object-contain p-1 shadow-sm"
      />
    </div>
  );
}

/** The bubble block (character + label), in screen px. */
const BUBBLE_W = 190;
const BUBBLE_H = 180;
const MENU_BAR_H = 30;
const DOCK_H = 70;
const BUBBLE_HOME = { x: SCREEN_W - 64 - BUBBLE_W, y: 190 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Drag in screen px. The screen is a 960 × 600 canvas scaled to fit, so pointer
 * deltas are divided by `scale` to keep the bubble under the cursor.
 */
function useBubbleDrag(scale: number) {
  const [pos, setPos] = useState(BUBBLE_HOME);
  const [dragging, setDragging] = useState(false);
  const [dragged, setDragged] = useState(false);
  const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    setDragged(true);
    setPos({
      x: clamp(s.x + (e.clientX - s.px) / scale, 0, SCREEN_W - BUBBLE_W),
      y: clamp(s.y + (e.clientY - s.py) / scale, MENU_BAR_H, SCREEN_H - DOCK_H - BUBBLE_H),
    });
  };
  const onPointerEnd = () => {
    start.current = null;
    setDragging(false);
  };

  return {
    pos,
    dragging,
    dragged,
    handlers: { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd },
  };
}

function Desktop({ frame, sceneKey, character, scale }: Props & { scale: number }) {
  const meta = STATE_META[frame.state];
  const drag = useBubbleDrag(scale);
  return (
    <div className="demo-wallpaper relative h-full w-full overflow-hidden">
      <MenuBar frame={frame} />

      {/* Notch */}
      <div className="absolute left-1/2 top-0 flex h-[28px] w-[150px] -translate-x-1/2 items-center justify-center rounded-b-[12px] bg-black">
        <span className="h-[7px] w-[7px] rounded-full bg-[#1c2333] ring-1 ring-[#2c3446]" />
      </div>

      {/* App window */}
      <div className="absolute left-[48px] top-[62px] h-[420px] w-[580px]">
        {frame.panel === 'board' ? (
          <BoardPanel frame={frame} sceneKey={sceneKey} title="Agent Pulse — Backlog" />
        ) : (
          <TerminalPanel frame={frame} sceneKey={sceneKey} />
        )}
      </div>

      {/* Agent Pulse window (Guardrails / Analytics) opened over the app */}
      {frame.window && (
        <div className="absolute left-[110px] top-[92px] h-[400px] w-[560px]">
          <OverlayWindow frame={frame} />
        </div>
      )}

      {/* Waiting escalation: darken the edges so the glow reads on the wallpaper */}
      <div
        className={[
          'demo-edge-dim pointer-events-none absolute inset-0 transition-opacity duration-500',
          frame.glow ? 'opacity-100' : 'opacity-0',
        ].join(' ')}
      />

      {/* The agent's bubble, floating on top like the real always-on-top window */}
      <div
        className={[
          'absolute flex select-none flex-col items-center gap-2 touch-none',
          drag.dragging ? 'cursor-grabbing' : 'cursor-grab',
        ].join(' ')}
        style={{ left: drag.pos.x, top: drag.pos.y, width: BUBBLE_W, height: BUBBLE_H }}
        {...drag.handlers}
      >
        <LiveCharacter character={character} state={frame.state} size={110} quota={frame.quota} />
        <span className="flex items-center gap-1.5 whitespace-nowrap rounded-badges bg-paper/85 px-3 py-1 text-[12px] font-medium text-midnight-navy shadow-sm backdrop-blur">
          <span
            className="h-2 w-2 rounded-full transition-colors duration-300"
            style={{ background: meta.dot }}
          />
          Claude Code · {meta.label}
        </span>
        <span
          className={[
            'rounded-badges bg-midnight-navy/70 px-2.5 py-0.5 text-[12px] font-medium text-white transition-opacity duration-500',
            drag.dragged ? 'opacity-0' : 'opacity-100',
          ].join(' ')}
        >
          Drag me
        </span>
      </div>

      {/* Notification toast, under the menu bar like the OS's own */}
      <div className="pointer-events-none absolute right-[14px] top-[38px] w-[300px]">
        {frame.toast && <ToastCard key={frame.toast.title} toast={frame.toast} />}
      </div>

      <Dock />

      {/* Waiting-escalation edge glow */}
      <div
        className={[
          'pointer-events-none absolute inset-0 transition-opacity duration-500',
          frame.glow ? 'demo-edge-glow opacity-100' : 'opacity-0',
        ].join(' ')}
      />
    </div>
  );
}

interface Props {
  frame: Frame;
  /** Changes per chapter so typed lines and cards re-animate. */
  sceneKey: string;
  character: Character;
}

export default function LaptopStage({ width, ...props }: Props & { width: number }) {
  const g = laptopGeometry(width);
  const [lidRef, closed] = useLidOpen();
  const lidRadius = Math.round(g.lidW * 0.028);

  return (
    <div className="relative flex flex-col items-center" style={{ width }} aria-hidden="true">
      {/* Lid */}
      <div
        ref={lidRef}
        className="demo-lid relative bg-[#0b0c0e]"
        data-closed={closed || undefined}
        style={{
          width: g.lidW,
          padding: `${g.bezel}px ${g.bezel}px ${Math.round(g.bezel * 1.4)}px`,
          borderRadius: `${lidRadius}px ${lidRadius}px ${Math.round(lidRadius * 0.4)}px ${Math.round(lidRadius * 0.4)}px`,
          boxShadow: '0 0 0 2px #4a4d55, 0 0 0 3px #26282d, 0 30px 60px -20px rgba(11,53,88,0.45)',
        }}
      >
        <div
          className="demo-screen relative overflow-hidden bg-black"
          style={{ width: g.screenW, height: g.screenH, borderRadius: Math.max(4, Math.round(lidRadius * 0.45)) }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${g.scale})` }}
          >
            <Desktop {...props} scale={g.scale} />
          </div>
        </div>
      </div>

      {/* Base */}
      <div
        className="relative"
        style={{
          width,
          height: g.baseH,
          background: 'linear-gradient(to bottom, #8a8d95 0%, #4b4e55 30%, #2a2c30 100%)',
          borderRadius: `3px 3px ${g.baseH * 4}px ${g.baseH * 4}px / 3px 3px ${g.baseH}px ${g.baseH}px`,
        }}
      >
        {/* Thumb notch */}
        <div
          className="absolute left-1/2 top-0 -translate-x-1/2 bg-[#1f2024]"
          style={{
            width: Math.round(width * 0.12),
            height: Math.round(g.baseH * 0.45),
            borderRadius: `0 0 ${g.baseH}px ${g.baseH}px`,
          }}
        />
      </div>

      {/* Contact shadow */}
      <div
        className="pointer-events-none mt-1 h-4 rounded-[50%] bg-[rgba(11,53,88,0.28)] blur-md"
        style={{ width: width * 0.9 }}
      />
    </div>
  );
}

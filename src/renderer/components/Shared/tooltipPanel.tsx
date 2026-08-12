import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Internal plumbing shared by the three tooltip surfaces — `Tooltip` (hover a
 * control), `InfoTooltip` (an "i" that reveals prose), and `useChartTip` (a
 * cursor-following tip on chart marks). Each used to hand-roll its own portal,
 * its own viewport clamping, and its own `.glass-modal` panel, which is how the
 * two paddings and two z-indexes drifted apart.
 *
 * Not barrel-exported: callers use one of the three surfaces above.
 */

/** Gap between a tooltip and its trigger / the viewport edge. */
export const TIP_MARGIN = 8;

/** Above everything, including modals (`z-50`) and the Select portal. */
const TIP_Z = 9999;

const PADS = {
  /** One-liners: labels, chart values. */
  tight: 'px-2.5 py-1.5 leading-snug',
  /** Prose: the "i" popovers explaining how a number is computed. */
  roomy: 'px-3 py-2.5 leading-relaxed',
} as const;

export type TipPad = keyof typeof PADS;

// `pre-line` honours newlines in string content (multi-line labels); `nowrap`
// keeps one-line chart readouts on one line. Spelled out so Tailwind sees them.
const WRAPS = {
  'pre-line': 'whitespace-pre-line',
  nowrap: 'whitespace-nowrap',
} as const;

export type TipWrap = keyof typeof WRAPS;

interface TooltipPanelProps {
  children: React.ReactNode;
  /** Viewport coordinates. `null` renders hidden (pre-measurement). */
  pos: { left: number; top: number } | null;
  pad?: TipPad;
  wrap?: TipWrap;
  /** Let the pointer enter the panel (hoverable content). Default: false. */
  interactive?: boolean;
  /** Extra classes on the positioning wrapper (e.g. a width override). */
  className?: string;
  panelRef?: React.Ref<HTMLDivElement>;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * The glass tooltip card, portalled to `document.body` with fixed positioning
 * so no `overflow-hidden` ancestor can clip it. Renders hidden (but measurable)
 * until `pos` is known, which is how the anchored variants avoid a first-frame
 * flash at 0,0.
 */
export const TooltipPanel: React.FC<TooltipPanelProps> = ({
  children,
  pos,
  pad = 'tight',
  wrap = 'pre-line',
  interactive = false,
  className = '',
  panelRef,
  onMouseEnter,
  onMouseLeave,
}) =>
  createPortal(
    <div
      ref={panelRef}
      role='tooltip'
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'fixed',
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        zIndex: TIP_Z,
        pointerEvents: interactive ? undefined : 'none',
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={`w-max max-w-[18rem] ${className}`}
    >
      <span
        className={`block glass-modal rounded-lg ${PADS[pad]} text-left text-[11px] text-primary font-normal normal-case tracking-normal ${WRAPS[wrap]}`}
      >
        {children}
      </span>
    </div>,
    document.body,
  );

/**
 * Places a panel over a trigger element: centered above it, clamped to the
 * viewport horizontally, flipped below when there's no room. Re-measures on
 * scroll (capturing, so inner scrollers count) and on resize while open.
 *
 * Returns the refs to attach and the measured position — `null` until the panel
 * is in the DOM and has been measured.
 */
export function useAnchoredPosition(open: boolean) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const t = trigger.getBoundingClientRect();
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    let left = t.left + t.width / 2 - pw / 2;
    left = Math.max(TIP_MARGIN, Math.min(left, window.innerWidth - pw - TIP_MARGIN));
    let top = t.top - ph - TIP_MARGIN;
    if (top < TIP_MARGIN) top = t.bottom + TIP_MARGIN;
    setPos({ left, top });
  }, []);

  // Measure as soon as the panel mounts, before paint.
  useLayoutEffect(() => {
    if (open) reposition();
    else setPos(null);
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => reposition();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, reposition]);

  return { triggerRef, panelRef, pos };
}

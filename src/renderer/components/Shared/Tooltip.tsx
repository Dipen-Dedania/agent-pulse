import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// General-purpose hover/focus tooltip — the shared replacement for native
// `title` attributes, which are slow to appear, unstyled, and clash with the
// glass aesthetic. Wrap any single element:
//
//   <Tooltip content='Delete webhook'>
//     <button onClick={remove}>🗑</button>
//   </Tooltip>
//
// The panel is a glass card rendered in a portal with fixed positioning and
// clamped to the viewport, so it's never clipped by an overflow-hidden ancestor
// or a window edge. It centers above the trigger and flips below when there's no
// room. `content` may be a string or arbitrary JSX. A falsy `content` (or
// `disabled`) renders the child untouched — handy for conditional tooltips like
// `content={narrow ? 'Too small' : undefined}`.

const MARGIN = 8;
const OPEN_DELAY = 300;

type WithHandlers = {
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
};

interface TooltipProps {
  /** Body of the tooltip. Falsy → no tooltip is wired up. */
  content: React.ReactNode;
  /** The single element the tooltip is attached to. */
  children: React.ReactElement<WithHandlers>;
  /** Extra classes on the glass panel (e.g. width overrides). */
  className?: string;
  /** Force-disable without changing the markup. */
  disabled?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, className, disabled }) => {
  const triggerRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const clearOpenTimer = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
  };

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const t = trigger.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const vw = window.innerWidth;
    let left = t.left + t.width / 2 - tw / 2;
    left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));
    // Prefer above the trigger; flip below when there isn't room.
    let top = t.top - th - MARGIN;
    if (top < MARGIN) top = t.bottom + MARGIN;
    setPos({ left, top });
  }, []);

  const show = useCallback((el: HTMLElement) => {
    triggerRef.current = el;
    clearOpenTimer();
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  }, []);
  const hide = useCallback(() => {
    clearOpenTimer();
    setOpen(false);
    setPos(null);
  }, []);

  useLayoutEffect(() => {
    if (open) reposition();
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

  useEffect(() => () => clearOpenTimer(), []);

  // No tooltip to show → render the child as-is so callers can pass conditional
  // content without branching their markup.
  if (disabled || content === null || content === undefined || content === false || content === '') {
    return children;
  }

  const childProps = children.props;
  const wired = React.cloneElement(children, {
    onMouseEnter: (e: React.MouseEvent) => { childProps.onMouseEnter?.(e); show(e.currentTarget as HTMLElement); },
    onMouseLeave: (e: React.MouseEvent) => { childProps.onMouseLeave?.(e); hide(); },
    onFocus: (e: React.FocusEvent) => { childProps.onFocus?.(e); show(e.currentTarget as HTMLElement); },
    onBlur: (e: React.FocusEvent) => { childProps.onBlur?.(e); hide(); },
  });

  return (
    <>
      {wired}
      {open && createPortal(
        <div
          ref={tipRef}
          role='tooltip'
          style={{
            position: 'fixed',
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            zIndex: 9999,
            pointerEvents: 'none',
            visibility: pos ? 'visible' : 'hidden',
          }}
          className={`w-max max-w-[18rem] ${className ?? ''}`}
        >
          <span className='block glass-modal rounded-lg px-2.5 py-1.5 text-left text-[11px] leading-snug text-primary font-normal normal-case tracking-normal whitespace-pre-line'>
            {content}
          </span>
        </div>,
        document.body,
      )}
    </>
  );
};

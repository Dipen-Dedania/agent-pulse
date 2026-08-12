import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TooltipPanel, useAnchoredPosition } from './tooltipPanel';

/**
 * InfoTooltip — a small "i" affordance that reveals a glass popover of prose on
 * hover/focus. Use it where a number needs explaining (how a rate is computed,
 * what a window covers) rather than a plain label, which is what `Tooltip` is
 * for.
 *
 *   <InfoTooltip label='How ship rate is computed'>
 *     Cards that reached <em>Shipped</em> ÷ cards that entered execution.
 *   </InfoTooltip>
 *
 * Two deliberate differences from `Tooltip`: it opens immediately (the icon
 * exists only to be hovered — a delay would feel broken), and the panel is
 * pointer-interactive with a short close grace, so the cursor can travel across
 * the gap to select text inside it.
 */

/** Long enough to cross the gap onto the panel, short enough not to linger. */
const CLOSE_GRACE = 80;

export const InfoTooltip: React.FC<{ children: React.ReactNode; label?: string }> = ({
  children,
  label = 'More info',
}) => {
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const { triggerRef, panelRef, pos } = useAnchoredPosition(open);

  const show = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  }, []);

  const hide = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_GRACE);
  }, []);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return (
    <span className='inline-flex align-middle'>
      <button
        ref={(el) => { triggerRef.current = el; }}
        type='button'
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className='inline-flex items-center justify-center w-4 h-4 rounded-full border border-edge-strong/50 text-muted text-[10px] font-semibold leading-none cursor-help hover:text-primary hover:border-edge focus:outline-none focus-visible:ring-1 focus-visible:ring-edge transition-colors'
      >
        i
      </button>
      {open && (
        <TooltipPanel
          pos={pos}
          panelRef={panelRef}
          pad='roomy'
          interactive
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          {children}
        </TooltipPanel>
      )}
    </span>
  );
};

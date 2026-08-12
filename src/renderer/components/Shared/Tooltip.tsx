import React, { useCallback, useEffect, useRef, useState } from 'react';
import { TooltipPanel, useAnchoredPosition } from './tooltipPanel';

// General-purpose hover/focus tooltip — the shared replacement for native
// `title` attributes, which are slow to appear, unstyled, and clash with the
// glass aesthetic. Wrap any single element:
//
//   <Tooltip content='Delete webhook'>
//     <button onClick={remove}>🗑</button>
//   </Tooltip>
//
// Positioning and the glass card come from `tooltipPanel` (shared with
// `InfoTooltip` and `useChartTip`): a portal with fixed positioning, centered
// above the trigger, clamped to the viewport, flipping below when there's no
// room. `content` may be a string or arbitrary JSX. A falsy `content` (or
// `disabled`) renders the child untouched — handy for conditional tooltips like
// `content={narrow ? 'Too small' : undefined}`.

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
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const { triggerRef, panelRef, pos } = useAnchoredPosition(open);

  const clearOpenTimer = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
  };

  const show = useCallback((el: HTMLElement) => {
    triggerRef.current = el;
    clearOpenTimer();
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  }, [triggerRef]);

  const hide = useCallback(() => {
    clearOpenTimer();
    setOpen(false);
  }, []);

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
      {open && (
        <TooltipPanel pos={pos} panelRef={panelRef} className={className}>
          {content}
        </TooltipPanel>
      )}
    </>
  );
};

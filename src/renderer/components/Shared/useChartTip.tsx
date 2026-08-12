import React, { useCallback, useState } from 'react';
import { TooltipPanel } from './tooltipPanel';

/**
 * Cursor-following hover tooltip for chart marks (bars, heatmap cells, donut
 * segments, hit-rects) — the one case `Tooltip` doesn't cover, because the tip
 * tracks the pointer rather than anchoring to a fixed trigger, and a chart can
 * have hundreds of marks that would each otherwise need their own listener set.
 *
 * One hook per chart: spread `tipHandlers(content)` onto each mark and render
 * `tipOverlay` once.
 *
 *   const { tipHandlers, tipOverlay } = useChartTip();
 *   …
 *   <rect {...tipHandlers(<span>{day}: {hours}h</span>)} />
 *   {tipOverlay}
 */

/**
 * Gap from the cursor, and the width we assume rather than measure — the panel
 * moves on every mousemove, so a per-frame `getBoundingClientRect` would cost
 * more than the occasional imperfect right-edge clamp.
 */
const CURSOR_GAP = 12;
const ASSUMED_TIP_WIDTH = 200;

export function useChartTip() {
  const [tip, setTip] = useState<{ content: React.ReactNode; x: number; y: number } | null>(null);

  const place = (e: { clientX: number; clientY: number }, content: React.ReactNode) => {
    // Offset above-right of the cursor; flip below when near the top edge.
    const x = Math.min(e.clientX + CURSOR_GAP, window.innerWidth - ASSUMED_TIP_WIDTH);
    const y = e.clientY < 72 ? e.clientY + CURSOR_GAP + 8 : e.clientY - CURSOR_GAP - 24;
    setTip({ content, x, y });
  };

  const tipHandlers = useCallback((content: React.ReactNode) => ({
    onMouseEnter: (e: React.MouseEvent) => place(e, content),
    onMouseMove:  (e: React.MouseEvent) => place(e, content),
    onMouseLeave: () => setTip(null),
  }), []);

  const tipOverlay = tip ? (
    <TooltipPanel pos={{ left: tip.x, top: tip.y }} wrap='nowrap'>
      {tip.content}
    </TooltipPanel>
  ) : null;

  return { tipHandlers, tipOverlay };
}

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CostBreakdown, formatUsd } from '../../../../common/pricing';

export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return '0m';
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

export function formatCompactNumber(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return (n / 1000).toFixed(n < 10_000 ? 1 : 0) + 'k';
  return (n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0) + 'M';
}

// Card and Segmented are app-wide primitives — their definitions now live in
// components/Shared. Re-exported here so the analytics cards can keep importing
// them from './shared' alongside the chart-only helpers below.
export { Card } from '../../Shared/Card';
export { Segmented } from '../../Shared/Segmented';

export const InfoPill: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn' }> = ({ children, tone = 'info' }) => {
  const cls = tone === 'warn'
    ? 'bg-amber-500/15 border-amber-500/30 text-warn'
    : 'bg-blue-500/10 border-blue-500/30 text-info';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border ${cls} text-[11px]`}>
      {children}
    </span>
  );
};

// A small "i" icon that reveals a glass popover on hover/focus. The popover is
// rendered in a portal with fixed positioning and clamped to the viewport, so
// it can never be clipped by a window edge or an overflow-hidden ancestor — it
// centers over the icon when there's room and slides inward near the edges,
// flipping below the icon if there isn't space above. Pass the body as children.
const TOOLTIP_MARGIN = 8;

export const InfoTooltip: React.FC<{ children: React.ReactNode; label?: string }> = ({
  children,
  label = 'More info',
}) => {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  }, []);
  // Small delay so moving the cursor across the gap onto the popover doesn't close it.
  const hide = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => { setOpen(false); setPos(null); }, 80);
  }, []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    const t = trigger.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const vw = window.innerWidth;
    let left = t.left + t.width / 2 - tw / 2;
    left = Math.max(TOOLTIP_MARGIN, Math.min(left, vw - tw - TOOLTIP_MARGIN));
    // Prefer above the icon; flip below when there isn't room.
    let top = t.top - th - TOOLTIP_MARGIN;
    if (top < TOOLTIP_MARGIN) top = t.bottom + TOOLTIP_MARGIN;
    setPos({ left, top });
  }, []);

  // Measure once the popover is in the DOM, and keep it pinned while open.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
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

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  return (
    <span className='inline-flex align-middle'>
      <button
        ref={triggerRef}
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
      {open && createPortal(
        <div
          ref={tipRef}
          role='tooltip'
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{
            position: 'fixed',
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            zIndex: 9999,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className='w-max max-w-[18rem]'
        >
          <span className='block glass-modal rounded-lg px-3 py-2.5 text-left font-normal normal-case tracking-normal'>
            {children}
          </span>
        </div>,
        document.body,
      )}
    </span>
  );
};

// Cursor-following hover tooltip for chart marks (bars, cells, hit-rects) —
// replaces native `title` attributes, which are slow, unstyled, and clash with
// the glass aesthetic. One tooltip per chart: spread `tipHandlers(content)`
// onto each mark and render `tipOverlay` once. The overlay is a portal with
// fixed positioning clamped to the viewport, matching InfoTooltip's panel.
export function useChartTip() {
  const [tip, setTip] = useState<{ content: React.ReactNode; x: number; y: number } | null>(null);

  const place = (e: { clientX: number; clientY: number }, content: React.ReactNode) => {
    // Offset above-right of the cursor; flip below when near the top edge.
    const margin = 12;
    const x = Math.min(e.clientX + margin, window.innerWidth - 200);
    const y = e.clientY < 72 ? e.clientY + margin + 8 : e.clientY - margin - 24;
    setTip({ content, x, y });
  };

  const tipHandlers = useCallback((content: React.ReactNode) => ({
    onMouseEnter: (e: React.MouseEvent) => place(e, content),
    onMouseMove:  (e: React.MouseEvent) => place(e, content),
    onMouseLeave: () => setTip(null),
  }), []);

  const tipOverlay = tip
    ? createPortal(
        <div
          role='tooltip'
          style={{ position: 'fixed', left: tip.x, top: tip.y, zIndex: 9999, pointerEvents: 'none' }}
          className='w-max max-w-[18rem]'
        >
          <span className='block glass-modal rounded-lg px-2.5 py-1.5 text-left text-[11px] text-primary whitespace-nowrap'>
            {tip.content}
          </span>
        </div>,
        document.body,
      )
    : null;

  return { tipHandlers, tipOverlay };
}

// Effective $/1M-token rate for a class, derived from the dollars actually
// attributed and the tokens counted. Equals the list rate for single-model
// rows; blends automatically when an aggregate spans several models.
function effectiveRate(costUsd: number, tokens: number): string {
  if (tokens <= 0) return '—';
  return `$${((costUsd / tokens) * 1_000_000).toFixed(2)}/M`;
}

const BreakdownRow: React.FC<{ label: string; tokens: number; costUsd: number }> = ({ label, tokens, costUsd }) => (
  <tr className='text-[11px] text-body'>
    <td className='py-0.5 pr-3 text-muted'>{label}</td>
    <td className='py-0.5 pr-3 text-right font-mono tabular-nums text-body'>{formatCompactNumber(tokens)}</td>
    <td className='py-0.5 pr-3 text-right font-mono tabular-nums text-faint'>{effectiveRate(costUsd, tokens)}</td>
    <td className='py-0.5 text-right font-mono tabular-nums text-ok'>{formatUsd(costUsd)}</td>
  </tr>
);

// Shared cost-breakdown popover body: a per-token-class table (tokens, effective
// rate, dollars) plus a footnote on cache discounting. Used by any card that
// shows an estimated cost and wants to explain how it was built.
export const CostBreakdownContent: React.FC<{
  tokensIn: number;
  tokensOut: number;
  cacheWrite: number;
  cacheRead: number;
  breakdown: CostBreakdown;
  totalUsd: number;
}> = ({ tokensIn, tokensOut, cacheWrite, cacheRead, breakdown, totalUsd }) => (
  <div className='text-primary'>
    <p className='text-[11px] font-semibold text-primary mb-1.5'>How this is estimated</p>
    <table className='w-full border-collapse'>
      <thead>
        <tr className='text-[9px] uppercase tracking-wider text-faint'>
          <th className='py-0.5 pr-3 text-left font-medium'>Class</th>
          <th className='py-0.5 pr-3 text-right font-medium'>Tokens</th>
          <th className='py-0.5 pr-3 text-right font-medium'>Rate</th>
          <th className='py-0.5 text-right font-medium'>Cost</th>
        </tr>
      </thead>
      <tbody>
        <BreakdownRow label='Input'       tokens={tokensIn}   costUsd={breakdown.input} />
        <BreakdownRow label='Output'      tokens={tokensOut}  costUsd={breakdown.output} />
        <BreakdownRow label='Cache write' tokens={cacheWrite} costUsd={breakdown.cacheWrite} />
        <BreakdownRow label='Cache read'  tokens={cacheRead}  costUsd={breakdown.cacheRead} />
      </tbody>
      <tfoot>
        <tr className='text-[11px] font-semibold border-t border-edge/70'>
          <td className='pt-1.5 pr-3 text-primary' colSpan={3}>Total</td>
          <td className='pt-1.5 text-right font-mono tabular-nums text-ok'>{formatUsd(totalUsd)}</td>
        </tr>
      </tfoot>
    </table>
    <p className='text-[10px] text-faint mt-2 leading-snug'>
      Cache writes bill at ≈1.25× the input rate; cache reads at ≈0.1× (≈90% cheaper). Rates are
      Anthropic API list prices and blend if an aggregate spans multiple models.
    </p>
  </div>
);

export const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className='flex items-center justify-center py-8 text-sm text-faint'>{message}</div>
);

export const SkeletonLine: React.FC<{ width?: string; height?: string }> = ({ width = '100%', height = '0.75rem' }) => (
  <div className='bg-control/40 rounded animate-pulse' style={{ width, height }} />
);

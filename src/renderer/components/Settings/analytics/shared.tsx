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

export const Card: React.FC<{
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, right, children }) => (
  <div className='mb-5 bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-5 shadow-xl'>
    <div className='flex items-start justify-between gap-3 mb-4'>
      <div>
        <h3 className='text-base font-semibold text-white leading-tight'>{title}</h3>
        {subtitle && <p className='text-xs text-slate-400 mt-1'>{subtitle}</p>}
      </div>
      {right && <div className='shrink-0'>{right}</div>}
    </div>
    {children}
  </div>
);

export const Segmented: React.FC<{
  options: { value: string; label: string }[];
  value: string;
  onChange: (next: string) => void;
}> = ({ options, value, onChange }) => (
  <div className='inline-flex gap-1 p-1 bg-slate-800/60 border border-slate-700/60 rounded-lg'>
    {options.map((opt) => {
      const active = opt.value === value;
      return (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
            active ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

export const InfoPill: React.FC<{ children: React.ReactNode; tone?: 'info' | 'warn' }> = ({ children, tone = 'info' }) => {
  const cls = tone === 'warn'
    ? 'bg-amber-500/15 border-amber-500/30 text-amber-200'
    : 'bg-blue-500/10 border-blue-500/30 text-blue-200';
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
        className='inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-500/50 text-slate-400 text-[10px] font-semibold leading-none cursor-help hover:text-slate-100 hover:border-slate-300/70 focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-300/60 transition-colors'
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
          <span className='block bg-slate-900/95 backdrop-blur-md border border-slate-600/60 rounded-lg shadow-2xl px-3 py-2.5 text-left font-normal normal-case tracking-normal'>
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
          <span className='block bg-slate-900/95 backdrop-blur-md border border-slate-600/60 rounded-lg shadow-2xl px-2.5 py-1.5 text-left text-[11px] text-slate-200 whitespace-nowrap'>
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
  <tr className='text-[11px] text-slate-300'>
    <td className='py-0.5 pr-3 text-slate-400'>{label}</td>
    <td className='py-0.5 pr-3 text-right font-mono tabular-nums text-slate-300'>{formatCompactNumber(tokens)}</td>
    <td className='py-0.5 pr-3 text-right font-mono tabular-nums text-slate-500'>{effectiveRate(costUsd, tokens)}</td>
    <td className='py-0.5 text-right font-mono tabular-nums text-emerald-300'>{formatUsd(costUsd)}</td>
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
  <div className='text-slate-200'>
    <p className='text-[11px] font-semibold text-slate-200 mb-1.5'>How this is estimated</p>
    <table className='w-full border-collapse'>
      <thead>
        <tr className='text-[9px] uppercase tracking-wider text-slate-500'>
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
        <tr className='text-[11px] font-semibold border-t border-slate-700/70'>
          <td className='pt-1.5 pr-3 text-slate-200' colSpan={3}>Total</td>
          <td className='pt-1.5 text-right font-mono tabular-nums text-emerald-300'>{formatUsd(totalUsd)}</td>
        </tr>
      </tfoot>
    </table>
    <p className='text-[10px] text-slate-500 mt-2 leading-snug'>
      Cache writes bill at ≈1.25× the input rate; cache reads at ≈0.1× (≈90% cheaper). Rates are
      Anthropic API list prices and blend if an aggregate spans multiple models.
    </p>
  </div>
);

export const EmptyState: React.FC<{ message: string }> = ({ message }) => (
  <div className='flex items-center justify-center py-8 text-sm text-slate-500'>{message}</div>
);

export const SkeletonLine: React.FC<{ width?: string; height?: string }> = ({ width = '100%', height = '0.75rem' }) => (
  <div className='bg-slate-700/40 rounded animate-pulse' style={{ width, height }} />
);

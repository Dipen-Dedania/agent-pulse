import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// App-wide dropdown replacing the native <select>, styled to match the glass
// aesthetic. The menu is rendered in a portal with fixed positioning (clamped
// and flipped near the viewport edge) so it can't be clipped by a scroll
// container or an `overflow-hidden` ancestor — the same approach as InfoTooltip.

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  swatch?: string; // optional color dot shown before the label (e.g. color pickers)
}

interface SelectProps<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  // Applied to the trigger button — use it for width / padding / text-size so
  // each call site can match the control it replaces.
  className?: string;
  ariaLabel?: string;
}

const MENU_MARGIN = 6;

export function Select<T extends string>({ value, options, onChange, className = '', ariaLabel }: SelectProps<T>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const selected = options.find((o) => o.value === value);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const r = trigger.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? 0;
    const vh = window.innerHeight;
    let top = r.bottom + MENU_MARGIN;
    // Flip above the trigger when opening downward would overflow the viewport.
    if (menuH && top + menuH > vh - MENU_MARGIN) {
      const above = r.top - MENU_MARGIN - menuH;
      if (above > MENU_MARGIN) top = above;
    }
    setPos({ left: r.left, top, width: r.width });
  }, []);

  // Measure once the menu is in the DOM (so the flip math sees its real height),
  // then keep it pinned to the trigger while open.
  useLayoutEffect(() => {
    if (open) reposition();
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => reposition();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, reposition]);

  // Dismiss on any click outside the trigger or the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type='button'
        aria-haspopup='listbox'
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center justify-between gap-2 bg-glass border rounded-lg cursor-pointer transition-colors text-primary ${
          open ? 'border-blue-500/60' : 'border-edge hover:border-edge-strong'
        } ${className}`}
      >
        <span className='flex items-center gap-1.5 min-w-0'>
          {selected?.swatch && (
            <span className='w-2.5 h-2.5 rounded-full shrink-0' style={{ background: selected.swatch }} />
          )}
          <span className='truncate'>{selected?.label ?? value}</span>
        </span>
        <svg
          viewBox='0 0 20 20'
          fill='currentColor'
          className={`w-3.5 h-3.5 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            fillRule='evenodd'
            d='M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z'
            clipRule='evenodd'
          />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          role='listbox'
          style={{
            position: 'fixed',
            left: pos?.left ?? 0,
            top: pos?.top ?? 0,
            minWidth: pos?.width,
            zIndex: 9999,
            visibility: pos ? 'visible' : 'hidden',
          }}
          className='apple-scroll py-1 max-h-64 overflow-y-auto bg-overlay/95 backdrop-blur-md border border-edge-strong/60 rounded-lg shadow-2xl'
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type='button'
                role='option'
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs cursor-pointer transition-colors ${
                  active ? 'bg-blue-500/20 text-white' : 'text-body hover:bg-control/60'
                }`}
              >
                {opt.swatch && (
                  <span className='w-2.5 h-2.5 rounded-full shrink-0' style={{ background: opt.swatch }} />
                )}
                <span className='truncate'>{opt.label}</span>
                {active && (
                  <svg viewBox='0 0 20 20' fill='currentColor' className='w-3.5 h-3.5 ml-auto text-blue-400 shrink-0'>
                    <path
                      fillRule='evenodd'
                      d='M16.704 5.29a.75.75 0 010 1.06l-7.5 7.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.97 2.97 6.97-6.97a.75.75 0 011.06 0z'
                      clipRule='evenodd'
                    />
                  </svg>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

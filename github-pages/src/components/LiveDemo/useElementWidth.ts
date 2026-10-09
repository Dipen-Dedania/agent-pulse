import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * The element's content width in px, 0 until measured. Measured in a layout
 * effect so the first painted frame already uses the real width.
 */
export function useElementWidth<T extends Element>(ref: RefObject<T | null>) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

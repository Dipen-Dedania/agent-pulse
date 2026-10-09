import { useEffect, useRef, useState } from 'react';

/** True while the element is (nearly) on screen. Missing IO support → always true. */
export function useInView<T extends Element>(rootMargin = '0px', threshold = 0) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      rootMargin,
      threshold,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, threshold]);
  return [ref, inView] as const;
}

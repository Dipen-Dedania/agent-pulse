import { useState, useEffect } from 'react';

export function getEffectiveTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function initThemeAttribute(): void {
  const apply = () => {
    document.documentElement.dataset.theme = getEffectiveTheme();
  };
  apply();
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', apply);
}

export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDark;
}

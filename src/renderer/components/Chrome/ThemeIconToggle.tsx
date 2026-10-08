import React, { useEffect, useState } from 'react';
import { Segmented, SegmentedOption } from '../Shared';
import { AppearanceConfig, ThemeMode } from '../../../common/types';

const SunIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor' className={className}>
    <path d='M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.06l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.06 1.06a.75.75 0 001.06 1.06l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0118 10zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06L5.404 4.343a.75.75 0 00-1.06 1.06l1.06 1.061z' />
  </svg>
);

const MoonIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor' className={className}>
    <path fillRule='evenodd' d='M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z' clipRule='evenodd' />
  </svg>
);

const MonitorIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor' className={className}>
    <path fillRule='evenodd' d='M2 4.25A2.25 2.25 0 014.25 2h11.5A2.25 2.25 0 0118 4.25v8.5A2.25 2.25 0 0115.75 15h-3.105a3.501 3.501 0 001.1 1.677A.75.75 0 0113.26 18H6.74a.75.75 0 01-.484-1.323A3.501 3.501 0 007.355 15H4.25A2.25 2.25 0 012 12.75v-8.5zm1.5 0a.75.75 0 01.75-.75h11.5a.75.75 0 01.75.75v7.5a.75.75 0 01-.75.75H4.25a.75.75 0 01-.75-.75v-7.5z' clipRule='evenodd' />
  </svg>
);

// Icon-only options — `hint` is both the hover tooltip and the accessible name
// (the Windows UI tree and tests key off these exact strings).
const THEME_OPTIONS: SegmentedOption[] = [
  { value: 'light', icon: <SunIcon />, hint: 'Light theme' },
  { value: 'dark', icon: <MoonIcon />, hint: 'Dark theme' },
  { value: 'auto', icon: <MonitorIcon />, hint: 'Auto theme' },
];

/**
 * Light / dark / auto switch that lives in the custom title bar. Main owns the
 * theme (`appearance:update-config` → `nativeTheme.themeSource`); this just
 * mirrors the persisted choice and sends the user's pick.
 */
export const ThemeIconToggle: React.FC = () => {
  const [theme, setTheme] = useState<ThemeMode>('auto');

  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('get-config')
      .then((cfg: { appearance?: AppearanceConfig }) => {
        if (!cancelled) setTheme(cfg.appearance?.theme ?? 'auto');
      })
      .catch(() => {});
    const handler = (_e: unknown, cfg: AppearanceConfig) => setTheme(cfg.theme);
    window.electron.on('appearance:config-updated', handler);
    return () => {
      cancelled = true;
      window.electron.off('appearance:config-updated', handler);
    };
  }, []);

  const handleTheme = (t: ThemeMode) => {
    setTheme(t);
    window.electron.invoke('appearance:update-config', { theme: t }).catch(() => {});
  };

  return (
    <Segmented
      size='sm'
      ariaLabel='Theme'
      className='shrink-0'
      options={THEME_OPTIONS}
      value={theme}
      onChange={(v) => handleTheme(v as ThemeMode)}
    />
  );
};

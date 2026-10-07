import React from 'react';
import { TitleBar } from './TitleBar';

/**
 * Layout shell for the one framed window (Settings, which also hosts the
 * Landing splash). Title bar on top, the view fills the rest and owns its own
 * scrolling. The liquid wallpaper lives here so it runs under the bar too.
 */
export const WindowChrome: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className='h-screen w-screen flex flex-col overflow-hidden settings-liquid-bg'>
    <TitleBar />
    <div className='flex-1 min-h-0 relative'>{children}</div>
  </div>
);

import React from 'react';
import { TITLE_BAR_OVERLAY_TRANSPARENT } from '../../../common/title-bar';
import { ThemeIconToggle } from './ThemeIconToggle';
import { StarButton } from './StarButton';

/**
 * Renderer half of the custom title bar. The whole strip is a drag region; the
 * OS paints its own window controls in the overlay to the right (Windows/Linux)
 * or the traffic lights to the left (macOS). `.title-bar-inner` sizes itself
 * from the `titlebar-area-*` CSS env vars so it never overlaps either.
 */
export const TitleBar: React.FC = () => (
  <header
    className={`title-bar app-drag${TITLE_BAR_OVERLAY_TRANSPARENT ? '' : ' title-bar-solid'}`}
  >
    <div className='title-bar-inner'>
      <img
        src='./assets/logo-transparent.png'
        alt=''
        aria-hidden='true'
        className='w-5 h-5 object-contain shrink-0'
      />
      <span className='text-sm font-semibold tracking-tight text-strong'>Agent Pulse</span>
      <div className='flex-1' />
      <div className='app-no-drag flex items-center gap-1.5'>
        <StarButton />
        <ThemeIconToggle />
      </div>
    </div>
  </header>
);

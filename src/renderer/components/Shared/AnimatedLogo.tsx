import React, { useEffect, useId, useRef } from 'react';
import {
  LOGO_FULL_PATH_D,
  LOGO_OUTLINE_D,
  LOGO_OUTLINE_DASH,
  LOGO_SPIKE_D,
} from '../../../common/logo-geometry';

/**
 * The Agent Pulse mark as an inline, animatable SVG.
 *
 * Geometry mirrors `public/assets/logo.svg` and the floating launch splash
 * `public/splash.html` (a test keeps the three in sync via `common/logo-geometry.ts`).
 * Styling and the keyframes live in `index.css` under `.ap-logo`, keyed off
 * `data-variant`:
 *
 *   static  the plain mark
 *   alive   heartbeat comet along the bar + beat flash + random blinks
 *   sleep   slit eyes, flat-lined bar, dimmed glow, slow breathing
 *
 * Blink timing is the only JS: random 2–6s intervals with an occasional
 * double-blink, disabled under `prefers-reduced-motion`.
 */
export type AnimatedLogoVariant = 'static' | 'alive' | 'sleep';

export interface AnimatedLogoProps {
  variant?: AnimatedLogoVariant;
  /** Sizing / layout only — the mark is square and fills its box. */
  className?: string;
  /** Accessible name. Pass '' with aria-hidden handled by the parent for decorative uses. */
  label?: string;
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const AnimatedLogo: React.FC<AnimatedLogoProps> = ({ variant = 'static', className, label = 'Agent Pulse' }) => {
  // Several logos can be on screen at once (boot gate + hero); gradient,
  // filter and clip ids must not collide.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = (name: string) => `lg-${name}-${uid}`;
  const url = (name: string) => `url(#${id(name)})`;
  const pupilsRef = useRef<SVGGElement>(null);

  useEffect(() => {
    if (variant !== 'alive' || prefersReducedMotion()) return;
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        timers.delete(t);
        if (!cancelled) fn();
      }, ms);
      timers.add(t);
    };
    const blink = (ms: number) => {
      const el = pupilsRef.current;
      if (!el) return;
      el.classList.add('is-blink');
      later(() => el.classList.remove('is-blink'), ms);
    };
    const tick = () => {
      blink(120);
      if (Math.random() < 0.25) later(() => blink(110), 260);
      later(tick, 2200 + Math.random() * 3800);
    };
    later(tick, 600 + Math.random() * 2400);
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      pupilsRef.current?.classList.remove('is-blink');
    };
  }, [variant]);

  return (
    <svg
      className={['ap-logo', className].filter(Boolean).join(' ')}
      data-variant={variant}
      viewBox='0 0 940 940'
      role='img'
      aria-label={label}
    >
      <defs>
        <linearGradient id={id('body')} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#2b58d8' />
          <stop offset='1' stopColor='#0f2777' />
        </linearGradient>
        <linearGradient id={id('visor')} x1='0' y1='0' x2='0' y2='1'>
          <stop offset='0' stopColor='#0c1b52' />
          <stop offset='1' stopColor='#0a1744' />
        </linearGradient>
        {/* bar stroke: lime (left cap) → bright green (spike) → mint (right cap) */}
        <linearGradient id={id('bar')} gradientUnits='userSpaceOnUse' x1='120' y1='0' x2='835' y2='0'>
          <stop offset='0' stopColor='#7cfd2f' />
          <stop offset='.40' stopColor='#83f838' />
          <stop offset='.60' stopColor='#53dc6e' />
          <stop offset='1' stopColor='#48d082' />
        </linearGradient>
        <linearGradient id={id('fill')} gradientUnits='userSpaceOnUse' x1='125' y1='0' x2='400' y2='0'>
          <stop offset='0' stopColor='#1cc158' />
          <stop offset='1' stopColor='#1c9c6a' />
        </linearGradient>
        <filter id={id('glow-s')} x='-60%' y='-60%' width='220%' height='220%'>
          <feGaussianBlur stdDeviation='9' />
        </filter>
        <filter id={id('glow-m')} x='-30%' y='-60%' width='160%' height='220%'>
          <feGaussianBlur stdDeviation='20' />
        </filter>
        <filter id={id('glow-trace')} x='-10%' y='-60%' width='120%' height='220%'>
          <feGaussianBlur stdDeviation='7' result='b' />
          <feMerge>
            <feMergeNode in='b' />
            <feMergeNode in='SourceGraphic' />
          </feMerge>
        </filter>
        <clipPath id={id('visor-clip')}>
          <rect x='245' y='300' width='450' height='260' rx='105' />
        </clipPath>
        <clipPath id={id('house-clip')}>
          <rect x='70' y='612' width='800' height='190' rx='95' />
          <path d='M330 780 A180 180 0 0 0 610 780 Z' />
        </clipPath>
      </defs>

      <g className='lg-head'>
        {/* antenna */}
        <g className='lg-antenna'>
          <rect x='455' y='100' width='30' height='85' rx='8' fill='#1c3f9c' stroke='#0b163f' strokeWidth='10' />
          <circle cx='470' cy='85' r='46' fill='#1c3f9c' stroke='#0b163f' strokeWidth='10' />
          <circle className='lg-led-glow' cx='470' cy='85' r='24' fill='#2ee6f0' filter={url('glow-s')} />
          <circle className='lg-led' cx='470' cy='85' r='20' fill='#2ee6f0' />
        </g>

        {/* ear caps */}
        <rect x='98' y='388' width='80' height='154' rx='34' fill='#1c3f9c' stroke='#0b163f' strokeWidth='10' />
        <rect x='118' y='414' width='40' height='102' rx='18' fill='#1fb6d8' opacity='.9' />
        <rect x='762' y='388' width='80' height='154' rx='34' fill='#1c3f9c' stroke='#0b163f' strokeWidth='10' />
        <rect x='782' y='414' width='40' height='102' rx='18' fill='#1fb6d8' opacity='.9' />

        {/* dome */}
        <path d='M180 614 V460 A290 290 0 0 1 760 460 V614 Z' fill={url('body')} stroke='#0b163f' strokeWidth='12' strokeLinejoin='round' />
        <path d='M210 614 V465 A260 260 0 0 1 730 465 V614' fill='none' stroke='#22c5e8' strokeWidth='9' opacity='.75' />
        <path d='M565 214 V300' fill='none' stroke='#22c5e8' strokeWidth='9' opacity='.75' />

        {/* visor + eyes */}
        <rect x='245' y='300' width='450' height='260' rx='105' fill={url('visor')} stroke='#22c5e8' strokeWidth='12' />
        <g clipPath={url('visor-clip')}>
          <g className='lg-pupils' ref={pupilsRef}>
            <g className='lg-eye lg-eye-l'>
              <circle className='lg-eye-glow' cx='365' cy='440' r='36' fill='#2ee6f0' filter={url('glow-s')} />
              <circle className='lg-eye-dot' cx='365' cy='440' r='30' fill='#2ee6f0' />
            </g>
            <g className='lg-eye lg-eye-r'>
              <circle className='lg-eye-glow' cx='575' cy='440' r='36' fill='#2ee6f0' filter={url('glow-s')} />
              <circle className='lg-eye-dot' cx='575' cy='440' r='30' fill='#2ee6f0' />
            </g>
          </g>
        </g>
      </g>

      {/* chin (behind the housing) */}
      <path d='M330 780 A180 180 0 0 0 610 780 Z' fill='#0a2a55' stroke='#07183d' strokeWidth='10' />

      {/* bar housing + contained glow */}
      <rect x='70' y='612' width='800' height='190' rx='95' fill='#06224a' stroke='#07183d' strokeWidth='10' />
      <g className='lg-bar-glow' clipPath={url('house-clip')}>
        <path d={LOGO_FULL_PATH_D} fill='none' stroke='#22c55e' strokeWidth='90' strokeLinecap='round' strokeLinejoin='round' opacity='.45' filter={url('glow-m')} />
        <path d={LOGO_FULL_PATH_D} fill='none' stroke='#22c55e' strokeWidth='44' strokeLinecap='round' strokeLinejoin='round' opacity='.55' filter={url('glow-s')} />
      </g>

      {/* capsule interiors */}
      <path className='lg-fill-l' d='M372 662 H165 A43 43 0 0 0 165 748 H396 Z' fill={url('fill')} />
      <path className='lg-fill-r' d='M572 662 H790 A43 43 0 0 1 790 748 H556 Z' fill='#1c9c6a' />

      {/* outline: the ECG line is part of the capsule stroke; the dash gap hides
          the run under the spike so the spike can animate alone. */}
      <g className='lg-trace-g'>
        <path className='lg-outline' pathLength={1000} strokeDasharray={LOGO_OUTLINE_DASH} d={LOGO_OUTLINE_D}
          fill='none' stroke={url('bar')} strokeWidth='24' strokeLinecap='round' strokeLinejoin='round' />
        <path className='lg-spike' d={LOGO_SPIKE_D}
          fill='none' stroke={url('bar')} strokeWidth='24' strokeLinecap='round' strokeLinejoin='round' />
        {/* comet + lead dot travel the full continuous path (alive only) */}
        <path className='lg-trace' pathLength={100} d={LOGO_FULL_PATH_D}
          fill='none' stroke='#f4fff6' strokeWidth='24' strokeLinecap='round' strokeLinejoin='round' filter={url('glow-trace')} />
        <path className='lg-trace-dot' pathLength={100} d={LOGO_FULL_PATH_D}
          fill='none' stroke='#ffffff' strokeWidth='34' strokeLinecap='round' strokeLinejoin='round' />
      </g>
    </svg>
  );
};

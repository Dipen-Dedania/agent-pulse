import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { AnimatedLogo } from '../AnimatedLogo';
import { LOGO_FULL_PATH_D, LOGO_OUTLINE_D, LOGO_OUTLINE_DASH, LOGO_SPIKE_D } from '../../../../common/logo-geometry';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AnimatedLogo', () => {
  it('renders an accessible image with the variant on the root', () => {
    const { getByRole } = render(<AnimatedLogo variant='alive' className='w-24 h-24' />);
    const svg = getByRole('img');
    expect(svg).toHaveAttribute('aria-label', 'Agent Pulse');
    expect(svg.getAttribute('data-variant')).toBe('alive');
    expect(svg.getAttribute('class')).toContain('ap-logo');
    expect(svg.getAttribute('class')).toContain('w-24 h-24');
  });

  it('defaults to the static variant and uses the shared geometry', () => {
    const { container } = render(<AnimatedLogo />);
    expect(container.querySelector('svg')!.getAttribute('data-variant')).toBe('static');
    expect(container.querySelector('.lg-outline')!.getAttribute('d')).toBe(LOGO_OUTLINE_D);
    expect(container.querySelector('.lg-outline')!.getAttribute('stroke-dasharray')).toBe(LOGO_OUTLINE_DASH);
    expect(container.querySelector('.lg-spike')!.getAttribute('d')).toBe(LOGO_SPIKE_D);
    expect(container.querySelector('.lg-trace')!.getAttribute('d')).toBe(LOGO_FULL_PATH_D);
  });

  it('gives every instance unique gradient ids so two logos can share a document', () => {
    const { container } = render(
      <>
        <AnimatedLogo />
        <AnimatedLogo />
      </>,
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(ids.length).toBe(8);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('blinks on a timer in the alive variant and cleans up on unmount', () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no double-blink branch
    const { container, unmount } = render(<AnimatedLogo variant='alive' />);
    const pupils = container.querySelector('.lg-pupils')!;
    expect(pupils.classList.contains('is-blink')).toBe(false);

    // First blink is scheduled 600 + 0.5*2400 = 1800ms after mount, lasts 120ms.
    act(() => { vi.advanceTimersByTime(1800); });
    expect(pupils.classList.contains('is-blink')).toBe(true);
    act(() => { vi.advanceTimersByTime(120); });
    expect(pupils.classList.contains('is-blink')).toBe(false);

    unmount();
    expect(() => { act(() => { vi.advanceTimersByTime(60_000); }); }).not.toThrow();
  });

  it('does not schedule blinks when the user prefers reduced motion', () => {
    vi.useFakeTimers();
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    Object.defineProperty(window, 'matchMedia', { value: matchMedia, configurable: true, writable: true });
    const { container } = render(<AnimatedLogo variant='alive' />);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(container.querySelector('.lg-pupils')!.classList.contains('is-blink')).toBe(false);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  });

  it('never blinks in the static variant', () => {
    vi.useFakeTimers();
    const { container } = render(<AnimatedLogo variant='static' />);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(container.querySelector('.lg-pupils')!.classList.contains('is-blink')).toBe(false);
  });
});

// Three copies of the mark exist on purpose (the static asset, the floating
// splash window's static page, and the React component). This guards against
// them drifting apart.
describe('logo geometry stays in sync across copies', () => {
  const root = process.cwd();
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('public/assets/logo.svg carries the shared outline, spike and dash', () => {
    const svg = read('public/assets/logo.svg');
    expect(svg).toContain(`d="${LOGO_OUTLINE_D}"`);
    expect(svg).toContain(`d="${LOGO_SPIKE_D}"`);
    expect(svg).toContain(`d="${LOGO_FULL_PATH_D}"`);
    expect(svg).toContain(`stroke-dasharray="${LOGO_OUTLINE_DASH}"`);
  });

  it('public/splash.html carries the shared outline, spike and dash, and stays script-free', () => {
    const html = read('public/splash.html');
    expect(html).toContain(`d="${LOGO_OUTLINE_D}"`);
    expect(html).toContain(`d="${LOGO_SPIKE_D}"`);
    expect(html).toContain(`d="${LOGO_FULL_PATH_D}"`);
    expect(html).toContain(`stroke-dasharray="${LOGO_OUTLINE_DASH}"`);
    // Static by design: it must paint the instant its window exists, and its
    // CSP forbids scripts anyway.
    expect(html).not.toContain('<script');
    expect(html).toMatch(/background:\s*transparent/);
  });

  it('index.html no longer carries an in-window splash', () => {
    const html = read('index.html');
    expect(html).not.toContain('ap-splash');
    expect(html).not.toContain('splash-gate');
  });
});

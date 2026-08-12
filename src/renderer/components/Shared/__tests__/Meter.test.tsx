import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Meter } from '../Meter';

// The track is the root element; the fill is its only child.
const parts = (ui: React.ReactElement) => {
  const track = render(ui).container.firstElementChild as HTMLElement;
  return { track, fill: track.firstElementChild as HTMLElement };
};

describe('Meter', () => {
  it('renders a labelled progressbar with the clamped value', () => {
    const { track } = parts(<Meter value={42.4} ariaLabel='Download progress' />);
    expect(track).toHaveAttribute('role', 'progressbar');
    expect(track).toHaveAttribute('aria-label', 'Download progress');
    expect(track).toHaveAttribute('aria-valuenow', '42');
    expect(track).toHaveAttribute('aria-valuemin', '0');
    expect(track).toHaveAttribute('aria-valuemax', '100');
  });

  it('clamps out-of-range and non-finite values', () => {
    expect(parts(<Meter value={140} />).fill.style.width).toBe('100%');
    expect(parts(<Meter value={-20} />).fill.style.width).toBe('0%');
    expect(parts(<Meter value={NaN} />).fill.style.width).toBe('0%');
  });

  it('colours from classes by default and sizes from the size prop', () => {
    const { track, fill } = parts(
      <Meter value={50} size='md' trackClass='bg-control/50' fillClass='bg-blue-500' />,
    );
    expect(track.className).toContain('h-2');
    expect(track.className).toContain('w-full');
    expect(track.className).toContain('bg-control/50');
    expect(fill.className).toContain('bg-blue-500');
    // CSS transition unless framer-motion is driving the width.
    expect(fill.className).toContain('motion-reduce:transition-none');
    expect(track.style.background).toBe('');
  });

  it('paints from CSS colours and pixel dimensions for the bubble', () => {
    const { track, fill } = parts(
      <Meter
        value={30}
        width={44}
        height={3}
        trackColor='rgba(255,255,255,0.10)'
        fillColor='rgba(34,197,94,0.7)'
      />,
    );
    expect(track.style.width).toBe('44px');
    expect(track.style.height).toBe('3px');
    expect(track.style.background).toBe('rgba(255, 255, 255, 0.1)');
    expect(fill.style.background).toBe('rgba(34, 197, 94, 0.7)');
    // An explicit height/width replaces the size + full-width defaults.
    expect(track.className).not.toContain('h-1.5');
    expect(track.className).not.toContain('w-full');
  });

  it('floors a non-zero value at minWidthPct but leaves zero empty', () => {
    expect(parts(<Meter value={0.4} minWidthPct={2} />).fill.style.width).toBe('2%');
    expect(parts(<Meter value={0} minWidthPct={2} />).fill.style.width).toBe('0%');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Segmented, type SegmentedOption } from '../Segmented';

const OPTIONS: SegmentedOption[] = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('Segmented', () => {
  it('renders a radiogroup of radio pills and fires onChange on click', () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value='a' onChange={onChange} ariaLabel='Mode' />);
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(radios[1].getAttribute('aria-checked')).toBe('false');
    fireEvent.click(radios[1]);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('gives only the active pill a tabIndex of 0 (roving focus)', () => {
    render(<Segmented options={OPTIONS} value='b' onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios[0].tabIndex).toBe(-1);
    expect(radios[1].tabIndex).toBe(0);
    expect(radios[2].tabIndex).toBe(-1);
  });

  it('keeps the group keyboard-reachable when `value` matches no option', () => {
    render(<Segmented options={OPTIONS} value='' onChange={() => {}} />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves the selection with ArrowRight, and jumps with Home / End', () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value='a' onChange={onChange} />);
    const group = screen.getByRole('radiogroup');

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('b');

    onChange.mockClear();
    fireEvent.keyDown(group, { key: 'End' });
    expect(onChange).toHaveBeenCalledWith('c');

    onChange.mockClear();
    fireEvent.keyDown(group, { key: 'Home' });
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('wraps selection with ArrowLeft from the first option', () => {
    const onChange = vi.fn();
    render(<Segmented options={OPTIONS} value='a' onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('applies the xs size classes', () => {
    render(<Segmented options={OPTIONS} value='a' onChange={() => {}} size='xs' />);
    const radio = screen.getAllByRole('radio')[0];
    expect(radio.className).toContain('text-[11px]');
    expect(radio.className).toContain('px-2');
    expect(radio.className).toContain('py-0.5');
  });

  it('adds flex-wrap to the track only when `wrap` is set', () => {
    const { rerender } = render(<Segmented options={OPTIONS} value='a' onChange={() => {}} />);
    expect(screen.getByRole('radiogroup').className).not.toContain('flex-wrap');

    rerender(<Segmented options={OPTIONS} value='a' onChange={() => {}} wrap />);
    expect(screen.getByRole('radiogroup').className).toContain('flex-wrap');
  });

  it('gives an icon-only option an accessible name from `hint` and renders the icon', () => {
    const iconOptions: SegmentedOption[] = [
      { value: 'light', icon: <svg data-testid='icon-light' />, hint: 'Light' },
      { value: 'dark', icon: <svg data-testid='icon-dark' />, hint: 'Dark' },
    ];
    render(<Segmented options={iconOptions} value='light' onChange={() => {}} />);
    const radio = screen.getByRole('radio', { name: 'Light' });
    expect(radio.contains(screen.getByTestId('icon-light'))).toBe(true);
  });

  it('still renders a plain label pill with no hint and no radiogroup name', () => {
    render(<Segmented options={OPTIONS} value='a' onChange={() => {}} />);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByRole('radiogroup').hasAttribute('aria-label')).toBe(false);
  });
});

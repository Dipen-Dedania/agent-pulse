import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Input, Textarea } from '../Input';

describe('Input', () => {
  it('is a .glass-control field at the md tier by default', () => {
    const el = render(<Input />).container.firstElementChild!;
    expect(el.tagName).toBe('INPUT');
    expect(el.className).toContain('glass-control');
    // md tier owns padding + text size
    expect(el.className).toContain('px-3');
    expect(el.className).toContain('py-1.5');
    expect(el.className).toContain('text-sm');
    // no width — inline fields must stay content-sized (flex handles stretch)
    expect(el.className).not.toContain('w-full');
    expect(el).not.toHaveAttribute('aria-invalid');
  });

  it('maps each size tier to its padding + text size', () => {
    const cls = (size: 'xs' | 'sm' | 'md') =>
      render(<Input size={size} />).container.firstElementChild!.className;
    expect(cls('xs')).toContain('px-2 py-1 text-xs');
    expect(cls('sm')).toContain('px-2 py-1 text-sm');
    expect(cls('md')).toContain('px-3 py-1.5 text-sm');
  });

  it('never leaks the size tier onto the DOM as the native numeric size attr', () => {
    // React.InputHTMLAttributes declares `size?: number`; the props type Omits it
    // so 'sm' can't reach the element and trip a React warning / odd width.
    const el = render(<Input size='sm' />).container.firstElementChild!;
    expect(el).not.toHaveAttribute('size');
  });

  it('invalid adds a red rim and aria-invalid', () => {
    const el = render(<Input invalid />).container.firstElementChild!;
    expect(el.className).toContain('border-red-500/50');
    expect(el).toHaveAttribute('aria-invalid', 'true');
  });

  it('passes native props through and appends className last', () => {
    const el = render(
      <Input type='number' min={5} placeholder='30' className='w-28 text-right' />,
    ).container.firstElementChild!;
    expect(el).toHaveAttribute('type', 'number');
    expect(el).toHaveAttribute('min', '5');
    expect(el).toHaveAttribute('placeholder', '30');
    expect(el.className).toContain('w-28');
    expect(el.className.trimEnd().endsWith('w-28 text-right')).toBe(true);
  });
});

describe('Textarea', () => {
  it('shares the Input material and adds vertical resize', () => {
    const el = render(<Textarea rows={4} />).container.firstElementChild!;
    expect(el.tagName).toBe('TEXTAREA');
    expect(el.className).toContain('glass-control');
    expect(el.className).toContain('resize-y');
    expect(el.className).toContain('leading-relaxed');
    expect(el).toHaveAttribute('rows', '4');
  });

  it('uses the overlay scrollbar, not the OS one', () => {
    // A textarea scrolls its own content; without .apple-scroll the overflow
    // renders as the chunky Windows scrollbar with arrow buttons.
    const el = render(<Textarea />).container.firstElementChild!;
    expect(el.className).toContain('apple-scroll');
  });

  it('honours the size tier', () => {
    const el = render(<Textarea size='xs' />).container.firstElementChild!;
    expect(el.className).toContain('px-2 py-1 text-xs');
  });
});

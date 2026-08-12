import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { IconButton } from '../IconButton';

// Return this render's own button — several of the cases below render more than
// once, and a document-wide `screen` query would match all of them.
const btn = (props: Partial<React.ComponentProps<typeof IconButton>> = {}) =>
  render(<IconButton aria-label='Dismiss' {...props}>✕</IconButton>)
    .container.firstElementChild as HTMLButtonElement;

describe('IconButton', () => {
  it('defaults to a medium neutral circle and never submits a form', () => {
    const el = btn();
    expect(el).toHaveAttribute('type', 'button');
    expect(el.className).toContain('rounded-full');
    expect(el.className).toContain('w-7 h-7');
    expect(el.className).toContain('bg-control/60');
    expect(el.className).toContain('flex items-center justify-center');
  });

  it('maps size and shape onto the box', () => {
    expect(btn({ size: 'sm', shape: 'square' }).className).toContain('w-6 h-6');
    expect(btn({ size: 'sm', shape: 'square' }).className).toContain('rounded-md');
    expect(btn({ size: 'lg' }).className).toContain('w-9 h-9');
  });

  it('maps each tone to its resting fill', () => {
    expect(btn({ tone: 'danger' }).className).toContain('hover:bg-red-500/30');
    expect(btn({ tone: 'ghost' }).className).toContain('bg-transparent');
    expect(btn({ tone: 'outline' }).className).toContain('border-edge/60');
  });

  it('forwards click, disabled, and extra layout classes', () => {
    const onClick = vi.fn();
    const el = btn({ onClick, className: 'ml-auto' });
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledOnce();
    expect(el.className).toContain('ml-auto');

    const off = btn({ onClick, disabled: true, 'aria-label': 'Move up' });
    fireEvent.click(off);
    expect(onClick).toHaveBeenCalledOnce(); // still 1 — the disabled one didn't fire
    expect(off.className).toContain('disabled:opacity-30');
  });
});

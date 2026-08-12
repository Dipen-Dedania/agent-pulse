import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('is a rounded-md bordered tag by default', () => {
    const root = render(<Badge>hi</Badge>).container.firstElementChild!;
    expect(root.className).toContain('rounded-md');
    expect(root.className).toContain('border');
    expect(root.className).toContain('text-[11px]');
    // neutral tone
    expect(root.className).toContain('bg-control/40');
    // no dot unless asked
    expect(root.querySelector('[aria-hidden]')).toBeNull();
  });

  it('pill + dot + uppercase renders the state-pill shape', () => {
    const root = render(
      <Badge tone='warn' variant='pill' dot uppercase size='xs' role='status' aria-live='polite'>
        Rate-limited
      </Badge>,
    ).container.firstElementChild!;
    expect(root.className).toContain('rounded-full');
    expect(root.className).toContain('uppercase');
    expect(root.className).toContain('text-[10px]');
    expect(root.className).toContain('bg-amber-500/15');
    expect(root).toHaveAttribute('role', 'status');
    // dot present, in the tone colour
    const dot = root.querySelector('[aria-hidden]')!;
    expect(dot.className).toContain('bg-warn');
  });

  it('maps each tone to its chip background', () => {
    const bg = (tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger') =>
      render(<Badge tone={tone}>x</Badge>).container.firstElementChild!.className;
    expect(bg('info')).toContain('bg-blue-500/10');
    expect(bg('ok')).toContain('bg-emerald-500/15');
    expect(bg('danger')).toContain('bg-red-500/15');
  });

  it('sizes own font size and horizontal padding', () => {
    const cls = (size: 'xs' | 'sm' | 'md') =>
      render(<Badge size={size}>x</Badge>).container.firstElementChild!.className;
    // xs/sm keep the original px-2 so the InfoPill/StatePill callers that
    // predate `md` render exactly as before.
    expect(cls('xs')).toContain('text-[10px]');
    expect(cls('xs')).toContain('px-2');
    expect(cls('sm')).toContain('text-[11px]');
    expect(cls('sm')).toContain('px-2');
    expect(cls('md')).toContain('text-xs');
    expect(cls('md')).toContain('px-2.5');
  });

  it('leaves font weight inherited unless asked', () => {
    const plain = render(<Badge>x</Badge>).container.firstElementChild!.className;
    expect(plain).not.toContain('font-medium');
    expect(plain).not.toContain('font-semibold');
    expect(render(<Badge weight='medium'>x</Badge>).container.firstElementChild!.className)
      .toContain('font-medium');
    expect(render(<Badge weight='semibold'>x</Badge>).container.firstElementChild!.className)
      .toContain('font-semibold');
  });
});

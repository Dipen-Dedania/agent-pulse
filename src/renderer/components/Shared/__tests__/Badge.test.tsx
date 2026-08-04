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
});

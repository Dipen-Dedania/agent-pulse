import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Spinner } from '../Spinner';

// The ring is a pure presentational primitive — lock the accessible role/name,
// the size→dimension mapping, and that caller className is merged (not dropped).

describe('Spinner', () => {
  it('exposes a status role with a default accessible name', () => {
    const { getByRole } = render(<Spinner />);
    const ring = getByRole('status');
    expect(ring).toHaveAttribute('aria-label', 'Loading');
    // Always the glass-blue ring signature.
    expect(ring.className).toContain('animate-spin');
    expect(ring.className).toContain('border-t-blue-400');
  });

  it('maps each size to its dimensions', () => {
    // Scope to each render's own container — bound role queries default to
    // document.body, which would see every previously-rendered ring.
    expect(render(<Spinner size='xs' />).container.querySelector('[role=status]')!.className).toContain('w-3 h-3');
    expect(render(<Spinner size='sm' />).container.querySelector('[role=status]')!.className).toContain('w-3.5 h-3.5');
    expect(render(<Spinner size='md' />).container.querySelector('[role=status]')!.className).toContain('w-4 h-4');
  });

  it('defaults to the sm size', () => {
    expect(render(<Spinner />).getByRole('status').className).toContain('w-3.5 h-3.5');
  });

  it('honours a custom aria-label and merges extra classes', () => {
    const { getByRole } = render(<Spinner ariaLabel='Running' className='mt-0.5 shrink-0' />);
    const ring = getByRole('status');
    expect(ring).toHaveAttribute('aria-label', 'Running');
    expect(ring.className).toContain('mt-0.5');
    expect(ring.className).toContain('shrink-0');
  });
});

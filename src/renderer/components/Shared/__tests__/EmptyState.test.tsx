import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders a centered muted line by default', () => {
    const { container, getByText } = render(<EmptyState message='No data yet.' />);
    getByText('No data yet.');
    const root = container.firstElementChild!;
    expect(root.className).toContain('py-8');
    expect(root.className).toContain('text-faint');
    expect(root.className).not.toContain('glass-secondary');
  });

  it('wraps in a glass panel when boxed', () => {
    const { container, getByText } = render(<EmptyState boxed>Nothing here.</EmptyState>);
    getByText('Nothing here.');
    const root = container.firstElementChild!;
    expect(root.className).toContain('glass-secondary');
    expect(root.className).toContain('text-center');
  });

  it('prefers children over message and appends className', () => {
    const { container, getByText, queryByText } = render(
      <EmptyState message='ignored' className='mt-4'>picked</EmptyState>,
    );
    getByText('picked');
    expect(queryByText('ignored')).toBeNull();
    expect(container.firstElementChild!.className).toContain('mt-4');
  });
});

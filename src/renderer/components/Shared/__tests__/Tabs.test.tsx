import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs } from '../Tabs';

const TABS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('Tabs', () => {
  it('renders a tablist with aria-selected on the active tab and fires onChange', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} value='a' onChange={onChange} ariaLabel='Sections' />);
    const list = screen.getByRole('tablist', { name: 'Sections' });
    expect(list).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('is w-fit by default and stretches pills equally with `fill`', () => {
    const { rerender } = render(<Tabs tabs={TABS} value='a' onChange={() => {}} />);
    let list = screen.getByRole('tablist');
    expect(list.className).not.toContain('w-full');
    expect(screen.getAllByRole('tab')[0].className).not.toContain('flex-1');

    rerender(<Tabs tabs={TABS} value='a' onChange={() => {}} fill />);
    list = screen.getByRole('tablist');
    expect(list.className).toContain('w-full');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('flex-1');
    }
  });

  it('renders an icon before the label when provided', () => {
    render(
      <Tabs
        tabs={[{ value: 'a', label: 'Alpha', icon: <svg data-testid='icon' /> }]}
        value='a'
        onChange={() => {}}
      />,
    );
    const tab = screen.getByRole('tab');
    const icon = screen.getByTestId('icon');
    expect(tab.contains(icon)).toBe(true);
    // Icon precedes the label text in DOM order.
    expect(icon.compareDocumentPosition(screen.getByText('Alpha')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders a red dot + sr-only text for `badge: true`, nothing when falsy', () => {
    const { rerender } = render(
      <Tabs tabs={[{ value: 'a', label: 'Alpha', badge: true }]} value='a' onChange={() => {}} />,
    );
    const dot = screen.getByTestId('tab-badge-dot');
    expect(dot.className).toContain('bg-red-500');
    expect(screen.getByText('(new)').className).toContain('sr-only');

    rerender(<Tabs tabs={[{ value: 'a', label: 'Alpha', badge: false }]} value='a' onChange={() => {}} />);
    expect(screen.queryByTestId('tab-badge-dot')).toBeNull();
    expect(screen.queryByText('(new)')).toBeNull();
  });

  it('renders a count pill for a numeric badge and nothing for 0', () => {
    const { rerender } = render(
      <Tabs tabs={[{ value: 'a', label: 'Alpha', badge: 3 }]} value='a' onChange={() => {}} />,
    );
    const pill = screen.getByText('3');
    expect(pill.className).toContain('rounded-full');
    expect(screen.queryByTestId('tab-badge-dot')).toBeNull();

    rerender(<Tabs tabs={[{ value: 'a', label: 'Alpha', badge: 0 }]} value='a' onChange={() => {}} />);
    expect(screen.queryByText('0')).toBeNull();
  });
});

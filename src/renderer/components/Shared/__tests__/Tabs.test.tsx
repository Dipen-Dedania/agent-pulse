import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

  it('is w-fit by default and lets pills share the track by content width with `fill`', () => {
    const { rerender } = render(<Tabs tabs={TABS} value='a' onChange={() => {}} />);
    let list = screen.getByRole('tablist');
    expect(list.className).not.toContain('w-full');
    expect(screen.getAllByRole('tab')[0].className).not.toContain('flex-auto');

    rerender(<Tabs tabs={TABS} value='a' onChange={() => {}} fill />);
    list = screen.getByRole('tablist');
    expect(list.className).toContain('w-full');
    for (const tab of screen.getAllByRole('tab')) {
      // flex-auto (basis: auto) — never flex-1 / min-w-0, which would force
      // equal shares and clip long labels.
      expect(tab.className).toContain('flex-auto');
      expect(tab.className).not.toContain('flex-1');
      expect(tab.className).not.toContain('min-w-0');
    }
  });

  it('never truncates a label', () => {
    render(<Tabs tabs={TABS} value='a' onChange={() => {}} fill />);
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.querySelector('.truncate')).toBeNull();
    }
  });

  describe('icon-only collapse on narrow tracks', () => {
    const ICON_TABS = [
      { value: 'a', label: 'Alpha', icon: <svg data-testid='icon-a' /> },
      { value: 'b', label: 'Beta', icon: <svg data-testid='icon-b' /> },
      { value: 'c', label: 'Gamma' }, // no icon → must always keep its label
    ];

    // Minimal ResizeObserver stand-in: remembers the callback so the test can
    // fire a "resize" after setting the track's measured widths.
    let fire: (() => void) | null = null;
    class FakeRO {
      constructor(cb: () => void) { fire = cb; }
      observe() {}
      disconnect() {}
    }
    const setWidths = (el: Element, scrollWidth: number, clientWidth: number) => {
      Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scrollWidth });
      Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => clientWidth });
    };

    beforeEach(() => { fire = null; vi.stubGlobal('ResizeObserver', FakeRO); });
    afterEach(() => vi.unstubAllGlobals());

    it('hides labels (sr-only) for icon tabs when the row overflows, keeps accessible names', () => {
      render(<Tabs tabs={ICON_TABS} value='a' onChange={() => {}} fill />);
      const list = screen.getByRole('tablist');
      expect(screen.getByText('Alpha').className).not.toContain('sr-only');

      setWidths(list, 900, 800); // content wider than the track
      act(() => fire?.());

      expect(screen.getByText('Alpha').className).toContain('sr-only');
      expect(screen.getByText('Beta').className).toContain('sr-only');
      expect(screen.getByText('Gamma').className).not.toContain('sr-only');
      // Accessible names survive the collapse.
      expect(screen.getByRole('tab', { name: 'Alpha' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'Gamma' })).toBeTruthy();
    });

    it('stays collapsed until the track can hold the full row, then re-expands', () => {
      render(<Tabs tabs={ICON_TABS} value='a' onChange={() => {}} fill />);
      const list = screen.getByRole('tablist');
      setWidths(list, 900, 800);
      act(() => fire?.());
      expect(screen.getByText('Alpha').className).toContain('sr-only');

      // Collapsed row now fits (scrollWidth == clientWidth) but the track is
      // still narrower than the remembered full width → stay collapsed.
      setWidths(list, 850, 850);
      act(() => fire?.());
      expect(screen.getByText('Alpha').className).toContain('sr-only');

      setWidths(list, 950, 950);
      act(() => fire?.());
      expect(screen.getByText('Alpha').className).not.toContain('sr-only');
    });

    it('does nothing when no tab has an icon', () => {
      render(<Tabs tabs={TABS} value='a' onChange={() => {}} fill />);
      expect(fire).toBeNull(); // observer never created
    });
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

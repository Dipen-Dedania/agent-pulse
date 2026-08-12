import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { InfoTooltip } from '../InfoTooltip';
import { Tooltip } from '../Tooltip';

// Geometry isn't asserted — jsdom reports every element as 0×0, so the shared
// placement math has nothing real to measure. What matters here is the
// open/close contract each surface promises, since they differ on purpose.

describe('InfoTooltip', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('opens immediately on hover and closes after the grace period', () => {
    render(<InfoTooltip label='How ship rate is computed'>Shipped ÷ executed.</InfoTooltip>);
    const trigger = screen.getByRole('button', { name: 'How ship rate is computed' });

    expect(screen.queryByRole('tooltip')).toBeNull();

    // No open delay — the icon exists only to be hovered.
    fireEvent.mouseEnter(trigger);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Shipped ÷ executed.');

    // Leaving keeps it up briefly so the cursor can travel onto the panel.
    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('opens on keyboard focus too', () => {
    render(<InfoTooltip>Body</InfoTooltip>);
    fireEvent.focus(screen.getByRole('button', { name: 'More info' }));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});

describe('Tooltip', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('waits out the open delay, then closes immediately on leave', () => {
    render(<Tooltip content='Delete webhook'><button>✕</button></Tooltip>);
    const trigger = screen.getByRole('button');

    fireEvent.mouseEnter(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Delete webhook');

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders the child untouched when content is falsy', () => {
    render(<Tooltip content={undefined}><button>bare</button></Tooltip>);
    fireEvent.mouseEnter(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

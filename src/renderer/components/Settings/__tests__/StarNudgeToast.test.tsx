import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { StarNudgeState } from '../../../../common/star-types';
import { STAR_COPY } from '../../../../common/star-copy';
import { StarNudgeToast } from '../StarNudgeToast';

// Mock framer-motion so exit animations don't keep the toast in the DOM:
// AnimatePresence becomes a pass-through and motion.aside a plain <aside>.
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    aside: React.forwardRef(({ initial, animate, exit, transition, children, ...rest }: any, ref: any) => (
      <aside ref={ref} {...rest}>{children}</aside>
    )),
  },
}));

const invoke = vi.fn();
function installElectronMock(state: StarNudgeState) {
  invoke.mockReset();
  invoke.mockImplementation((channel: string) =>
    channel === 'star:get-state' ? Promise.resolve(state) : Promise.resolve(undefined),
  );
  Object.defineProperty(window, 'electron', {
    value: { invoke, on: vi.fn(), off: vi.fn(), send: vi.fn(), platform: 'win32' },
    configurable: true,
    writable: true,
  });
}

function pending(over: Partial<StarNudgeState> = {}): StarNudgeState {
  return { voice: 'earnest', starred: false, toastPending: true, milestoneKind: 'week', ...over };
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('StarNudgeToast', () => {
  it('renders nothing while no toast is pending', async () => {
    installElectronMock(pending({ toastPending: false }));
    render(<StarNudgeToast />);
    // Let the get-state promise settle, then assert absence.
    await Promise.resolve();
    expect(screen.queryByTestId('star-nudge-toast')).toBeNull();
  });

  it('renders nothing once starred, even if a toast was pending', async () => {
    installElectronMock(pending({ starred: true }));
    render(<StarNudgeToast />);
    await Promise.resolve();
    expect(screen.queryByTestId('star-nudge-toast')).toBeNull();
  });

  it.each([
    ['earnest', 'week'],
    ['earnest', 'backlog'],
    ['playful', 'week'],
    ['playful', 'backlog'],
  ] as const)('shows the %s voice copy for the %s milestone', async (voice, kind) => {
    installElectronMock(pending({ voice, milestoneKind: kind }));
    render(<StarNudgeToast />);
    expect(await screen.findByText(STAR_COPY[voice].toast[kind])).toBeInTheDocument();
    expect(screen.getByRole('button', { name: STAR_COPY[voice].star })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: STAR_COPY[voice].later })).toBeInTheDocument();
  });

  it('star button opens the repo via star:open and hides the toast', async () => {
    installElectronMock(pending());
    render(<StarNudgeToast />);
    fireEvent.click(await screen.findByRole('button', { name: STAR_COPY.earnest.star }));
    expect(invoke).toHaveBeenCalledWith('star:open');
    expect(screen.queryByText(STAR_COPY.earnest.toast.week)).toBeNull();
  });

  it('"not now" dismisses via star:dismiss-toast without opening anything', async () => {
    installElectronMock(pending({ voice: 'playful' }));
    render(<StarNudgeToast />);
    fireEvent.click(await screen.findByRole('button', { name: STAR_COPY.playful.later }));
    expect(invoke).toHaveBeenCalledWith('star:dismiss-toast');
    expect(invoke).not.toHaveBeenCalledWith('star:open');
    expect(screen.queryByText(STAR_COPY.playful.toast.week)).toBeNull();
  });
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { UpdaterState } from '../../../../common/updater-types';
import type { StarNudgeState } from '../../../../common/star-types';
import { STAR_COPY } from '../../../../common/star-copy';
import { UpdatesTab } from '../UpdatesTab';

function makeState(over: Partial<UpdaterState>): UpdaterState {
  return {
    status: 'available',
    currentVersion: '1.3.5',
    info: {
      version: '1.4.0',
      releaseDate: '2026-10-01T00:00:00.000Z',
      releaseName: null,
      releaseNotes: null,
      downloadPageUrl: 'https://github.com/Dipen-Dedania/agent-pulse/releases/tag/v1.4.0',
    },
    progress: null,
    errorMessage: null,
    lastCheckedAt: Date.now(),
    autoCheck: true,
    installSupported: true,
    platform: 'win32',
    whatsNew: null,
    ...over,
  };
}

const invoke = vi.fn();
function installElectronMock(state: UpdaterState, starState?: StarNudgeState) {
  invoke.mockReset();
  invoke.mockImplementation((channel: string) =>
    channel === 'updates:get-state'
      ? Promise.resolve(state)
      : channel === 'star:get-state'
        ? Promise.resolve(starState)
        : Promise.resolve(undefined),
  );
  Object.defineProperty(window, 'electron', {
    value: { invoke, on: vi.fn(), off: vi.fn(), send: vi.fn(), platform: state.platform },
    configurable: true,
    writable: true,
  });
}

// Unmount while the mock is still present — the hook's effect cleanup calls
// window.electron.off — then drop the mock so no test leaks it to another file.
afterEach(() => {
  cleanup();
  delete (window as unknown as { electron?: unknown }).electron;
});

describe('UpdatesTab — macOS check-only mode', () => {
  const macState = makeState({ platform: 'darwin', installSupported: false });

  it('shows the manual-install note and keeps the Check button enabled', async () => {
    installElectronMock(macState);
    render(<UpdatesTab />);
    expect(await screen.findByText('Manual install on macOS')).toBeInTheDocument();
    const check = screen.getByRole('button', { name: 'Check for updates' });
    expect(check).not.toBeDisabled();
  });

  it('offers "Open download page" instead of Download and opens the release URL', async () => {
    installElectronMock(macState);
    render(<UpdatesTab />);
    const open = await screen.findByRole('button', { name: 'Open download page' });
    expect(screen.queryByRole('button', { name: 'Download update' })).toBeNull();
    fireEvent.click(open);
    expect(invoke).toHaveBeenCalledWith(
      'open-external',
      'https://github.com/Dipen-Dedania/agent-pulse/releases/tag/v1.4.0',
    );
  });
});

describe('UpdatesTab — Windows', () => {
  it('shows the Download button and no macOS note', async () => {
    installElectronMock(makeState({}));
    render(<UpdatesTab />);
    expect(await screen.findByRole('button', { name: 'Download update' })).toBeInTheDocument();
    expect(screen.queryByText('Manual install on macOS')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open download page' })).toBeNull();
  });
});

describe('UpdatesTab — GitHub star nudge', () => {
  const upToDate = makeState({ status: 'not-available', info: null });
  const notStarred: StarNudgeState = { voice: 'playful', starred: false, toastPending: false, milestoneKind: null };

  it('shows the voice-specific line under "Up to date" and opens the repo on click', async () => {
    installElectronMock(upToDate, notStarred);
    render(<UpdatesTab />);
    expect(await screen.findByText(STAR_COPY.playful.upToDate)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: STAR_COPY.playful.star }));
    expect(invoke).toHaveBeenCalledWith('star:open');
    // Hides optimistically, before the broadcast lands.
    expect(screen.queryByTestId('star-nudge-up-to-date')).toBeNull();
  });

  it('stays hidden while an update is available', async () => {
    installElectronMock(makeState({}), notStarred);
    render(<UpdatesTab />);
    await screen.findByRole('button', { name: 'Download update' });
    expect(screen.queryByTestId('star-nudge-up-to-date')).toBeNull();
  });

  it('stays hidden once the user has starred', async () => {
    installElectronMock(upToDate, { ...notStarred, starred: true });
    render(<UpdatesTab />);
    await screen.findByText('Up to date');
    expect(screen.queryByTestId('star-nudge-up-to-date')).toBeNull();
  });
});

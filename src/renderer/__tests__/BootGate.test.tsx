import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import { BootGate } from '../BootGate';

// The gate holds Settings until main's deferred boot stage is done, so the
// panel never calls an IPC channel that isn't registered yet. It must never
// hold forever: a hung boot falls through after the renderer-side timeout.

const invoke = vi.fn();
const send = vi.fn();
function installElectronMock(waitBoot: () => Promise<unknown>) {
  invoke.mockReset();
  send.mockReset();
  invoke.mockImplementation((channel: string) =>
    channel === 'app:wait-boot' ? waitBoot() : Promise.resolve(undefined),
  );
  Object.defineProperty(window, 'electron', {
    value: { invoke, on: vi.fn(), off: vi.fn(), send, platform: 'win32' },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'electron');
});

describe('BootGate', () => {
  it('shows the animated logo until app:wait-boot resolves, then its children', async () => {
    let release!: (value?: unknown) => void;
    installElectronMock(() => new Promise((r) => { release = r; }));

    const { queryByText, getByRole } = render(
      <BootGate>
        <div>settings body</div>
      </BootGate>,
    );
    expect(queryByText('settings body')).toBeNull();
    expect(getByRole('status')).toHaveAttribute('aria-label', 'Starting Agent Pulse');
    expect(getByRole('img').getAttribute('data-variant')).toBe('alive');
    expect(invoke).toHaveBeenCalledWith('app:wait-boot');

    await act(async () => { release(); });
    await waitFor(() => expect(queryByText('settings body')).not.toBeNull());
  });

  it('falls through after the timeout when the boot never reports ready', () => {
    vi.useFakeTimers();
    installElectronMock(() => new Promise(() => {}));
    const { queryByText } = render(
      <BootGate timeoutMs={1000}>
        <div>settings body</div>
      </BootGate>,
    );
    expect(queryByText('settings body')).toBeNull();
    act(() => { vi.advanceTimersByTime(999); });
    expect(queryByText('settings body')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(queryByText('settings body')).not.toBeNull();
  });

  it('opens on a rejected wait as well (an older main without the handler)', async () => {
    installElectronMock(() => Promise.reject(new Error("No handler registered for 'app:wait-boot'")));
    const { queryByText } = render(
      <BootGate>
        <div>settings body</div>
      </BootGate>,
    );
    await waitFor(() => expect(queryByText('settings body')).not.toBeNull());
  });
});

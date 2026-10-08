import React, { useEffect, useState } from 'react';
import { AnimatedLogo } from './components/Shared';
import { bootMark } from './boot-marks';

/**
 * Holds the Settings panel back until the main process reports that its
 * deferred boot stage has finished, so every IPC handler the panel calls at
 * mount is registered by construction (an unregistered channel rejects with
 * "No handler registered"). In every realistic flow the wait is already over
 * by the time a user reaches Settings and this resolves instantly; the gate
 * exists for correctness, not as a visible step. A renderer-side timeout
 * guarantees a hung boot still shows the panel.
 */
export const BootGate: React.FC<{ children: React.ReactNode; timeoutMs?: number }> = ({
  children,
  timeoutMs = 8000,
}) => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let settled = false;
    const open = (why: string) => {
      if (settled) return;
      settled = true;
      setReady(true);
      bootMark(`settings-gate-open:${why}`);
    };
    bootMark('settings-wait-boot-start');
    const timer = window.setTimeout(() => open('timeout'), timeoutMs);
    window.electron
      .invoke('app:wait-boot')
      .then(() => open('ready'), () => open('error'));
    return () => {
      settled = true;
      window.clearTimeout(timer);
    };
  }, [timeoutMs]);

  if (!ready) {
    return (
      <div className='h-full grid place-items-center' role='status' aria-label='Starting Agent Pulse'>
        <AnimatedLogo variant='alive' className='w-24 h-24 drop-shadow-[0_8px_32px_rgba(59,130,246,0.35)]' />
      </div>
    );
  }
  return <>{children}</>;
};

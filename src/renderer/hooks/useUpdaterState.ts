import { useEffect, useState } from 'react';
import type { UpdaterState } from '../../common/updater-types';
import { logger } from '../../common/logger';

/**
 * Live updater state from the main process. Loads once on mount, then
 * follows every `updates:state` broadcast (the main process pushes on every
 * transition — checking, progress, downloaded — so there is no polling).
 *
 * Shared by the Updates tab (full status card) and the Settings panel
 * (badge on the Updates tab) so both read the same snapshot. `setState` is
 * exposed so IPC calls that return a fresh state can apply it directly.
 */
export function useUpdaterState(): [UpdaterState | null, (next: UpdaterState) => void] {
  const [state, setState] = useState<UpdaterState | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('updates:get-state')
      .then((s: UpdaterState) => { if (!cancelled) setState(s); })
      .catch((e: unknown) => logger.error('[useUpdaterState] failed to load state', e));
    const handler = (_e: unknown, next: UpdaterState) => setState(next);
    window.electron.on('updates:state', handler);
    return () => {
      cancelled = true;
      window.electron.off('updates:state', handler);
    };
  }, []);

  return [state, setState];
}

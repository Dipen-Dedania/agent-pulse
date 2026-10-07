import { useCallback, useEffect, useState } from 'react';
import type { StarNudgeState } from '../../common/star-types';
import { STAR_COPY, type StarCopy } from '../../common/star-copy';
import { logger } from '../../common/logger';

/**
 * GitHub star nudge state from the main process. Loads once on mount, then
 * follows every `star:state-updated` broadcast, so the title-bar icon, the
 * Updates-tab line and the milestone toast all hide together the moment any
 * one of them is clicked.
 *
 * `state` is null until the first load; callers render nothing then.
 */
export function useStarNudge(): {
  state: StarNudgeState | null;
  copy: StarCopy | null;
  /** Open the repo in the browser and stamp "starred" (hides every placement). */
  star: () => void;
  /** Answer the milestone toast with "not now" (hides the toast only). */
  dismissToast: () => void;
} {
  const [state, setState] = useState<StarNudgeState | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('star:get-state')
      .then((s: StarNudgeState) => { if (!cancelled) setState(s); })
      .catch((e: unknown) => logger.warn('[useStarNudge] failed to load state', e));
    const handler = (_e: unknown, next: StarNudgeState) => setState(next);
    window.electron.on('star:state-updated', handler);
    return () => {
      cancelled = true;
      window.electron.off('star:state-updated', handler);
    };
  }, []);

  const star = useCallback(() => {
    // Hide immediately; the broadcast confirms the persisted state right after.
    setState((s) => (s ? { ...s, starred: true, toastPending: false } : s));
    window.electron
      .invoke('star:open')
      .catch((e: unknown) => logger.warn('[useStarNudge] star:open failed', e));
  }, []);

  const dismissToast = useCallback(() => {
    setState((s) => (s ? { ...s, toastPending: false } : s));
    window.electron
      .invoke('star:dismiss-toast')
      .catch((e: unknown) => logger.warn('[useStarNudge] star:dismiss-toast failed', e));
  }, []);

  return { state, copy: state ? STAR_COPY[state.voice] : null, star, dismissToast };
}

// Pulls the main process's live LiteLLM rate table into this renderer's copy
// of src/common/pricing.ts, so cost estimates rendered here (model usage,
// scheduler value) match what the timeline computes. The renderer and main
// process are separate module instances, so each must install its own rates.
//
// usePricingSync() is safe to call from multiple components: the IPC fetch and
// the broadcast subscription run once (module singleton); each caller just
// re-renders when fresh rates arrive. Components that read prices via
// estimateCost re-render because their parent (SettingsPanel) calls the hook.

import { useEffect, useState } from 'react';
import { installRates, getPricingMeta, PricingMeta, PricingSnapshot } from '../common/pricing';
import { logger } from '../common/logger';

const listeners = new Set<() => void>();
let initialized = false;

function applySnapshot(snap: PricingSnapshot | null): void {
  if (!snap?.table?.length) return;
  installRates(snap.table, snap.meta);
  for (const l of listeners) l();
}

function ensureInit(): void {
  if (initialized) return;
  initialized = true;
  window.electron
    .invoke('llm-pricing:get')
    .then((snap: PricingSnapshot | null) => applySnapshot(snap))
    .catch((e) => logger.warn('[pricing-sync] initial fetch failed', e));
  // Stays subscribed for the window's lifetime (one Settings window).
  window.electron.on('llm-pricing:updated', (_e: unknown, snap: PricingSnapshot) =>
    applySnapshot(snap),
  );
}

/** Install live rates (once) and re-render the caller when they change. */
export function usePricingSync(): PricingMeta {
  const [meta, setMeta] = useState<PricingMeta>(getPricingMeta);
  useEffect(() => {
    const onChange = () => setMeta(getPricingMeta());
    listeners.add(onChange);
    ensureInit();
    return () => { listeners.delete(onChange); };
  }, []);
  return meta;
}

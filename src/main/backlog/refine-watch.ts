// Watches a refinement card's plan-mode session transcript and fires whenever
// the presented plan changes (latest wins), so the plan auto-attaches to the
// card without the user importing it. The external terminal gives no "session
// closed" signal, so we key off the transcript instead — and POLL rather than
// fs.watch, because the transcript file doesn't exist at launch and Windows
// file watches are unreliable. The interval is unref'd (never keeps the app
// alive) and auto-expires after a bounded TTL.

import { logger } from '../../common/logger';

const POLL_MS = 3_000;
const DEFAULT_TTL_MS = 2 * 60 * 60_000; // 2h — a planning session won't outlive this

/**
 * The change-detecting core, split out so it is testable without timers: a
 * function that, each call, reads the current plan and invokes `onPlan` only
 * when it differs from the last plan seen. Read/callback errors are swallowed
 * (logged) so a transient fs hiccup never tears the watcher down.
 */
export function createPlanTicker(
  readPlan: () => string | null,
  onPlan: (plan: string) => void,
): () => void {
  let lastPlan: string | null = null;
  return () => {
    let plan: string | null;
    try {
      plan = readPlan();
    } catch (e: any) {
      logger.warn('[Backlog/refine] plan read failed:', e?.message ?? e);
      return;
    }
    if (plan && plan !== lastPlan) {
      lastPlan = plan;
      try {
        onPlan(plan);
      } catch (e: any) {
        logger.warn('[Backlog/refine] plan attach failed:', e?.message ?? e);
      }
    }
  };
}

export interface PlanWatchDeps {
  readPlan: () => string | null;   // resolve + extract the current plan (null until one exists)
  onPlan: (plan: string) => void;  // called only when the plan text changes
  ttlMs?: number;
  intervalMs?: number;
}

// One active watch per card; a new startPlanWatch replaces any prior one.
const active = new Map<string, NodeJS.Timeout>();

export function startPlanWatch(cardId: string, deps: PlanWatchDeps): void {
  stopPlanWatch(cardId);
  const tick = createPlanTicker(deps.readPlan, deps.onPlan);
  const startedAt = Date.now();
  const ttl = deps.ttlMs ?? DEFAULT_TTL_MS;
  const timer = setInterval(() => {
    if (Date.now() - startedAt > ttl) {
      stopPlanWatch(cardId);
      return;
    }
    tick();
  }, deps.intervalMs ?? POLL_MS);
  timer.unref?.();
  active.set(cardId, timer);
}

export function stopPlanWatch(cardId: string): void {
  const timer = active.get(cardId);
  if (timer) {
    clearInterval(timer);
    active.delete(cardId);
  }
}

export function stopAllPlanWatches(): void {
  for (const cardId of [...active.keys()]) stopPlanWatch(cardId);
}

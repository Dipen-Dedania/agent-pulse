import { logger } from '../../common/logger';
import { realModels } from './models';

// Narrow sink so this module doesn't depend on the concrete TimelineDb (mirrors
// LimitBackfillSink; avoids an import cycle with db.ts).
export interface SyntheticCleanupSink {
  getMeta: (key: string) => string | null;
  setMeta: (key: string, value: string) => void;
  query: <T = unknown>(sql: string, params?: unknown[]) => T[];
  raw: { prepare: (sql: string) => { run: (params?: unknown) => unknown } };
}

const MARKER = 'synthetic_models_cleanup_v1';

/**
 * One-time rewrite of `sessions.models_used` to strip pseudo-models like
 * "<synthetic>" that were recorded before the transcript-reader guard existed.
 * These leaked into the CSV and stole a share of real tokens under the
 * even-split attribution in getModelUsage, showing up as a phantom "unpriced"
 * row. Guarded by a `meta` marker so it runs at most once; a session left with
 * no real model has its column set to NULL (so the analytics queries skip it,
 * matching how a null-model session behaves). Safe to call on every boot — it
 * no-ops once the marker is set.
 */
export function maybeCleanupSyntheticModels(sink: SyntheticCleanupSink): void {
  try {
    if (sink.getMeta(MARKER)) return;
  } catch {
    // If the marker can't be read, don't risk re-running the rewrite every boot.
    return;
  }

  let rows: { id: number; models_used: string }[] = [];
  try {
    // Angle brackets only ever appear in pseudo-models, so this LIKE is a cheap
    // pre-filter — realModels() below does the authoritative check per row.
    rows = sink.query<{ id: number; models_used: string }>(
      "SELECT id, models_used FROM sessions WHERE models_used LIKE '%<%'",
    );
  } catch (e: any) {
    logger.warn('[Timeline/synthetic-cleanup] scan failed:', e?.message ?? e);
    return;
  }

  const update = sink.raw.prepare('UPDATE sessions SET models_used = @models WHERE id = @id');
  let fixed = 0;
  for (const r of rows) {
    const cleaned = realModels(r.models_used);
    const next = cleaned.length > 0 ? cleaned.join(',') : null;
    if (next === r.models_used) continue;
    try { update.run({ id: r.id, models: next }); fixed++; }
    catch (e: any) { logger.warn(`[Timeline/synthetic-cleanup] update id=${r.id} failed:`, e?.message ?? e); }
  }

  sink.setMeta(MARKER, String(Date.now()));
  logger.info(`[Timeline/synthetic-cleanup] rewrote ${fixed} session(s) to drop pseudo-models`);
}

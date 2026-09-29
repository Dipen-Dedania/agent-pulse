// Persists Claude Code statusline feed snapshots (POST /statusline) into the
// statusline_samples table. The statusline fires on every assistant message —
// far too often to store raw — so writes are throttled to one row per session
// per minute. That's plenty for the analytics cards (latest-per-session stats
// and hour/day-bucketed series).

import { TimelineDb } from './db';
import { StatusLineFeedSnapshot } from '../bridge/statusline';

const MIN_INSERT_INTERVAL_MS = 60_000;

export class StatuslineWriter {
  private lastInsert: Map<string, number> = new Map();

  constructor(private db: TimelineDb) {}

  public onSnapshot(snap: StatusLineFeedSnapshot): void {
    // Nothing chartable → skip (a bare session_id ping isn't a sample).
    if (snap.costUsd === undefined && snap.contextUsedPct === undefined && !snap.cache) return;

    const last = this.lastInsert.get(snap.sessionId) ?? 0;
    if (snap.receivedAt - last < MIN_INSERT_INTERVAL_MS) return;
    this.lastInsert.set(snap.sessionId, snap.receivedAt);

    this.db.insertStatuslineSample({
      sessionId: snap.sessionId,
      sampledAt: snap.receivedAt,
      model: snap.model ?? null,
      costUsd: snap.costUsd ?? null,
      contextUsedPct: snap.contextUsedPct ?? null,
      cacheWarm: snap.cache?.warm === undefined ? null : (snap.cache.warm ? 1 : 0),
      cacheHitRatio: snap.cache?.hitRatio ?? null,
      cacheMisses: snap.cache?.misses ?? null,
      cacheTtlS: snap.cache?.ttlSeconds ?? null,
      cacheExpiresAt: snap.cache?.expiresAt ?? null,
    });
  }
}

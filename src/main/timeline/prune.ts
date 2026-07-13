import { logger } from '../../common/logger';
import { TimelineDb } from './db';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// A full year, so every UI range (up to 1y) is backed by real data. Measured
// growth is ~126 KB/day (~46 MB/year) at heavy daily usage, so disk is not a
// constraint. Sessions are kept forever (they're tiny and drive most cards).
export const EVENTS_RETENTION_MS    = 365 * ONE_DAY_MS;
export const QUOTA_RETENTION_MS     = 365 * ONE_DAY_MS;
export const GUARDRAIL_RETENTION_MS = 365 * ONE_DAY_MS;
export const SECRET_RETENTION_MS    = 365 * ONE_DAY_MS;

export class PruneScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(private db: TimelineDb) {}

  public start() {
    this.runOnce();
    this.timer = setInterval(() => this.runOnce(), ONE_DAY_MS);
    this.timer.unref?.();
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private runOnce() {
    const now = Date.now();
    const { eventsDeleted, quotaDeleted, guardrailDeleted, secretDeleted } = this.db.prune(
      now - EVENTS_RETENTION_MS,
      now - QUOTA_RETENTION_MS,
      now - GUARDRAIL_RETENTION_MS,
      now - SECRET_RETENTION_MS,
    );
    if (eventsDeleted || quotaDeleted || guardrailDeleted || secretDeleted) {
      logger.info(`[Timeline/prune] events=${eventsDeleted} quota=${quotaDeleted} guardrail=${guardrailDeleted} secret=${secretDeleted}`);
    }
  }
}

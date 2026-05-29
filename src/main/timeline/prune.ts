import { logger } from '../../common/logger';
import { TimelineDb } from './db';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const EVENTS_RETENTION_MS    = 60 * ONE_DAY_MS;
export const QUOTA_RETENTION_MS     = 60 * ONE_DAY_MS;
export const GUARDRAIL_RETENTION_MS = 60 * ONE_DAY_MS;

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
    const { eventsDeleted, quotaDeleted, guardrailDeleted } = this.db.prune(
      now - EVENTS_RETENTION_MS,
      now - QUOTA_RETENTION_MS,
      now - GUARDRAIL_RETENTION_MS,
    );
    if (eventsDeleted || quotaDeleted || guardrailDeleted) {
      logger.info(`[Timeline/prune] events=${eventsDeleted} quota=${quotaDeleted} guardrail=${guardrailDeleted}`);
    }
  }
}

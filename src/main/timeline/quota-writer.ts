import { TimelineDb } from './db';
import {
  UsageStatus,
  CodexUsageStatus,
  AntigravityUsageStatus,
} from '../../common/types';

export class QuotaWriter {
  constructor(private db: TimelineDb) {}

  /** Persist the Claude 5h + 7d windows on every successful poll. */
  public onClaudeUsage(status: UsageStatus) {
    if (status.state !== 'ok' || !status.snapshot) return;
    const sampledAt = status.lastUpdated ?? Date.now();
    const { fiveHour, sevenDay } = status.snapshot;
    this.db.insertQuotaSample({
      toolId: 'claude-code',
      windowKey: '5h',
      pctRemaining: Math.max(0, Math.min(100, 100 - fiveHour.utilization)),
      resetsAt: fiveHour.resetsAt,
      sampledAt,
    });
    this.db.insertQuotaSample({
      toolId: 'claude-code',
      windowKey: '7d',
      pctRemaining: Math.max(0, Math.min(100, 100 - sevenDay.utilization)),
      resetsAt: sevenDay.resetsAt,
      sampledAt,
    });
  }

  /** Persist Codex primary + (when present) secondary windows. */
  public onCodexUsage(status: CodexUsageStatus) {
    if (status.state !== 'ok' || !status.snapshot) return;
    const sampledAt = status.lastUpdated ?? Date.now();
    const { primary, secondary } = status.snapshot;
    this.db.insertQuotaSample({
      toolId: 'openai-codex',
      windowKey: 'primary',
      pctRemaining: Math.max(0, Math.min(100, 100 - primary.utilization)),
      resetsAt: primary.resetsAt,
      sampledAt,
    });
    if (secondary) {
      this.db.insertQuotaSample({
        toolId: 'openai-codex',
        windowKey: 'secondary',
        pctRemaining: Math.max(0, Math.min(100, 100 - secondary.utilization)),
        resetsAt: secondary.resetsAt,
        sampledAt,
      });
    }
  }

  /** Persist one row per Antigravity model that has a real quota window. */
  public onAntigravityUsage(status: AntigravityUsageStatus) {
    if (status.state !== 'ok' || !status.snapshot) return;
    const sampledAt = status.lastUpdated ?? Date.now();
    for (const m of status.snapshot.models) {
      this.db.insertQuotaSample({
        toolId: 'antigravity-cli',
        windowKey: m.modelKey,
        pctRemaining: Math.max(0, Math.min(100, 100 - m.utilization)),
        resetsAt: m.resetsAt,
        sampledAt,
      });
    }
  }
}

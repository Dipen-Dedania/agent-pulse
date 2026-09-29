import { TimelineDb } from './db';
import {
  UsageStatus,
  CodexUsageStatus,
  CursorUsageStatus,
  AntigravityUsageStatus,
} from '../../common/types';

// Floor between inserts per tool. The pollers all run at ≥60s cadence, but the
// Claude path is also fed by statusline pushes (one per assistant message) —
// without this gate a busy session writes 2 rows per message into an
// append-only table with 365-day retention.
const MIN_INSERT_INTERVAL_MS = 60_000;

export class QuotaWriter {
  private lastInsert: Map<string, number> = new Map();

  constructor(private db: TimelineDb) {}

  private shouldInsert(toolId: string, sampledAt: number): boolean {
    const last = this.lastInsert.get(toolId) ?? 0;
    if (sampledAt - last < MIN_INSERT_INTERVAL_MS) return false;
    this.lastInsert.set(toolId, sampledAt);
    return true;
  }

  /** Persist the Claude 5h + 7d windows on every successful poll. */
  public onClaudeUsage(status: UsageStatus) {
    if (status.state !== 'ok' || !status.snapshot) return;
    const sampledAt = status.lastUpdated ?? Date.now();
    if (!this.shouldInsert('claude-code', sampledAt)) return;
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
    if (!this.shouldInsert('openai-codex', sampledAt)) return;
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

  /** Persist Cursor's single billing-cycle window. */
  public onCursorUsage(status: CursorUsageStatus) {
    if (status.state !== 'ok' || !status.snapshot) return;
    const sampledAt = status.lastUpdated ?? Date.now();
    if (!this.shouldInsert('cursor', sampledAt)) return;
    const { plan } = status.snapshot;
    this.db.insertQuotaSample({
      toolId: 'cursor',
      windowKey: 'plan',
      pctRemaining: Math.max(0, Math.min(100, 100 - plan.utilization)),
      resetsAt: plan.resetsAt,
      sampledAt,
    });
  }

  /** Persist one row per Antigravity model that has a real quota window. */
  public onAntigravityUsage(status: AntigravityUsageStatus) {
    if (status.state !== 'ok' || !status.snapshot) return;
    const sampledAt = status.lastUpdated ?? Date.now();
    if (!this.shouldInsert('antigravity-cli', sampledAt)) return;
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

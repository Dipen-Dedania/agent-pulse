import { NormalizedEvent } from '../../common/types';
import { TimelineDb } from './db';
import { resolveProject } from './project-resolver';

export interface EventsWriterOptions {
  redactTaskText: boolean;
}

// Token deltas captured by the transcript reader land here keyed by session id;
// the next event for that session picks them up and writes them onto its row.
// Cleared after attribution to avoid double-counting.
export interface TokenDelta {
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export class EventsWriter {
  private pendingTokens: Map<string, TokenDelta> = new Map();

  constructor(private db: TimelineDb, private options: EventsWriterOptions) {}

  public updateOptions(options: EventsWriterOptions) {
    this.options = options;
  }

  // Called by the transcript reader after it parses new assistant turns.
  // Stays in memory until the next event for that session flushes it.
  public stageTokenDelta(sessionId: string, delta: TokenDelta) {
    const existing = this.pendingTokens.get(sessionId);
    if (!existing) {
      this.pendingTokens.set(sessionId, delta);
      return;
    }
    this.pendingTokens.set(sessionId, {
      model: delta.model ?? existing.model,
      tokensIn:   (existing.tokensIn   ?? 0) + (delta.tokensIn   ?? 0),
      tokensOut:  (existing.tokensOut  ?? 0) + (delta.tokensOut  ?? 0),
      cacheRead:  (existing.cacheRead  ?? 0) + (delta.cacheRead  ?? 0),
      cacheWrite: (existing.cacheWrite ?? 0) + (delta.cacheWrite ?? 0),
    });
  }

  public takeTokenDelta(sessionId: string): TokenDelta | null {
    const delta = this.pendingTokens.get(sessionId);
    if (!delta) return null;
    this.pendingTokens.delete(sessionId);
    return delta;
  }

  public write(event: NormalizedEvent) {
    const { toolId, state, timestamp, payload } = event;
    const project = resolveProject(payload.cwd);
    const tokenDelta = payload.sessionId ? this.takeTokenDelta(payload.sessionId) : null;

    const taskSummary = this.options.redactTaskText ? null : (payload.taskSummary ?? null);

    this.db.insertEvent({
      toolId,
      state,
      timestamp,
      sessionId:    payload.sessionId ?? null,
      agentPid:     payload.agentPid ?? null,
      taskSummary,
      activeAgents: payload.activeAgents ?? null,
      projectId:    project?.projectId ?? null,
      projectPath:  project?.projectPath ?? null,
      model:        tokenDelta?.model ?? payload.model ?? null,
      tokensIn:     tokenDelta?.tokensIn ?? null,
      tokensOut:    tokenDelta?.tokensOut ?? null,
      cacheRead:    tokenDelta?.cacheRead ?? null,
      cacheWrite:   tokenDelta?.cacheWrite ?? null,
      errorMessage: payload.errorMessage ?? null,
    });
  }
}

import { NormalizedEvent, AgentState, ToolId } from '../../common/types';
import { TimelineDb } from './db';
import { resolveProject } from './project-resolver';
import { logger } from '../../common/logger';

export const DEFAULT_IDLE_GAP_MS = 5 * 60 * 1000;

const STATE_SEVERITY: Record<AgentState, number> = {
  idle: 0,
  'idle-active': 1,
  working: 2,
  waiting: 3,
  error: 4,
};

function worstState(a: AgentState, b: AgentState): AgentState {
  return STATE_SEVERITY[a] >= STATE_SEVERITY[b] ? a : b;
}

// A session lives in this shape until its idle-gap timer fires.
interface OpenSession {
  key: string;
  toolId: ToolId;
  projectId: string | null;
  projectPath: string | null;
  startedAt: number;
  lastActiveAt: number;
  turns: number;
  peakState: AgentState;
  taskSummary: string | null;
  hadError: boolean;
  sessionId: string | null;
  agentPid: number | null;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  modelsUsed: Set<string>;
  prevState: AgentState | null;
  closeTimer: NodeJS.Timeout | null;
}

// An event is considered "active" (keeps a session alive / opens one) if it's
// anything other than the resting idle state.
function isActive(state: AgentState): boolean {
  return state !== 'idle';
}

export class SessionsDeriver {
  private open: Map<string, OpenSession> = new Map();
  private idleGapMs: number;

  constructor(private db: TimelineDb, idleGapMs: number = DEFAULT_IDLE_GAP_MS) {
    this.idleGapMs = idleGapMs;
  }

  public setIdleGapMs(ms: number) {
    this.idleGapMs = Math.max(60_000, ms);
  }

  // Returns the snapshot of any token totals captured by the events-writer so
  // we can include them on the closed session row. The events-writer stages
  // token deltas keyed by hook session_id; we attach them when the matching
  // event flows through.
  public onEvent(event: NormalizedEvent, tokenDelta?: {
    model?: string;
    tokensIn?: number;
    tokensOut?: number;
    cacheRead?: number;
    cacheWrite?: number;
  }) {
    const { toolId, state, timestamp, payload } = event;
    const project = resolveProject(payload.cwd);
    const projectId = project?.projectId ?? null;
    const key = `${toolId}::${projectId ?? '_'}`;

    const existing = this.open.get(key);
    const active = isActive(state);

    if (!existing && !active) return; // idle event, no open session — ignore

    if (!existing && active) {
      this.openSession(key, toolId, project, timestamp, state, payload);
      return;
    }

    if (existing) {
      // Update the open session with new state + token delta.
      const prevState = existing.prevState;
      const transitionsToWorking = state === 'working' && prevState !== 'working';

      existing.lastActiveAt = active ? timestamp : existing.lastActiveAt;
      existing.peakState = worstState(existing.peakState, state);
      if (transitionsToWorking) existing.turns += 1;
      if (state === 'error') existing.hadError = true;
      if (!existing.taskSummary && payload.taskSummary) {
        existing.taskSummary = payload.taskSummary;
      }
      if (!existing.sessionId && payload.sessionId) existing.sessionId = payload.sessionId;
      if (!existing.agentPid && typeof payload.agentPid === 'number') {
        existing.agentPid = payload.agentPid;
      }
      if (tokenDelta) {
        existing.totalTokensIn   += tokenDelta.tokensIn   ?? 0;
        existing.totalTokensOut  += tokenDelta.tokensOut  ?? 0;
        existing.totalCacheRead  += tokenDelta.cacheRead  ?? 0;
        existing.totalCacheWrite += tokenDelta.cacheWrite ?? 0;
        if (tokenDelta.model) existing.modelsUsed.add(tokenDelta.model);
      }
      if (payload.model) existing.modelsUsed.add(payload.model);
      existing.prevState = state;

      // Reset close timer on every active event; idle events let the existing
      // timer keep counting toward the gap.
      if (active) this.resetCloseTimer(existing);
    }
  }

  /** Called on app shutdown — closes every open session immediately. */
  public flushAll() {
    const keys = Array.from(this.open.keys());
    for (const key of keys) {
      const session = this.open.get(key);
      if (session) this.closeSession(session, 'shutdown');
    }
  }

  /** Inspect open sessions (for tests / debugging). */
  public openCount(): number {
    return this.open.size;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private openSession(
    key: string,
    toolId: ToolId,
    project: ReturnType<typeof resolveProject>,
    timestamp: number,
    state: AgentState,
    payload: NormalizedEvent['payload'],
  ) {
    const session: OpenSession = {
      key,
      toolId,
      projectId: project?.projectId ?? null,
      projectPath: project?.projectPath ?? null,
      startedAt: timestamp,
      lastActiveAt: timestamp,
      turns: state === 'working' ? 1 : 0,
      peakState: state,
      taskSummary: payload.taskSummary ?? null,
      hadError: state === 'error',
      sessionId: payload.sessionId ?? null,
      agentPid: typeof payload.agentPid === 'number' ? payload.agentPid : null,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCacheRead: 0,
      totalCacheWrite: 0,
      modelsUsed: new Set<string>(payload.model ? [payload.model] : []),
      prevState: state,
      closeTimer: null,
    };
    this.open.set(key, session);
    this.resetCloseTimer(session);
  }

  private resetCloseTimer(session: OpenSession) {
    if (session.closeTimer) clearTimeout(session.closeTimer);
    session.closeTimer = setTimeout(() => this.closeSession(session, 'idle-gap'), this.idleGapMs);
    session.closeTimer.unref?.();
  }

  private closeSession(session: OpenSession, reason: 'idle-gap' | 'shutdown') {
    if (!this.open.has(session.key)) return;
    this.open.delete(session.key);
    if (session.closeTimer) clearTimeout(session.closeTimer);

    const hasTokens =
      session.totalTokensIn  > 0 ||
      session.totalTokensOut > 0 ||
      session.totalCacheRead > 0 ||
      session.totalCacheWrite > 0;

    const id = this.db.insertSession({
      toolId: session.toolId,
      projectId: session.projectId,
      projectPath: session.projectPath,
      startedAt: session.startedAt,
      endedAt: session.lastActiveAt,
      turns: session.turns,
      peakState: session.peakState,
      taskSummary: session.taskSummary,
      hadError: session.hadError ? 1 : 0,
      sessionId: session.sessionId,
      agentPid: session.agentPid,
      totalTokensIn:   hasTokens ? session.totalTokensIn   : null,
      totalTokensOut:  hasTokens ? session.totalTokensOut  : null,
      totalCacheRead:  hasTokens ? session.totalCacheRead  : null,
      totalCacheWrite: hasTokens ? session.totalCacheWrite : null,
      modelsUsed: session.modelsUsed.size > 0 ? Array.from(session.modelsUsed).join(',') : null,
    });
    logger.debug(
      `[Timeline/sessions] closed id=${id} tool=${session.toolId} project=${session.projectId ?? 'none'} ` +
      `duration=${session.lastActiveAt - session.startedAt}ms reason=${reason}`,
    );
  }
}

import { app } from 'electron';
import { logger } from '../../common/logger';
import { initTimelineDb, TimelineDb } from './db';
import { EventsWriter } from './events-writer';
import { SessionsDeriver, DEFAULT_IDLE_GAP_MS } from './sessions-deriver';
import { QuotaWriter } from './quota-writer';
import { StatuslineWriter } from './statusline-writer';
import { TranscriptReader } from './transcript-reader';
import { TimelineQueries } from './queries';
import { registerTimelineIpc, registerTimelineIpcUnavailable, unregisterTimelineIpc } from './ipc';
import { PruneScheduler } from './prune';
import { maybeBackfillLimitEvents } from './limit-backfill';
import { maybeCleanupSyntheticModels } from './synthetic-cleanup';
import { StatusStateManager } from '../bridge/state-manager';
import { StatusLineFeedSnapshot } from '../bridge/statusline';
import { UsagePoller } from '../usage/poller';
import { CodexUsagePoller } from '../codex-usage/poller';
import { CursorUsagePoller } from '../cursor-usage/poller';
import { AntigravityUsagePoller } from '../antigravity-usage/poller';

export interface TimelineBootOptions {
  stateManager: StatusStateManager;
  usagePoller: UsagePoller;
  codexUsagePoller: CodexUsagePoller;
  cursorUsagePoller: CursorUsagePoller;
  antigravityUsagePoller: AntigravityUsagePoller;
  redactTaskText: boolean;
  idleGapMinutes?: number;
}

export interface TimelineHandle {
  db: TimelineDb;
  // Claude Code statusline feed → statusline_samples (throttled per session).
  ingestStatusline: (snap: StatusLineFeedSnapshot) => void;
  flushSessions: () => void;
  updateOptions: (opts: { redactTaskText?: boolean; idleGapMinutes?: number }) => void;
  shutdown: () => void;
}

export function bootTimeline(opts: TimelineBootOptions): TimelineHandle | null {
  const db = initTimelineDb();
  if (!db) {
    // Still register the IPC handlers so the renderer gets a clean
    // "unavailable" response instead of "No handler registered" errors.
    registerTimelineIpcUnavailable(
      'better-sqlite3 native module is not loadable. Run `npm run rebuild:native` to rebuild it for the current Electron ABI.',
    );
    logger.info('[Timeline] boot skipped — DB unavailable; IPC handlers stubbed');
    return null;
  }

  const eventsWriter = new EventsWriter(db, { redactTaskText: opts.redactTaskText });
  const sessionsDeriver = new SessionsDeriver(
    db,
    (opts.idleGapMinutes ? opts.idleGapMinutes * 60_000 : DEFAULT_IDLE_GAP_MS),
  );
  const quotaWriter = new QuotaWriter(db);
  const statuslineWriter = new StatuslineWriter(db);
  const transcriptReader = new TranscriptReader(
    eventsWriter,
    sessionsDeriver,
    {
      loadAll: () => db.loadTranscriptOffsets(),
      save: (row) => db.saveTranscriptOffset(row),
    },
    (hits) => { for (const h of hits) db.insertLimitEvent(h); },
    // Live Codex quota: every token_count row carries rate_limits. Feed it to
    // the poller so the bubble/Settings update mid-session without hitting the
    // undocumented HTTP endpoint.
    (snapshot, sampledAt) => opts.codexUsagePoller.ingestExternal(snapshot, sampledAt),
  );

  // One-time scan of existing transcripts so the Session Limits card shows
  // history that predates this feature. Deferred off the boot path and guarded
  // by a meta marker, so it runs at most once and never blocks startup.
  setImmediate(() => {
    try { maybeBackfillLimitEvents(db); }
    catch (e) { logger.warn('[Timeline] limit backfill failed:', e); }
  });

  // One-time rewrite of sessions recorded before the "<synthetic>" guard, so
  // the pseudo-model stops appearing as a phantom row in Model usage. Same
  // deferred, marker-guarded pattern as the limit backfill above.
  setImmediate(() => {
    try { maybeCleanupSyntheticModels(db); }
    catch (e) { logger.warn('[Timeline] synthetic-model cleanup failed:', e); }
  });
  const queries = new TimelineQueries(db);
  const prune = new PruneScheduler(db);

  // ── Wire bridge event stream → events writer + sessions deriver. ─────
  const unsubEvents = opts.stateManager.onEvent((event) => {
    // Transcript reading runs first so any token delta is staged before the
    // events-writer attaches it to the row being written. Codex is triggered
    // even without a hook-supplied path — the reader resolves its rollout file
    // from the sessionId under ~/.codex/sessions.
    if (event.payload.sessionId && (event.payload.transcriptPath || event.toolId === 'openai-codex' || event.toolId === 'grok')) {
      transcriptReader.onTranscriptEvent(event.payload.transcriptPath, event.payload.sessionId, event.toolId);
    }
    // Tools that report usage INLINE (OpenCode's plugin reads the completed
    // assistant message from inside the process) skip the transcript path
    // entirely — stage their delta here so the code below treats it identically
    // to a parsed one. Already sanitized by the bridge.
    if (event.payload.sessionId && event.payload.tokens) {
      eventsWriter.stageTokenDelta(event.payload.sessionId, event.payload.tokens);
    }
    // Take the staged delta (if any) to also feed the session rollup, then
    // re-stage it for the events-writer to consume. (Simpler than wiring two
    // paths through the writer.)
    let tokenDelta: ReturnType<typeof eventsWriter.takeTokenDelta> | undefined;
    if (event.payload.sessionId) {
      tokenDelta = eventsWriter.takeTokenDelta(event.payload.sessionId);
      if (tokenDelta) eventsWriter.stageTokenDelta(event.payload.sessionId, tokenDelta);
    }
    sessionsDeriver.onEvent(event, tokenDelta ?? undefined);
    eventsWriter.write(event);
  });

  // ── Wire usage pollers → quota writer. ────────────────────────────────
  const unsubClaude = opts.usagePoller.subscribe((status) => quotaWriter.onClaudeUsage(status));
  const unsubCodex  = opts.codexUsagePoller.subscribe((status) => quotaWriter.onCodexUsage(status));
  const unsubCursor = opts.cursorUsagePoller.subscribe((status) => quotaWriter.onCursorUsage(status));
  const unsubAg     = opts.antigravityUsagePoller.subscribe((status) => quotaWriter.onAntigravityUsage(status));

  registerTimelineIpc(queries);
  prune.start();

  // Flush sessions on quit so the day's last working stretch is never lost.
  const flushSessions = () => sessionsDeriver.flushAll();
  app.once('before-quit', flushSessions);

  logger.info('[Timeline] booted');

  return {
    db,
    ingestStatusline: (snap) => {
      try { statuslineWriter.onSnapshot(snap); }
      catch (e) { logger.warn('[Timeline] statusline ingest failed:', e); }
    },
    flushSessions,
    updateOptions: (next) => {
      if (next.redactTaskText !== undefined) {
        eventsWriter.updateOptions({ redactTaskText: next.redactTaskText });
      }
      if (next.idleGapMinutes !== undefined) {
        sessionsDeriver.setIdleGapMs(next.idleGapMinutes * 60_000);
      }
    },
    shutdown: () => {
      try { unsubEvents(); } catch { /* ignore */ }
      try { unsubClaude(); } catch { /* ignore */ }
      try { unsubCodex(); }  catch { /* ignore */ }
      try { unsubCursor(); } catch { /* ignore */ }
      try { unsubAg(); }     catch { /* ignore */ }
      prune.stop();
      unregisterTimelineIpc();
      try { db.close(); } catch { /* ignore */ }
    },
  };
}

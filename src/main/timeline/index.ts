import { app } from 'electron';
import { logger } from '../../common/logger';
import { initTimelineDb, TimelineDb } from './db';
import { EventsWriter } from './events-writer';
import { SessionsDeriver, DEFAULT_IDLE_GAP_MS } from './sessions-deriver';
import { QuotaWriter } from './quota-writer';
import { TranscriptReader } from './transcript-reader';
import { TimelineQueries } from './queries';
import { registerTimelineIpc, registerTimelineIpcUnavailable, unregisterTimelineIpc } from './ipc';
import { PruneScheduler } from './prune';
import { StatusStateManager } from '../bridge/state-manager';
import { UsagePoller } from '../usage/poller';
import { CodexUsagePoller } from '../codex-usage/poller';
import { AntigravityUsagePoller } from '../antigravity-usage/poller';

export interface TimelineBootOptions {
  stateManager: StatusStateManager;
  usagePoller: UsagePoller;
  codexUsagePoller: CodexUsagePoller;
  antigravityUsagePoller: AntigravityUsagePoller;
  redactTaskText: boolean;
  idleGapMinutes?: number;
}

export interface TimelineHandle {
  db: TimelineDb;
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
  const transcriptReader = new TranscriptReader(eventsWriter, sessionsDeriver);
  const queries = new TimelineQueries(db);
  const prune = new PruneScheduler(db);

  // ── Wire bridge event stream → events writer + sessions deriver. ─────
  const unsubEvents = opts.stateManager.onEvent((event) => {
    // Transcript reading runs first so any token delta is staged before the
    // events-writer attaches it to the row being written.
    if (event.payload.transcriptPath && event.payload.sessionId) {
      transcriptReader.onTranscriptEvent(event.payload.transcriptPath, event.payload.sessionId);
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
  const unsubAg     = opts.antigravityUsagePoller.subscribe((status) => quotaWriter.onAntigravityUsage(status));

  registerTimelineIpc(queries);
  prune.start();

  // Flush sessions on quit so the day's last working stretch is never lost.
  const flushSessions = () => sessionsDeriver.flushAll();
  app.once('before-quit', flushSessions);

  logger.info('[Timeline] booted');

  return {
    db,
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
      try { unsubAg(); }     catch { /* ignore */ }
      prune.stop();
      unregisterTimelineIpc();
      try { db.close(); } catch { /* ignore */ }
    },
  };
}

// Feeds the activity_facts table from agents' session files. Keeps its own
// per-file read offset (activity_offsets), independent of the token reader's,
// so nothing here can disturb token accounting.
//
// A file is read from its stored offset to its last complete line, the chunk is
// handed to the pure extractors in activity-facts.ts, and the facts are
// inserted with INSERT OR IGNORE. The first read of a file therefore captures
// its whole history; later reads only the new tail.
//
// All file work — including finding the file — happens on a queue drained one
// job per tick, never in the hook path that called onAgentEvent.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { ToolId } from '../../common/types';
import { logger } from '../../common/logger';
import { ActivityFact, CodexThreadContext, extractClaudeFacts, extractCodexFacts } from './activity-facts';
import { findCodexRollout } from './transcript-reader';

export interface ActivitySink {
  // null = the write failed; the lines must be read again later.
  insertActivityFacts: (rows: ActivityFact[]) => number | null;
  loadActivityOffsets: () => Array<{ path: string; offset: number; context?: string | null }>;
  saveActivityOffset: (row: { path: string; offset: number; context?: string | null; updatedAt?: number | null }) => void;
}

interface OffsetEntry {
  offset: number;
  codex?: CodexThreadContext;
}

type Job =
  | { kind: 'event'; toolId: ToolId; sessionId: string; transcriptPath?: string }
  | { kind: 'file'; path: string; toolId: ToolId; sessionId: string }
  | { kind: 'codex-sweep' };

// Upper bound on one read. A longer unread stretch is consumed over several
// ticks, so a huge file can't stall the main process in one go.
const MAX_READ_BYTES = 32 * 1024 * 1024;
// Guard for the synchronous syncFile() loop (tests, tools): 64 × 32 MB.
const MAX_CHUNKS_PER_SYNC = 64;
// Codex writes child threads (subagents, auto-reviews) to their own rollout
// files that no hook points at; look for them at most this often…
const CODEX_SWEEP_INTERVAL_MS = 60_000;
// …and once more this long after the last Codex event, so whatever a session
// wrote in its final minute is still picked up.
const CODEX_TRAILING_SWEEP_MS = 90_000;
// How many of the newest day-directories a sweep lists.
const CODEX_SWEEP_DAYS = 2;
// A rollout that could not be found is looked for again after this long (it
// may simply not exist yet on a session's first event).
const CODEX_MISS_TTL_MS = 30_000;
// How often one Claude Code session's subagents folder is listed.
const SUBAGENT_LIST_INTERVAL_MS = 30_000;

export interface ActivitySyncOptions {
  codexSessionsDir?: string;                 // default ~/.codex/sessions
  resolveCodexRollout?: (sessionId: string) => string | null;
  defer?: (fn: () => void) => void;          // default setImmediate
  // Runs `fn` after `ms`; returns a cancel function. Default: an unref'd timer.
  setTimer?: (fn: () => void, ms: number) => () => void;
  now?: () => number;
  maxReadBytes?: number;                     // default MAX_READ_BYTES (tests shrink it)
}

/** Subagent transcripts Claude Code keeps beside a session: <session>/subagents/agent-*.jsonl. */
export function listClaudeSubagentFiles(transcriptPath: string): string[] {
  const dir = path.join(transcriptPath.replace(/\.jsonl$/i, ''), 'subagents');
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.startsWith('agent-') && f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f));
  } catch {
    return []; // no subagents for this session
  }
}

export class ActivitySync {
  private offsets = new Map<string, OffsetEntry>();
  private jobs = new Map<string, Job>();
  private flushScheduled = false;
  private disposed = false;
  private codexPathCache = new Map<string, { path: string | null; at: number }>();
  private subagentListedAt = new Map<string, number>();
  private oversizeWarned = new Set<string>();
  private lastCodexSweep = 0;
  private cancelTrailingSweep: (() => void) | null = null;
  private readonly codexSessionsDir: string;
  private readonly resolveCodexRollout: (sessionId: string) => string | null;
  private readonly defer: (fn: () => void) => void;
  private readonly setTimer: (fn: () => void, ms: number) => () => void;
  private readonly now: () => number;
  private readonly maxReadBytes: number;

  constructor(private sink: ActivitySink, opts: ActivitySyncOptions = {}) {
    this.codexSessionsDir = opts.codexSessionsDir ?? path.join(os.homedir(), '.codex', 'sessions');
    this.resolveCodexRollout = opts.resolveCodexRollout ?? findCodexRollout;
    this.defer = opts.defer ?? ((fn) => { setImmediate(fn); });
    this.setTimer = opts.setTimer ?? ((fn, ms) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return () => clearTimeout(t);
    });
    this.now = opts.now ?? Date.now;
    this.maxReadBytes = opts.maxReadBytes ?? MAX_READ_BYTES;
    try {
      for (const row of sink.loadActivityOffsets()) {
        let codex: CodexThreadContext | undefined;
        if (row.context) {
          try { codex = JSON.parse(row.context) as CodexThreadContext; }
          catch { /* corrupt context — re-learned if the file is re-read */ }
        }
        this.offsets.set(row.path, { offset: row.offset, codex });
      }
    } catch (e: any) {
      logger.warn('[Timeline/activity] failed to load offsets:', e?.message ?? e);
    }
  }

  /**
   * Live trigger: a hook event arrived for `sessionId`. Only records that the
   * session needs a read; locating and reading its files happens on later
   * ticks. Agents other than Claude Code and Codex are ignored.
   */
  public onAgentEvent(toolId: ToolId, sessionId: string | undefined, transcriptPath?: string): void {
    if (this.disposed || !sessionId) return;
    if (toolId !== 'claude-code' && toolId !== 'openai-codex') return;
    this.enqueue(`e:${toolId}:${sessionId}`, { kind: 'event', toolId, sessionId, transcriptPath });
    if (toolId === 'openai-codex') {
      this.cancelTrailingSweep?.();
      this.cancelTrailingSweep = this.setTimer(() => {
        this.cancelTrailingSweep = null;
        if (!this.disposed) this.enqueue('sweep', { kind: 'codex-sweep' });
      }, CODEX_TRAILING_SWEEP_MS);
    }
  }

  /**
   * Read one chunk of a file's unread tail and store its facts. `more` is true
   * when unread complete lines may remain. Synchronous; never throws.
   */
  public syncStep(filePath: string, toolId: ToolId, sessionId: string): { inserted: number; more: boolean } {
    if (this.disposed) return { inserted: 0, more: false };
    try {
      return this.readTail(filePath, toolId, sessionId);
    } catch (e: any) {
      logger.warn('[Timeline/activity] sync failed:', e?.message ?? e);
      return { inserted: 0, more: false };
    }
  }

  /** Read a file's whole unread tail in one go. For tests and one-off tools. */
  public syncFile(filePath: string, toolId: ToolId, sessionId: string): number {
    let inserted = 0;
    for (let i = 0; i < MAX_CHUNKS_PER_SYNC; i++) {
      const step = this.syncStep(filePath, toolId, sessionId);
      inserted += step.inserted;
      if (!step.more) break;
    }
    return inserted;
  }

  /**
   * Stop all work: drops the queue and timers and turns every later call into
   * a no-op. Call before closing the database.
   */
  public dispose(): void {
    this.disposed = true;
    this.jobs.clear();
    this.cancelTrailingSweep?.();
    this.cancelTrailingSweep = null;
  }

  // ─── Queue ──────────────────────────────────────────────────────────────

  private enqueue(key: string, job: Job): void {
    if (this.disposed) return;
    this.jobs.delete(key); // re-queue at the back, keeping the newest payload
    this.jobs.set(key, job);
    this.scheduleFlush();
  }

  private enqueueFile(filePath: string, toolId: ToolId, sessionId: string): void {
    this.enqueue(`f:${filePath}`, { kind: 'file', path: filePath, toolId, sessionId });
  }

  // One job per tick: a first read can be several MB, and a sweep can queue a
  // day's worth of files at once.
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.defer(() => {
      this.flushScheduled = false;
      if (this.disposed) return;
      const next = this.jobs.entries().next();
      if (next.done) return;
      const [key, job] = next.value;
      this.jobs.delete(key);
      try { this.run(job); }
      catch (e: any) { logger.warn('[Timeline/activity] job failed:', e?.message ?? e); }
      if (this.jobs.size > 0) this.scheduleFlush();
    });
  }

  private run(job: Job): void {
    if (job.kind === 'file') {
      const step = this.syncStep(job.path, job.toolId, job.sessionId);
      if (step.more) this.enqueueFile(job.path, job.toolId, job.sessionId);
      return;
    }
    if (job.kind === 'codex-sweep') {
      for (const file of this.recentCodexRollouts()) this.enqueueFile(file, 'openai-codex', '');
      return;
    }
    if (job.toolId === 'claude-code') {
      // Hook payloads are untrusted input; a relative path would resolve
      // against the app's working directory.
      if (!job.transcriptPath || !path.isAbsolute(job.transcriptPath)) return;
      const transcript = path.normalize(job.transcriptPath);
      this.enqueueFile(transcript, 'claude-code', job.sessionId);
      const now = this.now();
      if (now - (this.subagentListedAt.get(job.sessionId) ?? -Infinity) >= SUBAGENT_LIST_INTERVAL_MS) {
        this.subagentListedAt.set(job.sessionId, now);
        for (const file of listClaudeSubagentFiles(transcript)) this.enqueueFile(file, 'claude-code', job.sessionId);
      }
      return;
    }
    // Codex
    const rollout = this.codexPathFor(job.sessionId, job.transcriptPath);
    if (rollout) this.enqueueFile(rollout, 'openai-codex', job.sessionId);
    const now = this.now();
    if (now - this.lastCodexSweep >= CODEX_SWEEP_INTERVAL_MS) {
      this.lastCodexSweep = now;
      this.enqueue('sweep', { kind: 'codex-sweep' });
    }
  }

  // ─── Reading ────────────────────────────────────────────────────────────

  private readTail(rawPath: string, toolId: ToolId, sessionId: string): { inserted: number; more: boolean } {
    const idle = { inserted: 0, more: false };
    const filePath = path.normalize(rawPath);
    let size: number;
    try { size = fs.statSync(filePath).size; }
    catch { return idle; } // missing/unreadable — try again on a later event

    const tracked = this.offsets.get(filePath);
    let start = tracked?.offset ?? 0;
    let codex = tracked?.codex;
    if (start > size) { start = 0; codex = undefined; } // truncated or replaced
    if (start === size) return idle;

    const length = Math.min(size - start, this.maxReadBytes);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(filePath, 'r');
    let read: number;
    try { read = fs.readSync(fd, buffer, 0, length, start); }
    finally { fs.closeSync(fd); }

    // Consume whole lines only. Cutting at the last newline *byte* keeps the
    // offset exact even when the read ends inside a multi-byte character.
    const lastNewline = buffer.lastIndexOf(0x0a, read - 1);
    if (lastNewline < 0) {
      // A full chunk without a newline is one line longer than a chunk, which
      // would otherwise block this file forever. Drop the chunk: the rest of
      // that line arrives as an unparseable fragment and is skipped.
      if (read === this.maxReadBytes && start + read < size) {
        if (!this.oversizeWarned.has(filePath)) {
          this.oversizeWarned.add(filePath);
          logger.warn(`[Timeline/activity] skipping a line longer than ${this.maxReadBytes} bytes in ${path.basename(filePath)}`);
        }
        this.commit(filePath, start + read, codex);
        return { inserted: 0, more: true };
      }
      return idle; // a line still being written
    }
    const text = buffer.toString('utf8', 0, lastNewline);

    let facts: ActivityFact[];
    if (toolId === 'openai-codex') {
      const out = extractCodexFacts(text, codex ?? {}, this.now());
      facts = out.facts;
      codex = out.context;
    } else {
      facts = extractClaudeFacts(text, sessionId, this.now());
    }

    const inserted = this.sink.insertActivityFacts(facts);
    // Write failed (database locked, disk full): leave the offset where it
    // was so these lines are read again, rather than losing their facts.
    if (inserted === null) return idle;

    const nextOffset = start + lastNewline + 1;
    this.commit(filePath, nextOffset, codex);
    return { inserted, more: nextOffset < size };
  }

  private commit(filePath: string, offset: number, codex: CodexThreadContext | undefined): void {
    this.offsets.set(filePath, { offset, codex });
    try {
      this.sink.saveActivityOffset({
        path: filePath,
        offset,
        context: codex ? JSON.stringify(codex) : null,
        updatedAt: this.now(),
      });
    } catch (e: any) {
      logger.warn('[Timeline/activity] failed to persist offset:', e?.message ?? e);
    }
  }

  // ─── Codex file discovery ───────────────────────────────────────────────

  private codexPathFor(sessionId: string, payloadPath?: string): string | null {
    if (payloadPath && path.isAbsolute(payloadPath)) {
      try { if (fs.statSync(payloadPath).isFile()) return path.normalize(payloadPath); } catch { /* fall through */ }
    }
    const cached = this.codexPathCache.get(sessionId);
    const now = this.now();
    if (cached && (cached.path !== null || now - cached.at < CODEX_MISS_TTL_MS)) return cached.path;
    const found = this.resolveCodexRollout(sessionId);
    this.codexPathCache.set(sessionId, { path: found, at: now });
    return found;
  }

  /** Rollout files in the newest day-directories (sessions/YYYY/MM/DD). */
  private recentCodexRollouts(): string[] {
    const out: string[] = [];
    const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
    const dirs = (parent: string): string[] => {
      try {
        return fs.readdirSync(parent, { withFileTypes: true })
          .filter((d) => d.isDirectory()).map((d) => d.name).sort(desc);
      } catch { return []; }
    };
    let days = 0;
    for (const year of dirs(this.codexSessionsDir)) {
      for (const month of dirs(path.join(this.codexSessionsDir, year))) {
        for (const day of dirs(path.join(this.codexSessionsDir, year, month))) {
          const dayDir = path.join(this.codexSessionsDir, year, month, day);
          try {
            for (const file of fs.readdirSync(dayDir)) {
              if (file.startsWith('rollout-') && file.endsWith('.jsonl')) out.push(path.join(dayDir, file));
            }
          } catch { /* unreadable day — skip */ }
          if (++days >= CODEX_SWEEP_DAYS) return out;
        }
      }
    }
    return out;
  }
}

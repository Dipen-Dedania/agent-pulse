// Feeds the activity_facts table from agents' session files. Keeps its own
// per-file read offset (activity_offsets), independent of the token reader's,
// so nothing here can disturb token accounting.
//
// A file is read from its stored offset to its last complete line, the chunk is
// handed to the pure extractors in activity-facts.ts, and the facts are
// inserted with INSERT OR IGNORE. The first read of a file therefore captures
// its whole history; later reads only the new tail.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { ToolId } from '../../common/types';
import { logger } from '../../common/logger';
import { ActivityFact, CodexThreadContext, extractClaudeFacts, extractCodexFacts } from './activity-facts';
import { findCodexRollout } from './transcript-reader';

export interface ActivitySink {
  insertActivityFacts: (rows: ActivityFact[]) => number;
  loadActivityOffsets: () => Array<{ path: string; offset: number; context?: string | null }>;
  saveActivityOffset: (row: { path: string; offset: number; context?: string | null }) => void;
}

interface OffsetEntry {
  offset: number;
  codex?: CodexThreadContext;
}

// Upper bound on one read. A longer unread stretch is consumed over successive
// reads, so a huge file can't stall the main process in one go.
const MAX_READ_BYTES = 32 * 1024 * 1024;
const MAX_CHUNKS_PER_SYNC = 16;
// Codex writes child threads (subagents, auto-reviews) to their own rollout
// files that no hook points at; look for them at most this often.
const CODEX_SWEEP_INTERVAL_MS = 60_000;
// How many of the newest day-directories a sweep lists.
const CODEX_SWEEP_DAYS = 2;

export interface ActivitySyncOptions {
  codexSessionsDir?: string;                 // default ~/.codex/sessions
  resolveCodexRollout?: (sessionId: string) => string | null;
  defer?: (fn: () => void) => void;          // default setImmediate
  now?: () => number;
  maxReadBytes?: number;                     // default MAX_READ_BYTES (tests shrink it)
}

export class ActivitySync {
  private offsets = new Map<string, OffsetEntry>();
  private pending = new Map<string, { toolId: ToolId; sessionId: string }>();
  private flushScheduled = false;
  private codexPathCache = new Map<string, string | null>();
  private lastCodexSweep = 0;
  private readonly codexSessionsDir: string;
  private readonly resolveCodexRollout: (sessionId: string) => string | null;
  private readonly defer: (fn: () => void) => void;
  private readonly now: () => number;
  private readonly maxReadBytes: number;

  constructor(private sink: ActivitySink, opts: ActivitySyncOptions = {}) {
    this.codexSessionsDir = opts.codexSessionsDir ?? path.join(os.homedir(), '.codex', 'sessions');
    this.resolveCodexRollout = opts.resolveCodexRollout ?? findCodexRollout;
    this.defer = opts.defer ?? ((fn) => { setImmediate(fn); });
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
   * Live trigger: a hook event arrived for `sessionId`. Queues that session's
   * file (and, for Codex, any sibling thread files) for a read on the next
   * tick, so the hook path itself never waits on file I/O.
   */
  public onAgentEvent(toolId: ToolId, sessionId: string | undefined, transcriptPath?: string): void {
    if (!sessionId) return;
    if (toolId === 'claude-code') {
      if (transcriptPath) this.enqueue(transcriptPath, toolId, sessionId);
    } else if (toolId === 'openai-codex') {
      const rollout = this.codexPathFor(sessionId, transcriptPath);
      if (rollout) this.enqueue(rollout, toolId, sessionId);
      const now = this.now();
      if (now - this.lastCodexSweep >= CODEX_SWEEP_INTERVAL_MS) {
        this.lastCodexSweep = now;
        for (const file of this.recentCodexRollouts()) this.enqueue(file, toolId, sessionId);
      }
    }
  }

  /**
   * Read one file's unread tail and store its facts. Returns how many new
   * facts were inserted. Synchronous; never throws.
   */
  public syncFile(filePath: string, toolId: ToolId, sessionId: string): number {
    try {
      // A stretch longer than MAX_READ_BYTES is read in several chunks.
      let inserted = 0;
      for (let i = 0; i < MAX_CHUNKS_PER_SYNC; i++) {
        const step = this.readTail(filePath, toolId, sessionId);
        inserted += step.inserted;
        if (!step.more) break;
      }
      return inserted;
    } catch (e: any) {
      logger.warn('[Timeline/activity] sync failed:', e?.message ?? e);
      return 0;
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private enqueue(filePath: string, toolId: ToolId, sessionId: string): void {
    this.pending.set(filePath, { toolId, sessionId });
    this.scheduleFlush();
  }

  // One file per tick: a first read can be several MB, and a Codex sweep can
  // queue a day's worth of files at once.
  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    this.defer(() => {
      this.flushScheduled = false;
      const next = this.pending.entries().next();
      if (next.done) return;
      const [file, job] = next.value;
      this.pending.delete(file);
      this.syncFile(file, job.toolId, job.sessionId);
      if (this.pending.size > 0) this.scheduleFlush();
    });
  }

  // Reads one chunk. `more` is true when unread complete lines may remain.
  private readTail(filePath: string, toolId: ToolId, sessionId: string): { inserted: number; more: boolean } {
    const idle = { inserted: 0, more: false };
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
    if (lastNewline < 0) return idle; // no complete line yet (or one line longer than a chunk)
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
    const next: OffsetEntry = { offset: start + lastNewline + 1, codex };
    this.offsets.set(filePath, next);
    try {
      this.sink.saveActivityOffset({
        path: filePath,
        offset: next.offset,
        context: codex ? JSON.stringify(codex) : null,
      });
    } catch (e: any) {
      logger.warn('[Timeline/activity] failed to persist offset:', e?.message ?? e);
    }
    return { inserted, more: next.offset < size };
  }

  private codexPathFor(sessionId: string, payloadPath?: string): string | null {
    if (payloadPath) {
      try { if (fs.statSync(payloadPath).isFile()) return payloadPath; } catch { /* fall through */ }
    }
    const cached = this.codexPathCache.get(sessionId);
    if (cached) return cached;
    const found = this.resolveCodexRollout(sessionId);
    // Only cache hits: the rollout may simply not exist yet on the first event.
    if (found) this.codexPathCache.set(sessionId, found);
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

// Tails Claude Code's prompt history (<claude config dir>/history.jsonl) into
// the command_uses table. One file, read incrementally with the same
// whole-lines-only rule as ActivitySync, and its offset kept in the same
// activity_offsets table under the file's path.
//
// The table is derived entirely from that file, so when the file shrinks or is
// replaced (`claude purge`) every stored row is dropped and the file is read
// again: purged commands must not linger here.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { logger } from '../../common/logger';
import { countsInline, DiscoveredSource } from '../../common/claude-commands';
import { CommandHistoryContext, CommandUse, extractClaudeCommands } from './command-history';
import { claudeConfigDir } from './limit-backfill';
import { EVENTS_RETENTION_MS } from './prune';

const MAX_READ_BYTES = 32 * 1024 * 1024;
const MAX_CHUNKS_PER_SYNC = 64;
// Hook events arrive many times a minute; the history file changes far less.
const EVENT_DEBOUNCE_MS = 30_000;
const DISCOVERY_TTL_MS = 5 * 60_000;
// How much of the file's start identifies it (see headOf).
const HEAD_BYTES = 4096;
const MAX_COMMAND_DIR_DEPTH = 4;
const MAX_PROJECT_ROOTS = 200;

export interface CommandSink {
  // Inserts in one transaction, first deleting every existing row when
  // `replaceAll`. Returns how many rows were new, or null when the write
  // failed — the caller must then NOT treat the source lines as consumed.
  insertCommandUses: (rows: CommandUse[], replaceAll: boolean) => number | null;
  loadActivityOffsets: () => Array<{ path: string; offset: number; context?: string | null }>;
  saveActivityOffset: (row: { path: string; offset: number; context?: string | null; updatedAt?: number | null }) => void;
}

export interface CommandSyncOptions {
  historyPath?: string;                 // default <claude config dir>/history.jsonl
  configDir?: string;                   // default claudeConfigDir()
  projectRoots?: () => string[];        // project folders to scan for commands and skills
  now?: () => number;
  defer?: (fn: () => void) => void;     // default setImmediate
  maxReadBytes?: number;                // default MAX_READ_BYTES (tests shrink it)
  retentionMs?: number;                 // default EVENTS_RETENTION_MS
}

interface StoredContext extends CommandHistoryContext {
  head?: string | null;
}

export interface CommandSyncResult {
  available: boolean;   // the history file exists
  inserted: number;
  rebuilt: boolean;     // the file shrank or was replaced, so the table was rebuilt
}

function listDir(dir: string): fs.Dirent[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
}

// <dir>/commands/**/*.md → the file name; <dir>/skills/<name>/SKILL.md → the folder name.
function addCommandsIn(dir: string, source: DiscoveredSource, out: Map<string, DiscoveredSource>): void {
  const add = (raw: string) => {
    const name = raw.toLowerCase();
    // The user's own command wins over a plugin's of the same name.
    if (out.get(name) !== 'custom') out.set(name, source);
  };
  const walk = (current: string, depth: number) => {
    for (const entry of listDir(current)) {
      if (entry.isDirectory()) {
        if (depth < MAX_COMMAND_DIR_DEPTH) walk(path.join(current, entry.name), depth + 1);
      } else if (entry.name.toLowerCase().endsWith('.md')) {
        add(entry.name.slice(0, -3));
      }
    }
  };
  walk(path.join(dir, 'commands'), 0);
  for (const entry of listDir(path.join(dir, 'skills'))) {
    if (!entry.isDirectory()) continue;
    try { if (fs.statSync(path.join(dir, 'skills', entry.name, 'SKILL.md')).isFile()) add(entry.name); }
    catch { /* not a skill folder */ }
  }
}

/**
 * Commands and skills found on disk: the user's own (config dir and each
 * project's `.claude`), and those of installed plugins
 * (`plugins/cache/<marketplace>/<plugin>/<version>`). Claude Code also finds
 * project skills in folders between the start directory and the repo root, so
 * this is an approximation; a missed skill only shows as "Other".
 */
export function discoverClaudeCommands(configDir: string, projectRoots: string[] = []): Map<string, DiscoveredSource> {
  const out = new Map<string, DiscoveredSource>();
  addCommandsIn(configDir, 'custom', out);
  for (const root of projectRoots.slice(0, MAX_PROJECT_ROOTS)) {
    if (path.isAbsolute(root)) addCommandsIn(path.join(root, '.claude'), 'custom', out);
  }
  const cache = path.join(configDir, 'plugins', 'cache');
  for (const marketplace of listDir(cache)) {
    if (!marketplace.isDirectory()) continue;
    for (const plugin of listDir(path.join(cache, marketplace.name))) {
      if (!plugin.isDirectory()) continue;
      for (const version of listDir(path.join(cache, marketplace.name, plugin.name))) {
        if (version.isDirectory()) addCommandsIn(path.join(cache, marketplace.name, plugin.name, version.name), 'plugin', out);
      }
    }
  }
  return out;
}

export class CommandHistorySync {
  private readonly historyPath: string;
  private readonly configDir: string;
  private readonly projectRoots: () => string[];
  private readonly now: () => number;
  private readonly defer: (fn: () => void) => void;
  private readonly maxReadBytes: number;
  private readonly retentionMs: number;

  private offset = 0;
  private context: StoredContext = {};
  private discovered: { at: number; names: Map<string, DiscoveredSource> } | null = null;
  private lastEventSync = -Infinity;
  private eventSyncQueued = false;
  private oversizeWarned = false;
  private disposed = false;

  constructor(private sink: CommandSink, opts: CommandSyncOptions = {}) {
    this.configDir = opts.configDir ?? claudeConfigDir();
    this.historyPath = path.normalize(opts.historyPath ?? path.join(this.configDir, 'history.jsonl'));
    this.projectRoots = opts.projectRoots ?? (() => []);
    this.now = opts.now ?? Date.now;
    this.defer = opts.defer ?? ((fn) => { setImmediate(fn); });
    this.maxReadBytes = opts.maxReadBytes ?? MAX_READ_BYTES;
    this.retentionMs = opts.retentionMs ?? EVENTS_RETENTION_MS;
    try {
      const row = sink.loadActivityOffsets().find((r) => r.path === this.historyPath);
      if (row) {
        this.offset = row.offset;
        if (row.context) {
          try { this.context = JSON.parse(row.context) as StoredContext; }
          catch { /* corrupt context: only the dedupe window and head check are lost */ }
        }
      }
    } catch (e: any) {
      logger.warn('[Timeline/commands] failed to load offset:', e?.message ?? e);
    }
  }

  /** Commands and skills on disk, re-scanned at most every five minutes. */
  public discoveredCommands(): Map<string, DiscoveredSource> {
    const now = this.now();
    if (!this.discovered || now - this.discovered.at >= DISCOVERY_TTL_MS) {
      let names = new Map<string, DiscoveredSource>();
      try { names = discoverClaudeCommands(this.configDir, this.projectRoots()); }
      catch (e: any) { logger.warn('[Timeline/commands] command discovery failed:', e?.message ?? e); }
      this.discovered = { at: now, names };
    }
    return this.discovered.names;
  }

  /** A hook event arrived. Reads the history at most once every 30 s. */
  public onAgentEvent(toolId: string): void {
    if (this.disposed || toolId !== 'claude-code' || this.eventSyncQueued) return;
    if (this.now() - this.lastEventSync < EVENT_DEBOUNCE_MS) return;
    this.eventSyncQueued = true;
    this.defer(() => {
      this.eventSyncQueued = false;
      this.lastEventSync = this.now();
      this.sync();
    });
  }

  /** Read everything unread. Synchronous; never throws. */
  public sync(): CommandSyncResult {
    const result: CommandSyncResult = { available: false, inserted: 0, rebuilt: false };
    if (this.disposed) return result;
    try {
      for (let i = 0; i < MAX_CHUNKS_PER_SYNC; i++) {
        const step = this.readChunk();
        result.available = step.available;
        result.inserted += step.inserted;
        result.rebuilt = result.rebuilt || step.rebuilt;
        if (!step.more) break;
      }
    } catch (e: any) {
      logger.warn('[Timeline/commands] sync failed:', e?.message ?? e);
    }
    return result;
  }

  public dispose(): void {
    this.disposed = true;
  }

  // Fingerprint of the file's first line (or its first HEAD_BYTES). History is
  // append-only, so this changes only when the file was replaced or lines were
  // removed from its start. Null while the first line is still being written.
  private headOf(fd: number, size: number): string | null {
    const length = Math.min(size, HEAD_BYTES);
    if (length === 0) return null;
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, 0);
    const newline = buffer.indexOf(0x0a);
    if (newline < 0 && read < HEAD_BYTES) return null;
    const end = newline < 0 ? read : Math.min(newline, read);
    return crypto.createHash('sha1').update(buffer.subarray(0, end)).digest('hex');
  }

  private readChunk(): { available: boolean; inserted: number; rebuilt: boolean; more: boolean } {
    const idle = { available: true, inserted: 0, rebuilt: false, more: false };
    let size: number;
    try { size = fs.statSync(this.historyPath).size; }
    catch { return { ...idle, available: false }; } // no history file: keep what is stored

    const fd = fs.openSync(this.historyPath, 'r');
    try {
      const head = this.headOf(fd, size);
      // Shrunk, or a different first line: lines were purged or the file was
      // replaced. Catches a purge that new lines have already grown back over.
      const replaced = this.offset > size
        || (this.offset > 0 && head !== null && this.context.head != null && head !== this.context.head);
      let start = this.offset;
      let context: CommandHistoryContext = this.context;
      if (replaced) { start = 0; context = {}; }
      if (start === size && !replaced) return idle;

      const length = Math.min(size - start, this.maxReadBytes);
      const buffer = Buffer.alloc(length);
      const read = length > 0 ? fs.readSync(fd, buffer, 0, length, start) : 0;

      // Whole lines only; cutting at the last newline byte keeps the offset
      // exact even when the read ends inside a multi-byte character.
      const lastNewline = read > 0 ? buffer.lastIndexOf(0x0a, read - 1) : -1;
      let uses: CommandUse[] = [];
      let nextOffset = start;
      if (lastNewline >= 0) {
        const discovered = this.discoveredCommands();
        const out = extractClaudeCommands(buffer.toString('utf8', 0, lastNewline), context, {
          cutoffMs: this.now() - this.retentionMs,
          isInlineCommand: (name) => countsInline(name, discovered),
        });
        uses = out.uses;
        context = out.context;
        nextOffset = start + lastNewline + 1;
      } else if (read === this.maxReadBytes && start + read < size) {
        // One line longer than a chunk would block the file forever. Skip the
        // chunk: the rest of that line arrives as an unparseable fragment.
        if (!this.oversizeWarned) {
          this.oversizeWarned = true;
          logger.warn(`[Timeline/commands] skipping a history line longer than ${this.maxReadBytes} bytes`);
        }
        nextOffset = start + read;
      } else if (!replaced) {
        return idle; // a line still being written
      }

      const inserted = this.sink.insertCommandUses(uses, replaced);
      // Write failed: leave the offset so these lines are read again.
      if (inserted === null) return idle;

      this.offset = nextOffset;
      this.context = { ...context, head };
      try {
        this.sink.saveActivityOffset({
          path: this.historyPath,
          offset: this.offset,
          context: JSON.stringify(this.context),
          updatedAt: this.now(),
        });
      } catch (e: any) {
        logger.warn('[Timeline/commands] failed to persist offset:', e?.message ?? e);
      }
      return { available: true, inserted, rebuilt: replaced, more: nextOffset < size && nextOffset > start };
    } finally {
      fs.closeSync(fd);
    }
  }
}

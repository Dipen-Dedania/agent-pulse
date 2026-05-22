import fs from 'fs';
import { logger } from '../../common/logger';
import { EventsWriter, TokenDelta } from './events-writer';
import { SessionsDeriver } from './sessions-deriver';

interface OffsetEntry {
  offset: number;
  sessionId: string;
}

/**
 * Tails Claude Code JSONL transcript files and extracts model + token usage
 * from each assistant turn. Token deltas are staged on the EventsWriter,
 * which attaches them to the next event row for the same session; they're
 * also forwarded to the SessionsDeriver so the closed session row carries
 * the rollup.
 *
 * Claude Code's transcript file is one JSON object per line. Assistant
 * messages look like:
 *   {
 *     "type": "assistant",
 *     "message": {
 *       "model": "claude-opus-4-7",
 *       "usage": {
 *         "input_tokens": 123,
 *         "output_tokens": 456,
 *         "cache_creation_input_tokens": 78,
 *         "cache_read_input_tokens": 9
 *       }
 *     },
 *     "sessionId": "<uuid>"
 *   }
 *
 * We track byte offset per file so reruns only read the new tail.
 */
export class TranscriptReader {
  private offsets: Map<string, OffsetEntry> = new Map();

  constructor(
    private eventsWriter: EventsWriter,
    private sessionsDeriver: SessionsDeriver,
  ) {}

  /**
   * Called when a hook event includes a transcript_path. Reads the new tail
   * and applies any token deltas it finds to the given sessionId.
   *
   * The toolEvent is forwarded back into the SessionsDeriver as a token-delta
   * call after the read completes, so the session rollup stays accurate.
   */
  public onTranscriptEvent(transcriptPath: string, sessionId: string | undefined) {
    if (!transcriptPath || !sessionId) return;
    try {
      const delta = this.readNewTail(transcriptPath, sessionId);
      if (!delta) return;
      this.eventsWriter.stageTokenDelta(sessionId, delta);
      // The deriver attribution path runs separately when the next event
      // arrives; we don't push directly here because the open-session map is
      // keyed differently. The events-writer's staging is the source of truth.
    } catch (e: any) {
      logger.warn('[Timeline/transcript] read failed:', e?.message ?? e);
    }
  }

  /** Number of files currently tracked. For tests/diagnostics. */
  public trackedCount(): number {
    return this.offsets.size;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private readNewTail(transcriptPath: string, sessionId: string): TokenDelta | null {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(transcriptPath);
    } catch {
      // Missing or unreadable — drop any tracked offset so a future appearance starts fresh.
      this.offsets.delete(transcriptPath);
      return null;
    }

    const tracked = this.offsets.get(transcriptPath);
    let startOffset = tracked?.offset ?? 0;
    // File rotated (got smaller) — reset offset and re-read from 0 once.
    if (startOffset > stat.size) startOffset = 0;
    if (startOffset === stat.size) return null;

    let fd: number;
    try {
      fd = fs.openSync(transcriptPath, 'r');
    } catch {
      return null;
    }

    const length = stat.size - startOffset;
    const buffer = Buffer.alloc(length);
    try {
      fs.readSync(fd, buffer, 0, length, startOffset);
    } finally {
      fs.closeSync(fd);
    }

    // Stop offset at the last newline so we don't half-parse a line in flight.
    const text = buffer.toString('utf8');
    const lastNewline = text.lastIndexOf('\n');
    let consumedLength: number;
    let parseableText: string;
    if (lastNewline >= 0) {
      parseableText = text.slice(0, lastNewline);
      consumedLength = lastNewline + 1;
    } else {
      // No newline yet — wait for one rather than tracking a partial position.
      return null;
    }

    this.offsets.set(transcriptPath, {
      offset: startOffset + consumedLength,
      sessionId,
    });

    const delta = aggregateAssistantTurns(parseableText, sessionId);
    return delta;
  }
}

/**
 * Parses JSONL lines and sums usage for assistant messages matching the
 * sessionId. Returns null if nothing was found. Exported for unit tests.
 */
export function aggregateAssistantTurns(text: string, sessionId: string): TokenDelta | null {
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let model: string | undefined;
  let any = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: any;
    try { row = JSON.parse(trimmed); }
    catch { continue; }

    if (row?.type !== 'assistant') continue;
    // Some Claude Code versions use sessionId, some session_id. Tolerate both.
    const rowSession: string | undefined = row.sessionId ?? row.session_id;
    if (rowSession && rowSession !== sessionId) continue;

    const usage = row.message?.usage;
    if (!usage) continue;

    if (typeof usage.input_tokens                 === 'number') tokensIn  += usage.input_tokens;
    if (typeof usage.output_tokens                === 'number') tokensOut += usage.output_tokens;
    if (typeof usage.cache_read_input_tokens      === 'number') cacheRead += usage.cache_read_input_tokens;
    if (typeof usage.cache_creation_input_tokens  === 'number') cacheWrite += usage.cache_creation_input_tokens;
    if (typeof row.message?.model === 'string') model = row.message.model;
    any = true;
  }

  if (!any) return null;
  return { model, tokensIn, tokensOut, cacheRead, cacheWrite };
}

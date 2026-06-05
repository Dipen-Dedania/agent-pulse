import fs from 'fs';
import os from 'os';
import path from 'path';
import { ToolId } from '../../common/types';
import { logger } from '../../common/logger';
import { EventsWriter, TokenDelta } from './events-writer';
import { SessionsDeriver } from './sessions-deriver';

// Cumulative usage snapshot for a Codex rollout file. Codex reports a running
// total in every token_count event, so we diff successive snapshots rather than
// summing per-turn values (which overcounts — see aggregateCodexTokenCounts).
interface CodexSnapshot {
  freshIn: number;   // input_tokens − cached_input_tokens (uncached prompt)
  cacheRead: number; // cached_input_tokens
  out: number;       // output_tokens (already includes reasoning)
  model?: string;
}

interface OffsetEntry {
  offset: number;
  sessionId: string;
  codex?: CodexSnapshot; // last cumulative snapshot, for Codex rollout files
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
  // sessionId → resolved Codex rollout path, so the sessions dir is walked at
  // most once per session when the hook doesn't hand us a usable path.
  private codexPathCache: Map<string, string | null> = new Map();

  constructor(
    private eventsWriter: EventsWriter,
    private sessionsDeriver: SessionsDeriver,
  ) {}

  /**
   * Called when a hook event includes a transcript_path (Claude Code) or for
   * any Codex event (the rollout path is resolved from the sessionId if the
   * hook omitted it). Reads the new tail and stages any token delta it finds
   * against the given sessionId.
   *
   * The events-writer's staging is the source of truth: the next event for the
   * session flushes the delta onto its row and the session rollup.
   */
  public onTranscriptEvent(
    transcriptPath: string | undefined,
    sessionId: string | undefined,
    toolId: ToolId = 'claude-code',
  ) {
    if (!sessionId) return;
    try {
      const resolved =
        toolId === 'openai-codex'
          ? this.resolveCodexPath(transcriptPath, sessionId)
          : transcriptPath;
      if (!resolved) return;
      const delta = this.readNewTail(resolved, sessionId, toolId);
      if (!delta) return;
      this.eventsWriter.stageTokenDelta(sessionId, delta);
    } catch (e: any) {
      logger.warn('[Timeline/transcript] read failed:', e?.message ?? e);
    }
  }

  /** Number of files currently tracked. For tests/diagnostics. */
  public trackedCount(): number {
    return this.offsets.size;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  /**
   * Resolve a usable Codex rollout path. Prefers the hook-supplied path when it
   * exists; otherwise walks ~/.codex/sessions/YYYY/MM/DD for a rollout whose
   * filename ends with `<sessionId>.jsonl`. Result is cached per session so the
   * (bounded) directory walk runs at most once. Cross-OS: only os.homedir() +
   * path.join, no platform-specific separators.
   */
  private resolveCodexPath(
    payloadPath: string | undefined,
    sessionId: string,
  ): string | null {
    if (payloadPath) {
      try { if (fs.statSync(payloadPath).isFile()) return payloadPath; } catch { /* fall through */ }
    }
    if (this.codexPathCache.has(sessionId)) return this.codexPathCache.get(sessionId) ?? null;

    const found = findCodexRollout(sessionId);
    this.codexPathCache.set(sessionId, found);
    if (!found) logger.debug(`[Timeline/transcript] no Codex rollout for session ${sessionId}`);
    return found;
  }

  private readNewTail(
    transcriptPath: string,
    sessionId: string,
    toolId: ToolId,
  ): TokenDelta | null {
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

    const nextEntry: OffsetEntry = {
      offset: startOffset + consumedLength,
      sessionId,
      codex: tracked?.codex, // preserve cumulative snapshot across reads
    };

    let delta: TokenDelta | null;
    if (toolId === 'openai-codex') {
      const result = aggregateCodexTokenCounts(parseableText, tracked?.codex);
      delta = result.delta;
      if (result.snapshot) nextEntry.codex = result.snapshot;
    } else {
      delta = aggregateAssistantTurns(parseableText, sessionId);
    }

    this.offsets.set(transcriptPath, nextEntry);
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

/**
 * Parses Codex rollout JSONL and returns the usage delta since the last read.
 *
 * Codex reports a *cumulative* `total_token_usage` in every `token_count`
 * event (the per-turn `last_token_usage` does NOT sum cleanly — verified ~5%
 * over the authoritative cumulative on a real session). So we diff the latest
 * cumulative snapshot against the previous one. This is self-correcting: a
 * re-read or offset reset yields current − prev = 0, never a double-count.
 *
 *   { "type": "event_msg", "payload": {
 *       "type": "token_count",
 *       "info": { "total_token_usage": {
 *           "input_tokens": N,            // includes cached
 *           "cached_input_tokens": N,     // cache reads
 *           "output_tokens": N,           // includes reasoning_output_tokens
 *           "total_tokens": N } } } }
 *
 * Model comes from `turn_context.model` (session_meta.model is often null).
 * Mapped to TokenDelta as: tokensIn = input − cached (fresh, uncached prompt),
 * cacheRead = cached, tokensOut = output (reasoning already included),
 * cacheWrite = 0 (Codex reports no separate cache-write). Exported for tests.
 */
export function aggregateCodexTokenCounts(
  text: string,
  prev: CodexSnapshot | undefined,
): { delta: TokenDelta | null; snapshot: CodexSnapshot | null } {
  let latest: { freshIn: number; cacheRead: number; out: number } | null = null;
  let model: string | undefined = prev?.model;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: any;
    try { row = JSON.parse(trimmed); }
    catch { continue; }

    // Model can change mid-session; the latest wins (mirrors the CC aggregator).
    // turn_context and session_meta both carry it at payload.model.
    if ((row?.type === 'turn_context' || row?.type === 'session_meta') &&
        typeof row.payload?.model === 'string' && row.payload.model) {
      model = row.payload.model;
    }

    if (row?.type !== 'event_msg') continue;
    const payload = row.payload;
    if (!payload || payload.type !== 'token_count') continue;
    const total = payload.info?.total_token_usage;
    if (!total) continue;

    const input  = typeof total.input_tokens        === 'number' ? total.input_tokens        : 0;
    const cached = typeof total.cached_input_tokens  === 'number' ? total.cached_input_tokens  : 0;
    const output = typeof total.output_tokens        === 'number' ? total.output_tokens        : 0;
    // Cumulative grows monotonically; keep the last (largest) snapshot in the slice.
    latest = { freshIn: Math.max(0, input - cached), cacheRead: cached, out: output };
  }

  if (!latest) {
    // No new token_count lines — nothing to attribute, but carry the model
    // forward if we learned a new one from turn_context.
    if (model !== prev?.model && prev) return { delta: null, snapshot: { ...prev, model } };
    return { delta: null, snapshot: null };
  }

  const base = prev ?? { freshIn: 0, cacheRead: 0, out: 0 };
  const tokensIn  = Math.max(0, latest.freshIn  - base.freshIn);
  const cacheRead = Math.max(0, latest.cacheRead - base.cacheRead);
  const tokensOut = Math.max(0, latest.out      - base.out);

  const snapshot: CodexSnapshot = { ...latest, model };
  if (tokensIn === 0 && cacheRead === 0 && tokensOut === 0) {
    // Cumulative unchanged (e.g. a re-read) — refresh the snapshot but emit no delta.
    return { delta: null, snapshot };
  }
  return {
    delta: { model, tokensIn, tokensOut, cacheRead, cacheWrite: 0 },
    snapshot,
  };
}

/**
 * Locate a Codex rollout file by sessionId. Codex embeds the session id in the
 * filename: ~/.codex/sessions/YYYY/MM/DD/rollout-<ISO>-<sessionId>.jsonl. We
 * scan that bounded tree (year/month/day dirs only) for a name ending with the
 * id. Returns null if the sessions dir is absent or no match is found.
 */
function findCodexRollout(sessionId: string): string | null {
  const root = path.join(os.homedir(), '.codex', 'sessions');
  const suffix = `${sessionId}.jsonl`;
  try {
    if (!fs.statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  // Walk year → month → day → files. Newest-first by directory name so an
  // in-progress session is found quickly without reading the whole history.
  const desc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
  try {
    for (const year of fs.readdirSync(root).sort(desc)) {
      const yDir = path.join(root, year);
      if (!safeIsDir(yDir)) continue;
      for (const month of fs.readdirSync(yDir).sort(desc)) {
        const mDir = path.join(yDir, month);
        if (!safeIsDir(mDir)) continue;
        for (const day of fs.readdirSync(mDir).sort(desc)) {
          const dDir = path.join(mDir, day);
          if (!safeIsDir(dDir)) continue;
          for (const file of fs.readdirSync(dDir)) {
            if (file.startsWith('rollout-') && file.endsWith(suffix)) {
              return path.join(dDir, file);
            }
          }
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function safeIsDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

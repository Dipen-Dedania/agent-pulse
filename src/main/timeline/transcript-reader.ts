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

// Persistence for read offsets. Backed by the timeline DB in production; absent
// in unit tests (offsets stay in-memory only). Without this, the in-memory map
// resets on every app restart and the next event re-reads the whole file from
// byte 0 — re-summing all historical usage and double-counting tokens.
export interface TranscriptOffsetStore {
  loadAll: () => Array<{ path: string; offset: number; sessionId?: string | null; codexSnapshot?: string | null }>;
  save: (row: { path: string; offset: number; sessionId: string; codexSnapshot?: string }) => void;
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
  // sessionId → resolved Grok updates.jsonl path. Same rationale as Codex:
  // Grok hooks carry no transcript_path, so we resolve from the sessionId.
  private grokPathCache: Map<string, string | null> = new Map();

  constructor(
    private eventsWriter: EventsWriter,
    private sessionsDeriver: SessionsDeriver,
    private offsetStore?: TranscriptOffsetStore,
  ) {
    // Restore persisted offsets so reads resume where they left off across
    // restarts instead of re-reading each file from byte 0 (which double-counts).
    if (offsetStore) {
      try {
        let restored = 0;
        for (const row of offsetStore.loadAll()) {
          let codex: CodexSnapshot | undefined;
          if (row.codexSnapshot) {
            try { codex = JSON.parse(row.codexSnapshot) as CodexSnapshot; }
            catch { /* corrupt snapshot — fall back to no snapshot */ }
          }
          this.offsets.set(row.path, { offset: row.offset, sessionId: row.sessionId ?? '', codex });
          restored++;
        }
        if (restored > 0) logger.info(`[Timeline/transcript] restored ${restored} persisted read offset(s)`);
      } catch (e: any) {
        logger.warn('[Timeline/transcript] failed to load persisted offsets:', e?.message ?? e);
      }
    }
  }

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
          : toolId === 'grok'
            ? this.resolveGrokPath(sessionId)
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

  /**
   * Resolve a Grok session's updates.jsonl. Grok hooks carry no transcript
   * path, so we locate the session directory by its id under
   * ~/.grok/sessions/<encoded-cwd>/<sessionId>/ (GROK_HOME honored). The encoded
   * cwd isn't reliably known here, so we do a bounded one-level walk of the
   * per-cwd directories (Codex `findCodexRollout` precedent). Cached per session.
   */
  private resolveGrokPath(sessionId: string): string | null {
    if (this.grokPathCache.has(sessionId)) return this.grokPathCache.get(sessionId) ?? null;
    const found = findGrokUpdates(sessionId);
    this.grokPathCache.set(sessionId, found);
    if (!found) logger.debug(`[Timeline/transcript] no Grok session dir for ${sessionId}`);
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
    } else if (toolId === 'grok') {
      delta = aggregateGrokTurnCompleted(parseableText);
    } else {
      delta = aggregateAssistantTurns(parseableText, sessionId);
    }

    this.setOffset(transcriptPath, nextEntry);
    return delta;
  }

  /** Update the in-memory offset and mirror it to the persistent store. */
  private setOffset(pathKey: string, entry: OffsetEntry) {
    this.offsets.set(pathKey, entry);
    if (!this.offsetStore) return;
    try {
      this.offsetStore.save({
        path: pathKey,
        offset: entry.offset,
        sessionId: entry.sessionId,
        codexSnapshot: entry.codex ? JSON.stringify(entry.codex) : undefined,
      });
    } catch (e: any) {
      logger.warn('[Timeline/transcript] failed to persist offset:', e?.message ?? e);
    }
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
 * Parses Grok `updates.jsonl` (the ACP stream) and sums usage across every
 * `turn_completed` update in the slice. Unlike Codex (cumulative running total)
 * Grok reports PER-TURN usage, so summing turns is correct — same philosophy as
 * Claude assistant turns. Returns null if no completed turn is found.
 *
 *   { "method": "_x.ai/session/update", "params": { "update": {
 *       "sessionUpdate": "turn_completed",
 *       "usage": {
 *         "inputTokens": 15276, "outputTokens": 99,
 *         "cachedReadTokens": 128, "reasoningTokens": 40,
 *         "modelUsage": { "grok-4.5": { ... } } } } } }
 *
 * Mapped to TokenDelta: tokensIn = inputTokens, tokensOut = outputTokens,
 * cacheRead = cachedReadTokens, cacheWrite = 0 (no cache-write observed). We do
 * NOT add reasoningTokens to outputTokens — the samples suggest reasoning is
 * already counted in outputTokens, and adding it would double-count. Model is
 * the first key of `modelUsage` when present. Exported for unit tests.
 */
export function aggregateGrokTurnCompleted(text: string): TokenDelta | null {
  let tokensIn = 0;
  let tokensOut = 0;
  let cacheRead = 0;
  let model: string | undefined;
  let any = false;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: any;
    try { row = JSON.parse(trimmed); }
    catch { continue; }

    // The update may sit at params.update (documented) or be the row itself.
    const update = row?.params?.update ?? row?.update ?? row;
    if (update?.sessionUpdate !== 'turn_completed') continue;
    const usage = update.usage;
    if (!usage) continue;

    if (typeof usage.inputTokens      === 'number') tokensIn  += usage.inputTokens;
    if (typeof usage.outputTokens     === 'number') tokensOut += usage.outputTokens;
    if (typeof usage.cachedReadTokens === 'number') cacheRead += usage.cachedReadTokens;
    // Prefer the per-model breakdown for attribution; latest turn wins.
    const modelUsage = usage.modelUsage;
    if (modelUsage && typeof modelUsage === 'object') {
      const keys = Object.keys(modelUsage);
      if (keys.length > 0) model = keys[0];
    }
    any = true;
  }

  if (!any) return null;
  return { model, tokensIn, tokensOut, cacheRead, cacheWrite: 0 };
}

/**
 * Locate a Grok session's updates.jsonl by sessionId. Grok stores sessions at
 * ~/.grok/sessions/<url-encoded-cwd>/<sessionId>/updates.jsonl (GROK_HOME
 * overrides ~/.grok). We can't reconstruct the encoded-cwd segment reliably, so
 * we walk that single directory level looking for a child named <sessionId>
 * that contains updates.jsonl. Bounded (one level of per-cwd dirs), mirroring
 * the Codex rollout walk. Returns null if the sessions dir or file is absent.
 */
function findGrokUpdates(sessionId: string): string | null {
  const home = process.env['GROK_HOME'] || path.join(os.homedir(), '.grok');
  const root = path.join(home, 'sessions');
  try {
    if (!fs.statSync(root).isDirectory()) return null;
  } catch {
    return null;
  }
  try {
    for (const cwdDir of fs.readdirSync(root)) {
      const candidate = path.join(root, cwdDir, sessionId, 'updates.jsonl');
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch { /* not here — keep scanning */ }
    }
  } catch {
    return null;
  }
  return null;
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

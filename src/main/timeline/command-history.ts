// Pulls slash-command uses out of Claude Code's prompt history
// (<claude config dir>/history.jsonl). Pure: text in, rows out.
//
// Privacy: only the command NAME, its timestamp, the session id and how it was
// entered leave this module. Arguments (`/goal <text>`), the rest of the
// prompt, pasted content and the project path are never returned or stored.

import { isCommandName } from '../../common/claude-commands';

export type CommandEntry = 'typed' | 'inline';

export interface CommandUse {
  key: string;         // cc:h:<timestamp>:<sessionId>:<name>[:i]
  ts: number;
  sessionId: string | null;
  name: string;        // lower-cased, no leading slash
  entry: CommandEntry;
}

// Carried between reads so a duplicate split across two chunks is still caught.
export interface CommandHistoryContext {
  last?: { sessionId: string | null; name: string; ts: number };
}

export interface ExtractOptions {
  // Lines older than this are dropped, so a first read does not insert rows
  // the retention prune would delete straight away.
  cutoffMs?: number;
  // Whether a mid-prompt mention of this name counts (see countsInline).
  isInlineCommand?: (name: string) => boolean;
}

// Claude Code records a submission twice now and then; the same session and
// name this close together is one use.
const DUPLICATE_WINDOW_MS = 1000;

// A command at the very start: the name must end at whitespace or the end of
// the text, so `/Users/x/…` and `/tmp/foo` never match.
const LEADING_RE = /^\/([A-Za-z][\w:.-]{0,63})(?=\s|$)/;
// A mention later in the prompt: after whitespace, ending at whitespace,
// closing punctuation or the end.
const INLINE_RE = /\s\/([A-Za-z][\w:.-]{0,63})(?=[\s,;!?)'"`]|$)/g;

export function extractClaudeCommands(
  text: string,
  context: CommandHistoryContext = {},
  opts: ExtractOptions = {},
): { uses: CommandUse[]; context: CommandHistoryContext } {
  const uses: CommandUse[] = [];
  let last = context.last;
  const cutoff = opts.cutoffMs ?? 0;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row: { display?: unknown; timestamp?: unknown; sessionId?: unknown };
    try { row = JSON.parse(line); }
    catch { continue; }
    if (!row || typeof row !== 'object') continue;
    const display = row.display;
    const ts = row.timestamp;
    if (typeof display !== 'string' || typeof ts !== 'number' || !Number.isFinite(ts)) continue;
    if (ts < cutoff) continue;
    const sessionId = typeof row.sessionId === 'string' && row.sessionId ? row.sessionId : null;

    const leading = LEADING_RE.exec(display);
    if (leading) {
      const name = leading[1].toLowerCase();
      const duplicate = last !== undefined && last.sessionId === sessionId && last.name === name
        && Math.abs(ts - last.ts) <= DUPLICATE_WINDOW_MS;
      if (!duplicate) {
        uses.push({ key: `cc:h:${ts}:${sessionId ?? ''}:${name}`, ts, sessionId, name, entry: 'typed' });
        last = { sessionId, name, ts };
      }
    }

    if (!opts.isInlineCommand) continue;
    const seen = new Set<string>();
    INLINE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = INLINE_RE.exec(display)) !== null) {
      // "see /hard." — the full stop belongs to the sentence, not the name.
      const name = match[1].toLowerCase().replace(/[.:-]+$/, '');
      if (!name || seen.has(name) || !isCommandName(name) || !opts.isInlineCommand(name)) continue;
      seen.add(name);
      uses.push({ key: `cc:h:${ts}:${sessionId ?? ''}:${name}:i`, ts, sessionId, name, entry: 'inline' });
    }
  }

  return { uses, context: last ? { last } : {} };
}

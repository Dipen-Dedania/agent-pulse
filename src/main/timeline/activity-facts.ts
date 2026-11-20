// Turns agent session files into small numeric "facts": one per prompt the
// user typed, per file edit the agent made, per subagent it launched, per
// context compaction, and per Codex auto-review. Pure text → facts; no fs, no
// DB (see activity-sync.ts).
//
// Only counts leave this module — never prompt text or file content.
//
// Both formats are undocumented internals, verified against real files
// (Claude Code 2.1.x transcripts, Codex 0.147–0.169 rollouts). Anything
// unrecognised is skipped, so a format change loses facts instead of breaking
// the reader.

import { ToolId } from '../../common/types';

export type ActivityKind = 'prompt' | 'edit' | 'subagent' | 'auto_review' | 'compaction';
export type CompactionTrigger = 'auto' | 'manual' | 'unknown';

export interface ActivityFact {
  // Stable id of the source record. The DB dedups on it, so re-reading a file
  // (restart, rotation, backfill) can never count the same thing twice.
  key: string;
  ts: number;
  toolId: ToolId;
  sessionId: string;
  kind: ActivityKind;
  toolName?: string | null;
  words?: number | null;         // prompt only
  linesAdded?: number | null;    // edit only
  linesRemoved?: number | null;  // edit only
  trigger?: CompactionTrigger | null; // compaction only
  tokensBefore?: number | null;       // compaction only, when the agent reports it
  tokensAfter?: number | null;
}

export function countWords(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

/** Lines in a file body; a trailing newline does not start another line. */
export function countLines(text: string): number {
  if (text === '') return 0;
  return text.replace(/\r?\n$/, '').split('\n').length;
}

/**
 * Added/removed lines in a unified diff. `---`/`+++` file headers can only
 * appear before the first hunk, so they are skipped there and nowhere else:
 * inside a hunk, a line starting `---` is a removed line whose content starts
 * with `--` (a SQL comment, a Markdown rule) and must be counted.
 */
export function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) { inHunk = true; continue; }
    if (!inHunk && (line.startsWith('+++') || line.startsWith('---'))) continue;
    if (line[0] === '+') added++;
    else if (line[0] === '-') removed++;
  }
  return { added, removed };
}

function parseTs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    if (Number.isFinite(t)) return t;
  }
  return fallback;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ─── Claude Code ─────────────────────────────────────────────────────────────

// `promptSource` values that mean a person wrote the message. "sdk" is a
// headless `claude -p` run and "system" an injected notification.
const CC_HUMAN_SOURCES = new Set(['typed', 'suggestion_accepted']);
const CC_SUBAGENT_TOOLS = new Set(['Agent', 'Task']);

function claudePromptText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'tool_result') return null; // a tool result, not a prompt
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('\n');
}

// Records Claude Code writes as `user` messages without tagging their source,
// none of which a person typed as a prompt: injected `<tag>` blocks (slash
// command echoes, reminders), the interrupt marker left by Esc, and a slash
// command on its own.
function isUntaggedMachineText(text: string): boolean {
  return /^\s*</.test(text)
    || /^\s*\[Request interrupted by user/.test(text)
    || /^\s*\/[\w:-]+\s*$/.test(text);
}

/**
 * Facts from a chunk of a Claude Code transcript (whole lines).
 *
 * - prompt:     a `user` record a person typed. Newer versions tag the source
 *               (`promptSource`); untagged records are kept only when they are
 *               not one of the machine-written kinds above. Compaction
 *               summaries are never prompts.
 * - edit:       a tool result carrying a structured patch, or a created file.
 * - subagent:   an `Agent`/`Task` tool call.
 * - compaction: a `compact_boundary` record, which states its own trigger and
 *               the context size before and after. A subagent's own
 *               compactions (sidechain) are not the user's conversation and
 *               are skipped.
 *
 * The same function reads a subagent's transcript (`<session>/subagents/…`):
 * every record there is a sidechain, so it yields that subagent's edits and
 * nested launches but no prompts.
 */
export function extractClaudeFacts(text: string, sessionId: string, now: number = Date.now()): ActivityFact[] {
  const facts: ActivityFact[] = [];
  for (const line of text.split('\n')) {
    // Cheap prefilter: skip the bulk (attachments, api-request blobs) unparsed.
    if (
      !line.includes('"type":"user"') && !line.includes('"tool_use"') && !line.includes('"compact_boundary"')
    ) continue;
    let row: any;
    try { row = JSON.parse(line); }
    catch { continue; }
    if (!row || typeof row !== 'object') continue;
    const rowSession: string = row.sessionId ?? row.session_id ?? sessionId;
    const ts = parseTs(row.timestamp, now);

    if (row.type === 'system') {
      if (row.subtype !== 'compact_boundary' || row.isSidechain || typeof row.uuid !== 'string') continue;
      const meta = row.compactMetadata && typeof row.compactMetadata === 'object' ? row.compactMetadata : {};
      const trigger: CompactionTrigger =
        meta.trigger === 'auto' || meta.trigger === 'manual' ? meta.trigger : 'unknown';
      facts.push({
        key: `cc:c:${row.uuid}`, ts, toolId: 'claude-code', sessionId: rowSession, kind: 'compaction',
        trigger, tokensBefore: finiteOrNull(meta.preTokens), tokensAfter: finiteOrNull(meta.postTokens),
      });
      continue;
    }

    if (row.type === 'assistant') {
      const content = row.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type === 'tool_use' && CC_SUBAGENT_TOOLS.has(block.name) && typeof block.id === 'string') {
          facts.push({ key: `cc:s:${block.id}`, ts, toolId: 'claude-code', sessionId: rowSession, kind: 'subagent', toolName: block.name });
        }
      }
      continue;
    }

    if (row.type !== 'user' || typeof row.uuid !== 'string') continue;

    const result = row.toolUseResult;
    if (result !== undefined) {
      if (!result || typeof result !== 'object' || Array.isArray(result)) continue;
      let added = 0;
      let removed = 0;
      let toolName: string;
      if (Array.isArray(result.structuredPatch) && result.structuredPatch.length > 0) {
        for (const hunk of result.structuredPatch) {
          for (const l of Array.isArray(hunk?.lines) ? hunk.lines : []) {
            if (typeof l !== 'string') continue;
            if (l[0] === '+') added++;
            else if (l[0] === '-') removed++;
          }
        }
        toolName = result.type === 'update' ? 'Write' : 'Edit';
      } else if (result.type === 'create' && typeof result.content === 'string') {
        added = countLines(result.content);
        toolName = 'Write';
      } else {
        continue;
      }
      facts.push({
        key: `cc:e:${row.uuid}`, ts, toolId: 'claude-code', sessionId: rowSession, kind: 'edit',
        toolName, linesAdded: added, linesRemoved: removed,
      });
      continue;
    }

    if (row.isSidechain || row.isMeta || row.isCompactSummary || row.isVisibleInTranscriptOnly) continue;
    const promptText = claudePromptText(row.message?.content);
    if (promptText === null) continue;
    if (typeof row.promptSource === 'string') {
      if (!CC_HUMAN_SOURCES.has(row.promptSource)) continue;
    } else if (isUntaggedMachineText(promptText)) {
      continue;
    }
    // "[Image #1]" is the placeholder Claude Code leaves for a pasted image.
    const typed = promptText.replace(/\[Image #\d+\]/g, ' ');
    facts.push({ key: `cc:p:${row.uuid}`, ts, toolId: 'claude-code', sessionId: rowSession, kind: 'prompt', words: countWords(typed) });
  }
  return facts;
}

// ─── Codex ───────────────────────────────────────────────────────────────────

// Per-file state carried from one tail read to the next. A rollout states its
// thread type only in its first record (`session_meta`), and whether a
// compaction was manual depends on what else its turn contains — which may
// arrive in a later read.
export interface CodexThreadContext {
  threadId?: string;
  sessionId?: string;        // the user-facing session; a child thread shares its parent's
  threadSource?: string;     // 'user' | 'guardian_review' | …
  parentThreadId?: string;
  turnActivity?: number;     // messages / tool work seen since the current turn started
  // A compaction that began its turn, waiting to see how the turn goes on.
  pendingCompaction?: { key: string; ts: number };
}

const CODEX_GUARDIAN = 'guardian_review';
// Rollout records are written as {"timestamp":…,"type":…,"payload":…}; reading
// the type off the front avoids parsing records we only need to count.
const CODEX_RECORD_HEAD = /^\{"timestamp":"[^"]*","type":"([a-z_]+)"/;

const REPLY_BLOCK = /<send_user_message_question_reply>([\s\S]*?)<\/send_user_message_question_reply>/g;

/**
 * The words a person typed in a Codex user message.
 *
 * - With attachments, Codex wraps the message as "# Files mentioned by the
 *   user: … ## My request: <text>"; only the text after the last request
 *   marker is the user's.
 * - A reply to a question Codex asked is a JSON array of
 *   {questionItemId, question, answer}; only the answers are the user's.
 */
export function codexTypedText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  let text = parts.join('\n');

  if (/^\s*# /.test(text)) {
    const lines = text.split('\n');
    let marker = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/^## My request:/.test(lines[i])) { marker = i; break; }
    }
    if (marker >= 0) {
      text = [lines[marker].replace(/^## My request:/, ''), ...lines.slice(marker + 1)].join('\n');
    }
  }

  return text.replace(REPLY_BLOCK, (_whole, body: string) => {
    try {
      const parsed = JSON.parse(body);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      const answers = entries
        .map((e) => (e && typeof e === 'object' && typeof e.answer === 'string' ? e.answer : null))
        .filter((a): a is string => a !== null);
      if (answers.length > 0) return ` ${answers.join(' ')} `;
    } catch { /* not the JSON form — count the body as written */ }
    return ` ${body} `;
  });
}

/**
 * Facts from a chunk of a Codex rollout (whole lines). Returns the thread
 * context too, updated for the next read.
 *
 * - A guardian-review thread (Codex's automatic approval reviewer) yields one
 *   `auto_review` per turn and nothing else: its "user messages" are review
 *   requests Codex wrote, not prompts.
 * - A child thread that is not a guardian review is a subagent: one `subagent`
 *   fact for the thread, and its messages are the parent's instructions, so
 *   they are not counted as prompts. Its edits still count.
 * - Otherwise: `UserMessage` items are prompts, completed `FileChange` items
 *   are edits, and `ContextCompaction` items are compactions.
 *
 * Codex does not label a compaction's trigger, so it is read from the shape of
 * its turn: a typed compact command produces a turn containing nothing else,
 * while an automatic one happens inside a turn that is doing work. So:
 *   work earlier in the turn            → auto
 *   nothing before, then work follows   → auto
 *   nothing before, then the turn ends  → manual
 *   nothing before, turn aborted/replaced → unknown
 * The middle cases need the records after the compaction, hence
 * `pendingCompaction`.
 */
export function extractCodexFacts(
  text: string,
  context: CodexThreadContext,
  now: number = Date.now(),
): { facts: ActivityFact[]; context: CodexThreadContext } {
  const facts: ActivityFact[] = [];
  let ctx: CodexThreadContext = { ...context };

  const sessionOf = (): string => ctx.sessionId ?? ctx.parentThreadId ?? ctx.threadId ?? '';
  const resolvePending = (trigger: CompactionTrigger) => {
    const pending = ctx.pendingCompaction;
    if (!pending) return;
    facts.push({
      key: pending.key, ts: pending.ts, toolId: 'openai-codex', sessionId: sessionOf(), kind: 'compaction', trigger,
    });
    ctx.pendingCompaction = undefined;
  };
  const noteActivity = () => {
    resolvePending('auto');
    ctx.turnActivity = (ctx.turnActivity ?? 0) + 1;
  };

  for (const line of text.split('\n')) {
    if (line === '') continue;
    const head = CODEX_RECORD_HEAD.exec(line);
    let recordType: string | undefined = head?.[1];
    let row: any;

    if (recordType === 'response_item') {
      // Model output and tool calls: activity, never parsed. The compaction's
      // own response item is bookkeeping, not work.
      if (!line.slice(0, 240).includes('"type":"compaction"')) noteActivity();
      continue;
    }
    if (recordType === 'event_msg') {
      const isItem = line.includes('"type":"item_completed"');
      const interesting = isItem
        ? line.includes('"UserMessage"') || line.includes('"FileChange"') || line.includes('"ContextCompaction"')
        : line.includes('"type":"task_started"') || line.includes('"type":"task_complete"') || line.includes('"type":"turn_aborted"');
      if (!interesting) {
        if (isItem) noteActivity(); // a command, MCP call, reasoning step…
        continue;
      }
    } else if (recordType !== undefined && recordType !== 'session_meta') {
      continue; // token_usage_record, compacted, world_state, turn_context…
    }

    try { row = JSON.parse(line); }
    catch { continue; }
    const payload = row?.payload;
    if (!payload || typeof payload !== 'object') continue;
    recordType = row.type;
    const ts = parseTs(row.timestamp, now);

    if (recordType === 'session_meta') {
      ctx = {
        ...ctx,
        threadId: typeof payload.id === 'string' ? payload.id : ctx.threadId,
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : ctx.sessionId,
        threadSource: typeof payload.thread_source === 'string' ? payload.thread_source : ctx.threadSource,
        parentThreadId: typeof payload.parent_thread_id === 'string' ? payload.parent_thread_id : ctx.parentThreadId,
      };
      if (ctx.threadId && ctx.parentThreadId && ctx.threadSource !== CODEX_GUARDIAN) {
        facts.push({
          key: `cx:s:${ctx.threadId}`, ts: parseTs(payload.timestamp, ts), toolId: 'openai-codex',
          sessionId: sessionOf(), kind: 'subagent', toolName: ctx.threadSource ?? null,
        });
      }
      continue;
    }

    if (recordType === 'response_item') { noteActivity(); continue; } // only reached when the head regex missed
    if (recordType !== 'event_msg') continue;

    const threadId = ctx.threadId;
    if (!threadId) continue; // no session_meta seen for this file — can't attribute
    const isGuardian = ctx.threadSource === CODEX_GUARDIAN;

    if (payload.type === 'task_started') {
      resolvePending('unknown'); // the previous turn never completed
      ctx.turnActivity = 0;
      if (isGuardian && typeof payload.turn_id === 'string') {
        // started_at is in seconds.
        const startedAt = typeof payload.started_at === 'number' ? payload.started_at * 1000 : ts;
        facts.push({ key: `cx:r:${payload.turn_id}`, ts: startedAt, toolId: 'openai-codex', sessionId: sessionOf(), kind: 'auto_review' });
      }
      continue;
    }
    if (payload.type === 'task_complete') { resolvePending('manual'); continue; }
    if (payload.type === 'turn_aborted') { resolvePending('unknown'); continue; }
    if (payload.type !== 'item_completed') continue;

    const item = payload.item;
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
    const itemTs = parseTs(payload.completed_at_ms, ts);

    if (item.type === 'ContextCompaction') {
      // Only the user's own conversation: not a reviewer's or a subagent's.
      if (isGuardian || ctx.parentThreadId) continue;
      const key = `cx:c:${threadId}:${item.id}`;
      if ((ctx.turnActivity ?? 0) > 0) {
        facts.push({ key, ts: itemTs, toolId: 'openai-codex', sessionId: sessionOf(), kind: 'compaction', trigger: 'auto' });
      } else {
        resolvePending('unknown'); // two in a row with nothing between — keep the earlier one
        ctx.pendingCompaction = { key, ts: itemTs };
      }
      continue;
    }

    noteActivity();
    if (isGuardian) continue;

    if (item.type === 'UserMessage') {
      if (ctx.parentThreadId) continue;
      facts.push({
        key: `cx:p:${threadId}:${item.id}`, ts: itemTs, toolId: 'openai-codex', sessionId: sessionOf(), kind: 'prompt',
        words: countWords(codexTypedText(item.content)),
      });
    } else if (item.type === 'FileChange') {
      if (item.status !== 'completed' || !item.changes || typeof item.changes !== 'object') continue;
      let added = 0;
      let removed = 0;
      for (const change of Object.values(item.changes) as any[]) {
        if (!change || typeof change !== 'object') continue;
        if (typeof change.unified_diff === 'string') {
          const d = countDiffLines(change.unified_diff);
          added += d.added;
          removed += d.removed;
        } else if (typeof change.content === 'string') {
          if (change.type === 'delete') removed += countLines(change.content);
          else added += countLines(change.content);
        }
      }
      facts.push({
        key: `cx:e:${threadId}:${item.id}`, ts: itemTs, toolId: 'openai-codex', sessionId: sessionOf(), kind: 'edit',
        toolName: 'apply_patch', linesAdded: added, linesRemoved: removed,
      });
    }
  }
  return { facts, context: ctx };
}

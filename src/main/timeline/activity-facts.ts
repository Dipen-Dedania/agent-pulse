// Turns agent session files into small numeric "facts": one per prompt the
// user typed, per file edit the agent made, per subagent it launched, and per
// Codex auto-review. Pure text → facts; no fs, no DB (see activity-sync.ts).
//
// Only counts leave this module — never prompt text or file content.
//
// Both formats are undocumented internals, verified against real files
// (Claude Code 2.1.x transcripts, Codex 0.169 rollouts). Anything unrecognised
// is skipped, so a format change loses facts instead of breaking the reader.

import { ToolId } from '../../common/types';

export type ActivityKind = 'prompt' | 'edit' | 'subagent' | 'auto_review';

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
}

export function countWords(text: string): number {
  return text.trim().match(/\S+/g)?.length ?? 0;
}

/** Lines in a file body; a trailing newline does not start another line. */
export function countLines(text: string): number {
  if (text === '') return 0;
  return text.replace(/\r?\n$/, '').split('\n').length;
}

/** Added/removed lines in a unified diff body, ignoring file headers. */
export function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
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

/**
 * Facts from a chunk of a Claude Code transcript (whole lines).
 *
 * - prompt:   a `user` record a person typed. Newer versions tag the source
 *             (`promptSource`); older ones are recognised by not being meta and
 *             not starting with an injected `<tag>` (slash commands, reminders).
 * - edit:     a tool result carrying a structured patch, or a created file.
 * - subagent: an `Agent`/`Task` tool call. Subagents' own turns live in
 *             separate files, so each launch is seen exactly once here.
 */
export function extractClaudeFacts(text: string, sessionId: string, now: number = Date.now()): ActivityFact[] {
  const facts: ActivityFact[] = [];
  for (const line of text.split('\n')) {
    // Cheap prefilter: skip the bulk (attachments, api-request blobs) unparsed.
    if (!line.includes('"type":"user"') && !line.includes('"tool_use"')) continue;
    let row: any;
    try { row = JSON.parse(line); }
    catch { continue; }
    if (!row || typeof row !== 'object') continue;
    const rowSession: string = row.sessionId ?? row.session_id ?? sessionId;
    const ts = parseTs(row.timestamp, now);

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

    if (row.isSidechain || row.isMeta) continue;
    const promptText = claudePromptText(row.message?.content);
    if (promptText === null) continue;
    if (typeof row.promptSource === 'string') {
      if (!CC_HUMAN_SOURCES.has(row.promptSource)) continue;
    } else if (/^\s*</.test(promptText)) {
      continue; // <command-name>, <local-command-stdout>, <system-reminder>…
    }
    // "[Image #1]" is the placeholder Claude Code leaves for a pasted image.
    const typed = promptText.replace(/\[Image #\d+\]/g, ' ');
    facts.push({ key: `cc:p:${row.uuid}`, ts, toolId: 'claude-code', sessionId: rowSession, kind: 'prompt', words: countWords(typed) });
  }
  return facts;
}

// ─── Codex ───────────────────────────────────────────────────────────────────

// What a rollout's first record (`session_meta`) says about the thread. Read
// once and carried across tail reads, since later chunks don't repeat it.
export interface CodexThreadContext {
  threadId?: string;
  sessionId?: string;        // the user-facing session; a child thread shares its parent's
  threadSource?: string;     // 'user' | 'guardian_review' | …
  parentThreadId?: string;
}

const CODEX_GUARDIAN = 'guardian_review';

function codexPromptText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  // A reply to a question Codex asked arrives wrapped in a marker element.
  return parts.join('\n').replace(/<\/?send_user_message_question_reply>/g, ' ');
}

/**
 * Facts from a chunk of a Codex rollout (whole lines). Returns the thread
 * context too — updated when the chunk contains the `session_meta` record.
 *
 * - A guardian-review thread (Codex's automatic approval reviewer) yields one
 *   `auto_review` per turn and nothing else: its "user messages" are review
 *   requests Codex wrote, not prompts.
 * - A child thread that is not a guardian review is a subagent: one `subagent`
 *   fact for the thread, and its messages are the parent's instructions, so
 *   they are not counted as prompts. Its edits still count.
 * - Otherwise: `UserMessage` items are prompts, completed `FileChange` items
 *   are edits.
 */
export function extractCodexFacts(
  text: string,
  context: CodexThreadContext,
  now: number = Date.now(),
): { facts: ActivityFact[]; context: CodexThreadContext } {
  const facts: ActivityFact[] = [];
  let ctx = context;
  for (const line of text.split('\n')) {
    if (
      !line.includes('"session_meta"') && !line.includes('"UserMessage"') &&
      !line.includes('"FileChange"') && !line.includes('"task_started"')
    ) continue;
    let row: any;
    try { row = JSON.parse(line); }
    catch { continue; }
    const payload = row?.payload;
    if (!payload || typeof payload !== 'object') continue;
    const ts = parseTs(row.timestamp, now);

    if (row.type === 'session_meta') {
      ctx = {
        threadId: typeof payload.id === 'string' ? payload.id : ctx.threadId,
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : ctx.sessionId,
        threadSource: typeof payload.thread_source === 'string' ? payload.thread_source : ctx.threadSource,
        parentThreadId: typeof payload.parent_thread_id === 'string' ? payload.parent_thread_id : ctx.parentThreadId,
      };
      if (ctx.threadId && ctx.parentThreadId && ctx.threadSource !== CODEX_GUARDIAN) {
        facts.push({
          key: `cx:s:${ctx.threadId}`, ts: parseTs(payload.timestamp, ts), toolId: 'openai-codex',
          sessionId: ctx.sessionId ?? ctx.parentThreadId, kind: 'subagent', toolName: ctx.threadSource ?? null,
        });
      }
      continue;
    }

    const threadId = ctx.threadId;
    if (!threadId) continue; // no session_meta seen for this file — can't attribute
    const sessionId = ctx.sessionId ?? threadId;

    if (ctx.threadSource === CODEX_GUARDIAN) {
      if (row.type === 'event_msg' && payload.type === 'task_started' && typeof payload.turn_id === 'string') {
        // started_at is in seconds.
        const startedAt = typeof payload.started_at === 'number' ? payload.started_at * 1000 : ts;
        facts.push({ key: `cx:r:${payload.turn_id}`, ts: startedAt, toolId: 'openai-codex', sessionId, kind: 'auto_review' });
      }
      continue;
    }

    if (row.type !== 'event_msg' || payload.type !== 'item_completed') continue;
    const item = payload.item;
    if (!item || typeof item !== 'object' || typeof item.id !== 'string') continue;
    const itemTs = parseTs(payload.completed_at_ms, ts);

    if (item.type === 'UserMessage') {
      if (ctx.parentThreadId) continue;
      facts.push({
        key: `cx:p:${threadId}:${item.id}`, ts: itemTs, toolId: 'openai-codex', sessionId, kind: 'prompt',
        words: countWords(codexPromptText(item.content)),
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
        key: `cx:e:${threadId}:${item.id}`, ts: itemTs, toolId: 'openai-codex', sessionId, kind: 'edit',
        toolName: 'apply_patch', linesAdded: added, linesRemoved: removed,
      });
    }
  }
  return { facts, context: ctx };
}

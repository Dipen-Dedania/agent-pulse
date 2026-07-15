// Extracts the target file path out of a read-class tool call's PreToolUse
// payload — the Secret Protection analogue of guardrails/extractCommand.ts.
//
// Returns null when the payload isn't a read we can reason about (→ the bridge
// falls through to the normal status broadcast). Two sources:
//   1. Structured read tools (Read / read_file / view / grep / …): the path is
//      a field on tool_input.
//   2. Shell reads (cat/type/less/…): best-effort. We reuse extractCommand to
//      get the command string, then scan for a read verb followed by a path
//      token. Completeness is impossible (infinite phrasings) — this is exactly
//      the Layer-3 "not 100%" caveat — so we stay conservative: a hit is only
//      reported when an optional `isProtected` predicate confirms the token
//      resolves to a protected glob.

import { ToolId } from '../../common/types';
import { extractCommand } from '../guardrails/extractCommand';

// Structured read/inspect tools across the agents we track. Anything not here
// (and not a shell tool) yields null.
const READ_TOOL_NAMES = new Set([
  'read', 'read_file', 'readfile', 'view', 'cat', 'open',
  'grep', 'glob', 'search_file', 'searchfile', 'str_replace_editor',
  'view_file', 'fsread', 'fs_read',
]);

// Shell read verbs. A token equal to one of these (case-insensitive) is treated
// as "the following non-flag token is a file being read".
const READ_VERBS = new Set([
  'cat', 'less', 'more', 'head', 'tail', 'xxd', 'od', 'strings',
  'source', '.', 'type', 'get-content', 'gc',
]);

function pickString(obj: any, paths: string[]): string | null {
  for (const p of paths) {
    const segments = p.split('.');
    let cur: any = obj;
    for (const seg of segments) {
      if (cur == null) { cur = undefined; break; }
      cur = cur[seg];
    }
    if (typeof cur === 'string' && cur.length > 0) return cur;
  }
  return null;
}

function isReadTool(name: unknown): boolean {
  return typeof name === 'string' && READ_TOOL_NAMES.has(name.toLowerCase());
}

function stripQuotes(token: string): string {
  if (token.length >= 2) {
    const a = token[0];
    const b = token[token.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return token.slice(1, -1);
  }
  return token;
}

export interface ExtractReadResult {
  path: string;
  viaShell: boolean;
}

export interface ExtractReadOptions {
  // When provided, a shell-derived candidate is only returned if this predicate
  // confirms it's a protected path. Keeps the best-effort shell scan from
  // flagging ordinary reads. Structured reads ignore this (the engine gates).
  isProtected?: (candidate: string) => boolean;
}

// Best-effort scan of a shell command for `<read-verb> <path>`. Returns the
// first candidate path token (optionally filtered through isProtected).
function scanShellRead(command: string, opts?: ExtractReadOptions): string | null {
  // Split on shell separators too, so `foo && cat .env` still trips.
  const tokens = command
    .split(/[\s|;&]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  for (let i = 0; i < tokens.length; i++) {
    const verb = tokens[i].toLowerCase();
    if (!READ_VERBS.has(verb)) continue;
    // Collect following non-flag tokens as candidate paths.
    for (let j = i + 1; j < tokens.length; j++) {
      const raw = tokens[j];
      if (raw.startsWith('-')) continue;             // flag, skip
      if (READ_VERBS.has(raw.toLowerCase())) break;  // next verb — stop this run
      const candidate = stripQuotes(raw);
      if (!candidate) continue;
      if (opts?.isProtected && !opts.isProtected(candidate)) continue;
      return candidate;
    }
  }
  return null;
}

export function extractReadPath(
  toolId: ToolId,
  data: any,
  opts?: ExtractReadOptions,
): ExtractReadResult | null {
  if (!data || typeof data !== 'object') return null;

  // 1. Structured read tools.
  // Grok sends camelCase `toolName` (e.g. read_file); Antigravity nests under
  // toolCall; the rest use snake_case tool_name.
  const toolName = data.toolCall?.name ?? data.tool_name ?? data.toolName;
  if (isReadTool(toolName)) {
    const path = pickString(data, [
      'tool_input.file_path',
      'tool_input.path',
      'tool_input.target_file',
      'tool_input.filename',
      'toolInput.file_path',
      'toolInput.path',
      'toolInput.target_file',
      'toolInput.filename',
      'input.file_path',
      'input.path',
      'parameters.file_path',
      'parameters.path',
      // Antigravity nests args under toolCall.
      'toolCall.args.path',
      'toolCall.args.file_path',
      'toolCall.arguments.path',
      'toolCall.arguments.file_path',
    ]);
    if (path) return { path, viaShell: false };
    return null;
  }

  // 2. Shell reads — best-effort, reusing the command extractor.
  const command = extractCommand(toolId, data);
  if (command) {
    const candidate = scanShellRead(command, opts);
    if (candidate) return { path: candidate, viaShell: true };
  }

  return null;
}

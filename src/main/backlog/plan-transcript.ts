// Locate and read the plan out of a Claude Code session transcript. The
// interactive plan-mode refinement session (see refine-terminal.ts) runs under
// a known `--session-id <uuid>`; Claude Code writes its transcript to
// `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Plan mode records the
// plan as an `ExitPlanMode` tool_use whose `input.plan` is the full markdown —
// that is what we attach to the card. All parsing is pure and unit-tested; the
// fs edges (locate + read) are thin wrappers.

import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Claude Code encodes the session's cwd into the transcript folder name by
 * replacing path separators and the drive colon with `-` (verified against a
 * real folder: `E:\DDrive\Github\agent-pulse` → `E--DDrive-Github-agent-pulse`).
 */
export function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[:\\/]/g, '-');
}

export function projectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

/** The deterministic transcript path from cwd + session id. */
export function resolveTranscriptPath(cwd: string, sessionId: string): string {
  return path.join(projectsRoot(), encodeProjectDir(cwd), `${sessionId}.jsonl`);
}

/**
 * Resolve the transcript file for a session. Tries the deterministic encoded
 * path first, then falls back to scanning every project folder for
 * `<sessionId>.jsonl` — the encoding scheme can drift across CLI versions, and
 * a UUID file name is globally unique, so a match is unambiguous. Returns null
 * when no such transcript exists yet (the session may not have written one).
 */
export function findTranscriptPath(cwd: string, sessionId: string): string | null {
  const direct = resolveTranscriptPath(cwd, sessionId);
  try {
    if (fs.existsSync(direct)) return direct;
  } catch { /* fall through to scan */ }

  let dirs: string[];
  try {
    dirs = fs.readdirSync(projectsRoot());
  } catch {
    return null;
  }
  for (const dir of dirs) {
    const candidate = path.join(projectsRoot(), dir, `${sessionId}.jsonl`);
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* keep scanning */ }
  }
  return null;
}

/**
 * Extract the plan from raw transcript JSONL content. Plan mode appends an
 * `ExitPlanMode` tool_use each time a plan is presented; the LAST one wins
 * (present → reject → re-plan). Falls back to the last assistant text message
 * when no plan tool call is present. Returns null when nothing usable is found.
 * Pure — the fs read lives in `readPlanFromTranscript`.
 */
export function extractPlanFromTranscript(content: string): string | null {
  let lastPlan: string | null = null;
  let lastAssistantText: string | null = null;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const parts = obj?.message?.content;
    if (!Array.isArray(parts)) continue;
    const isAssistant = obj?.message?.role === 'assistant';
    for (const part of parts) {
      if (
        part?.type === 'tool_use' &&
        part?.name === 'ExitPlanMode' &&
        typeof part?.input?.plan === 'string'
      ) {
        lastPlan = part.input.plan;
      } else if (isAssistant && part?.type === 'text' && typeof part?.text === 'string') {
        lastAssistantText = part.text;
      }
    }
  }

  const plan = lastPlan ?? lastAssistantText;
  return plan && plan.trim().length > 0 ? plan.trim() : null;
}

/** Locate + read + extract the current plan for a session; null if unavailable. */
export function readPlanFromTranscript(cwd: string, sessionId: string): string | null {
  const file = findTranscriptPath(cwd, sessionId);
  if (!file) return null;
  try {
    return extractPlanFromTranscript(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

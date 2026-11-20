// Reads session files the live path has not seen: on the first run, everything
// still on disk (so the activity cards start with history); on every later
// launch, just the last few days (so sessions that ran while Agent Pulse was
// closed are not lost). It only walks the files and hands each to ActivitySync
// — the same reader that runs live — so there is no second parser, and a file
// that is already fully read costs one stat.
//
// Spread over many ticks (one chunk each) and started after boot settles,
// since a first read can be several MB.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../../common/logger';
import { ToolId } from '../../common/types';
import { listClaudeSubagentFiles } from './activity-sync';
import { claudeProjectsDir } from './limit-backfill';

// Set once the first full pass has completed. Bump the suffix to force a full
// re-read after a parser change — together with a migration that clears
// activity_offsets, or every file will look fully read.
export const ACTIVITY_BACKFILL_MARKER = 'activity_backfill_done_v2';

const DAY_MS = 24 * 60 * 60 * 1000;
// First run: as far back as facts are kept. Later runs: a catch-up window.
const FULL_WINDOW_MS = 365 * DAY_MS;
const CATCH_UP_WINDOW_MS = 7 * DAY_MS;
// The newest files win when there are more than this.
const MAX_FILES = 5000;

export interface ActivityBackfillOptions {
  claudeProjectsDir?: string;
  codexSessionsDir?: string;
  // Runs `fn` later; returns a cancel function. Default: a short timer.
  schedule?: (fn: () => void) => () => void;
  now?: () => number;
  maxFiles?: number;
  // Called when the pass finishes, with whether it recorded anything new.
  onDone?: (result: { files: number; inserted: number; full: boolean }) => void;
}

interface BackfillFile { path: string; toolId: ToolId; sessionId: string; mtimeMs: number }

function mtimeOf(file: string): number | null {
  try { return fs.statSync(file).mtimeMs; }
  catch { return null; }
}

// <projects>/<slug>/<sessionId>.jsonl, plus each session's subagent transcripts.
function listClaudeFiles(root: string, cutoff: number): BackfillFile[] {
  const out: BackfillFile[] = [];
  let projects: fs.Dirent[];
  try { projects = fs.readdirSync(root, { withFileTypes: true }); }
  catch { return out; }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    const projectDir = path.join(root, project.name);
    let files: string[];
    try { files = fs.readdirSync(projectDir); }
    catch { continue; }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(projectDir, name);
      const sessionId = path.basename(name, '.jsonl');
      const mtimeMs = mtimeOf(file);
      if (mtimeMs !== null && mtimeMs >= cutoff) out.push({ path: file, toolId: 'claude-code', sessionId, mtimeMs });
      // A subagent can outlive its parent's last write, so check it on its own.
      for (const sub of listClaudeSubagentFiles(file)) {
        const subMtime = mtimeOf(sub);
        if (subMtime !== null && subMtime >= cutoff) out.push({ path: sub, toolId: 'claude-code', sessionId, mtimeMs: subMtime });
      }
    }
  }
  return out;
}

// sessions/YYYY/MM/DD/rollout-*.jsonl. A Codex file names its own session in
// its first record, so there is no session id to pass.
function listCodexFiles(root: string, cutoff: number): BackfillFile[] {
  const out: BackfillFile[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); continue; }
      if (!e.name.startsWith('rollout-') || !e.name.endsWith('.jsonl')) continue;
      const mtimeMs = mtimeOf(p);
      if (mtimeMs !== null && mtimeMs >= cutoff) out.push({ path: p, toolId: 'openai-codex', sessionId: '', mtimeMs });
    }
  };
  walk(root, 0);
  return out;
}

/**
 * Starts a pass over the session files on disk. Returns a function that
 * cancels whatever is still pending (call it when the timeline closes). An
 * interrupted first pass leaves no marker, so the next launch runs a full pass
 * again and skips the files it had finished.
 */
export function startActivityBackfill(
  meta: { getMeta: (key: string) => string | null; setMeta: (key: string, value: string) => void },
  sync: { syncStep: (filePath: string, toolId: ToolId, sessionId: string) => { inserted: number; more: boolean } },
  opts: ActivityBackfillOptions = {},
): () => void {
  let full: boolean;
  try { full = !meta.getMeta(ACTIVITY_BACKFILL_MARKER); }
  catch { return () => undefined; } // marker unreadable — don't guess

  const now = (opts.now ?? Date.now)();
  const cutoff = now - (full ? FULL_WINDOW_MS : CATCH_UP_WINDOW_MS);
  const schedule = opts.schedule ?? ((fn) => {
    const t = setTimeout(fn, 10);
    return () => clearTimeout(t);
  });

  // Newest first, so the cap (and an interrupted pass) keeps recent history.
  const files = [
    ...listClaudeFiles(opts.claudeProjectsDir ?? claudeProjectsDir(), cutoff),
    ...listCodexFiles(opts.codexSessionsDir ?? path.join(os.homedir(), '.codex', 'sessions'), cutoff),
  ].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, opts.maxFiles ?? MAX_FILES);

  let cancelled = false;
  let cancelPending: () => void = () => undefined;
  let index = 0;
  let inserted = 0;
  const step = () => {
    if (cancelled) return;
    if (index >= files.length) {
      if (full) meta.setMeta(ACTIVITY_BACKFILL_MARKER, String(now));
      if (full || inserted > 0) {
        logger.info(`[Timeline/activity-backfill] ${full ? 'full pass' : 'catch-up'}: read ${files.length} session file(s), recorded ${inserted} fact(s)`);
      }
      try { opts.onDone?.({ files: files.length, inserted, full }); }
      catch (e: any) { logger.warn('[Timeline/activity-backfill] onDone failed:', e?.message ?? e); }
      return;
    }
    const f = files[index];
    const result = sync.syncStep(f.path, f.toolId, f.sessionId);
    inserted += result.inserted;
    if (!result.more) index++; // a long file takes several ticks
    cancelPending = schedule(step);
  };
  cancelPending = schedule(step);

  return () => {
    cancelled = true;
    cancelPending();
  };
}

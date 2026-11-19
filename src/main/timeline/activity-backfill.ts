// One-time pass over the session files already on disk, so the activity cards
// show history from before this feature existed. It only walks the files and
// hands each to ActivitySync — the same reader that runs live — so there is no
// second parser, and a file the live path has already read costs one stat.
//
// Spread over many ticks (one file each) and started after boot settles, since
// a first read can be several MB. Guarded by a `meta` marker: without it the
// directory walk would repeat on every launch for nothing.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../../common/logger';
import { ToolId } from '../../common/types';
import { claudeProjectsDir, listTranscripts } from './limit-backfill';

// Bump the suffix to re-run after a parser change — and clear activity_offsets
// in the same migration, or every file will look fully read.
export const ACTIVITY_BACKFILL_MARKER = 'activity_backfill_done_v1';

// Facts older than the events retention window are pruned anyway.
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_CODEX_FILES = 5000;

export interface ActivityBackfillOptions {
  claudeProjectsDir?: string;
  codexSessionsDir?: string;
  // Runs `fn` later; returns a cancel function. Default: a short timer.
  schedule?: (fn: () => void) => () => void;
  now?: () => number;
}

interface BackfillFile { path: string; toolId: ToolId; sessionId: string }

function listCodexRollouts(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_CODEX_FILES) return;
      const p = path.join(dir, e.name);
      // sessions/YYYY/MM/DD/rollout-*.jsonl — never deeper than three levels.
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); }
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(root, 0);
  return out;
}

function isRecent(file: string, cutoff: number): boolean {
  try { return fs.statSync(file).mtimeMs >= cutoff; }
  catch { return false; }
}

/**
 * Starts the backfill unless it has already completed. Returns a function that
 * cancels whatever is still pending (call it on shutdown); an interrupted run
 * leaves no marker and simply starts over next launch, skipping files it had
 * finished.
 */
export function maybeBackfillActivity(
  meta: { getMeta: (key: string) => string | null; setMeta: (key: string, value: string) => void },
  sync: { syncFile: (filePath: string, toolId: ToolId, sessionId: string) => number },
  opts: ActivityBackfillOptions = {},
): () => void {
  try {
    if (meta.getMeta(ACTIVITY_BACKFILL_MARKER)) return () => undefined;
  } catch {
    return () => undefined; // marker unreadable — don't risk a scan every boot
  }

  const now = (opts.now ?? Date.now)();
  const cutoff = now - MAX_AGE_MS;
  const schedule = opts.schedule ?? ((fn) => {
    const t = setTimeout(fn, 10);
    return () => clearTimeout(t);
  });

  const files: BackfillFile[] = [];
  for (const file of listTranscripts(opts.claudeProjectsDir ?? claudeProjectsDir())) {
    if (isRecent(file, cutoff)) files.push({ path: file, toolId: 'claude-code', sessionId: path.basename(file, '.jsonl') });
  }
  // A Codex file names its own session in its first record; nothing to pass.
  for (const file of listCodexRollouts(opts.codexSessionsDir ?? path.join(os.homedir(), '.codex', 'sessions'))) {
    if (isRecent(file, cutoff)) files.push({ path: file, toolId: 'openai-codex', sessionId: '' });
  }

  let cancelled = false;
  let cancelPending: () => void = () => undefined;
  let index = 0;
  let inserted = 0;
  const step = () => {
    if (cancelled) return;
    if (index >= files.length) {
      meta.setMeta(ACTIVITY_BACKFILL_MARKER, String(now));
      logger.info(`[Timeline/activity-backfill] read ${files.length} session file(s), recorded ${inserted} fact(s)`);
      return;
    }
    const f = files[index++];
    inserted += sync.syncFile(f.path, f.toolId, f.sessionId);
    cancelPending = schedule(step);
  };
  cancelPending = schedule(step);

  return () => {
    cancelled = true;
    cancelPending();
  };
}

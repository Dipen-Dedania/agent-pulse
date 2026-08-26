import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../../common/logger';
import { detectLimitHits } from './limit-detector';

// Narrow sink so this module doesn't depend on the concrete TimelineDb (avoids
// an import cycle with db.ts, which imports this).
export interface LimitBackfillSink {
  insertLimitEvent: (row: {
    uuid: string; ts: number; toolId: string; sessionId?: string | null; kind: string; resetText?: string | null;
  }) => void;
  getMeta: (key: string) => string | null;
  setMeta: (key: string, value: string) => void;
}

const BACKFILL_MARKER = 'limit_backfill_done';

// Bound the scan so a pathological ~/.claude/projects (thousands of huge
// transcripts) can't stall boot. Limit hits are rare and small; this is plenty.
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 32 * 1024 * 1024;

/** ~/.claude/projects, honoring CLAUDE_CONFIG_DIR like Claude Code itself. */
function claudeProjectsDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR
    ? process.env.CLAUDE_CONFIG_DIR
    : path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

function listTranscripts(dir: string): string[] {
  const out: string[] = [];
  let projectDirs: fs.Dirent[];
  try { projectDirs = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }
  for (const pd of projectDirs) {
    if (!pd.isDirectory()) continue;
    const projPath = path.join(dir, pd.name);
    let files: string[];
    try { files = fs.readdirSync(projPath); }
    catch { continue; }
    for (const f of files) {
      if (f.endsWith('.jsonl')) out.push(path.join(projPath, f));
      if (out.length >= MAX_FILES) return out;
    }
  }
  return out;
}

/**
 * One-time scan of existing Claude Code transcripts to populate limit_events
 * with hits that predate this feature. Guarded by a `meta` marker so it runs at
 * most once; inserts are INSERT OR IGNORE keyed on message uuid, so even if it
 * races the live reader nothing is double-counted. Safe to call on every boot —
 * it no-ops once the marker is set.
 *
 * Session id is derived from the transcript filename (Claude Code names each
 * file `<sessionId>.jsonl`); the detector also reads the per-row sessionId when
 * present and prefers that.
 */
export function maybeBackfillLimitEvents(sink: LimitBackfillSink): void {
  try {
    if (sink.getMeta(BACKFILL_MARKER)) return;
  } catch {
    // If the marker can't be read, don't risk an unbounded re-scan loop.
    return;
  }

  const dir = claudeProjectsDir();
  const files = listTranscripts(dir);
  let inserted = 0;

  for (const file of files) {
    let text: string;
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue;
      text = fs.readFileSync(file, 'utf8');
    } catch { continue; }

    const sessionFromName = path.basename(file, '.jsonl');
    for (const hit of detectLimitHits(text, sessionFromName, 'claude-code')) {
      sink.insertLimitEvent(hit);
      inserted++;
    }
  }

  sink.setMeta(BACKFILL_MARKER, String(Date.now()));
  logger.info(`[Timeline/limit-backfill] scanned ${files.length} transcript(s), recorded ${inserted} historical limit hit(s)`);
}

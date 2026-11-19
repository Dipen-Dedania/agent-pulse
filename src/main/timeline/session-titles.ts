import fs from 'fs';
import path from 'path';
import { claudeProjectsDir } from './limit-backfill';

// Human-readable titles for Claude Code sessions, read straight from the
// session transcript (`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`).
// Claude Code appends a `{"type":"ai-title","aiTitle":…}` record every few
// turns and a `{"type":"custom-title","customTitle":…}` record on /rename; the
// newest one wins, with a user-chosen title beating a generated one.
//
// Read-only and schema-free on purpose: titles change as a session goes on, so
// they are resolved at query time rather than copied into the timeline DB.

// Title records recur throughout the file, so the tail nearly always has one;
// the head is the fallback for a transcript that ends in a run of huge records.
const WINDOW_BYTES = 512 * 1024;
const MAX_TITLE_CHARS = 120;
const MAX_CACHE = 500;

interface CachedTitle { mtimeMs: number; size: number; title: string | null }

const pathCache = new Map<string, string>();
const titleCache = new Map<string, CachedTitle>();

function remember<V>(cache: Map<string, V>, key: string, value: V): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

function findTranscript(sessionId: string, projectsDir: string): string | null {
  const cached = pathCache.get(sessionId);
  if (cached && fs.existsSync(cached)) return cached;

  let projectDirs: fs.Dirent[];
  try { projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }); }
  catch { return null; }
  for (const pd of projectDirs) {
    if (!pd.isDirectory()) continue;
    const candidate = path.join(projectsDir, pd.name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) {
      remember(pathCache, sessionId, candidate);
      return candidate;
    }
  }
  return null;
}

function readWindow(file: string, start: number, length: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, start);
    return buf.toString('utf8', 0, read);
  } finally {
    fs.closeSync(fd);
  }
}

/** Newest title in a chunk of transcript text; a /rename title beats an AI one. */
export function extractSessionTitle(text: string): string | null {
  let ai: string | null = null;
  let custom: string | null = null;
  for (const line of text.split('\n')) {
    // Cheap prefilter — transcripts are mostly multi-KB message records.
    if (!line.startsWith('{"type":"ai-title"') && !line.startsWith('{"type":"custom-title"')) continue;
    let rec: { type?: unknown; aiTitle?: unknown; customTitle?: unknown };
    try { rec = JSON.parse(line); }
    catch { continue; } // a window boundary can cut a record in half
    if (rec.type === 'custom-title' && typeof rec.customTitle === 'string' && rec.customTitle.trim()) {
      custom = rec.customTitle;
    } else if (rec.type === 'ai-title' && typeof rec.aiTitle === 'string' && rec.aiTitle.trim()) {
      ai = rec.aiTitle;
    }
  }
  const title = (custom ?? ai)?.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS - 1)}…` : title;
}

/**
 * Title of a Claude Code session, or null when the transcript is gone or has no
 * title record yet (older Claude Code versions never wrote one). Cached per
 * transcript on mtime+size, so a refresh only re-reads sessions that moved.
 */
export function resolveClaudeSessionTitle(
  sessionId: string,
  projectsDir: string = claudeProjectsDir(),
): string | null {
  // Session ids become a filename — refuse anything that isn't a plain token.
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return null;
  try {
    const file = findTranscript(sessionId, projectsDir);
    if (!file) return null;
    const stat = fs.statSync(file);
    const cached = titleCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.title;

    const tailStart = Math.max(0, stat.size - WINDOW_BYTES);
    let title = extractSessionTitle(readWindow(file, tailStart, stat.size - tailStart));
    if (title === null && tailStart > 0) {
      title = extractSessionTitle(readWindow(file, 0, Math.min(WINDOW_BYTES, tailStart)));
    }
    remember(titleCache, file, { mtimeMs: stat.mtimeMs, size: stat.size, title });
    return title;
  } catch {
    return null;
  }
}

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const CACHE_SIZE = 256;

export interface ResolvedProject {
  projectId: string;
  projectPath: string;
  displayName: string;
}

const cache = new Map<string, ResolvedProject>();

function lruGet(key: string): ResolvedProject | undefined {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
}

function lruSet(key: string, value: ResolvedProject) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_SIZE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
}

// Normalize a cwd into a stable form: resolved to absolute, symlinks
// followed when possible, lowercase drive on Windows. Failure paths fall
// back gracefully — we never throw from here.
function normalizeCwd(cwd: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync.native(cwd);
  } catch {
    try { resolved = path.resolve(cwd); }
    catch { resolved = cwd; }
  }
  if (process.platform === 'win32' && /^[A-Z]:/.test(resolved)) {
    resolved = resolved[0].toLowerCase() + resolved.slice(1);
  }
  return resolved;
}

// Walks up at most MAX_DEPTH levels looking for a .git entry (file or dir;
// .git is a file in worktrees and submodules).
function findGitRoot(start: string): string | null {
  const MAX_DEPTH = 32;
  let dir = start;
  for (let i = 0; i < MAX_DEPTH; i++) {
    try {
      const gitPath = path.join(dir, '.git');
      if (fs.existsSync(gitPath)) return dir;
    } catch { /* ignore */ }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function resolveProject(cwd: string | undefined | null): ResolvedProject | null {
  if (!cwd) return null;
  const hit = lruGet(cwd);
  if (hit) return hit;

  const normalized = normalizeCwd(cwd);
  const root = findGitRoot(normalized) ?? normalized;
  const id = crypto.createHash('sha1').update(root).digest('hex').slice(0, 8);
  const resolved: ResolvedProject = {
    projectId: id,
    projectPath: root,
    displayName: path.basename(root) || root,
  };
  lruSet(cwd, resolved);
  return resolved;
}

// Test-only: clear the cache between cases.
export function _resetProjectResolverCache() {
  cache.clear();
}

// Derive a project's GitLab identity from its `origin` git remote. Pure parser
// (fixture-tested) + a thin execFile wrapper to read the remote. Never a shell:
// git is invoked via execFile with argv, and the parser only reads a string.
// See backlog-phase3-gitlab-population-plan.md (WS2).

import { execFile } from 'child_process';
import { logger } from '../../common/logger';

const GIT_TIMEOUT_MS = 60_000;

export interface GitlabRemote {
  host: string;        // e.g. 'gitlab.com' or a self-managed host
  projectPath: string; // 'group/sub/project' (subgroups kept, no leading slash, no .git)
}

/**
 * Parse a git remote URL into `{ host, projectPath }`, or null if it is not a
 * recognizable GitLab-style remote. Handles:
 *   - SSH scp-style:  git@host:group/sub/proj.git
 *   - SSH URL:        ssh://git@host:22/group/proj.git
 *   - HTTPS:          https://host/group/proj.git
 *   - Credentialed:   https://oauth2:TOKEN@host/group/proj.git
 * Strips credentials, a leading slash, a trailing '.git', and keeps subgroups.
 */
export function parseGitRemote(url: unknown): GitlabRemote | null {
  if (typeof url !== 'string') return null;
  const raw = url.trim();
  if (raw.length === 0) return null;

  let host: string;
  let pathPart: string;

  // scp-style: [user@]host:group/proj(.git) — no scheme, a colon before a
  // non-numeric path. Distinguish from ssh://host:port/... by the missing scheme.
  const scp = /^(?:[^@/]+@)?([^/:]+):(.+)$/;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && scp.test(raw)) {
    const m = scp.exec(raw)!;
    host = m[1];
    pathPart = m[2];
  } else {
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return null;
    }
    host = parsed.hostname; // URL drops any user:pass@ credentials for us
    pathPart = parsed.pathname;
  }

  const projectPath = pathPart
    .replace(/^\/+/, '')       // leading slashes
    .replace(/\.git$/i, '')    // trailing .git
    .replace(/\/+$/, '');      // trailing slashes

  if (!host || projectPath.length === 0 || !projectPath.includes('/')) return null;
  return { host, projectPath };
}

/** Read a repo's `origin` remote URL via execFile (never a shell). Null on any error. */
export function readOriginRemote(repoPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', repoPath, 'remote', 'get-url', 'origin'],
      { timeout: GIT_TIMEOUT_MS, windowsHide: true },
      (err, stdout) => {
        if (err) {
          logger.info(`[Backlog/gitlab] no origin remote for ${repoPath}: ${err.message}`);
          resolve(null);
          return;
        }
        const url = stdout.trim();
        resolve(url.length > 0 ? url : null);
      },
    );
  });
}

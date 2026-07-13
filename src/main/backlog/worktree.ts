import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../common/logger';

// Git worktree lifecycle for Phase 2 execution cards (see backlog.md → Phase 2).
//
// Design contract: worktrees are DETACHED at the project's claim-time HEAD and
// stay dirty — the executor never commits, so the working tree itself is the
// deliverable. Worktrees live under userData/backlog-worktrees/<cardId>, are
// preserved on Done (untracked binaries aren't fully carried by the patch),
// and are removed only by an explicit user action on the card.
//
// All git invocations go through execFile (argv array, never a shell string) —
// paths are safe as argv entries, and there is no cmd.exe quoting surface.

const GIT_TIMEOUT_MS = 60_000;
// git diff of a runaway worktree could be huge; cap what we buffer/persist.
const DIFF_MAX_BYTES = 10 * 1024 * 1024;

export type WorktreeResult =
  | { ok: true; worktreePath: string; baseSha: string; reused: boolean }
  | { ok: false; reason: string };

export interface CapturedDiff {
  /** `git diff --cached --binary` after staging everything (apply-able patch). */
  patch: string;
  /** `git status --porcelain` — includes what the patch can't fully carry. */
  statusSummary: string;
  /** True when the patch hit DIFF_MAX_BYTES and was cut — worktree is source of truth. */
  truncated: boolean;
}

function runGit(cwd: string, args: string[]): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: DIFF_MAX_BYTES + 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || err.message || '').trim().split(/\r?\n/)[0]?.slice(0, 300) ?? 'unknown git error';
          resolve({ ok: false, reason: `git ${args[0]} failed: ${detail}` });
        } else {
          resolve({ ok: true, stdout });
        }
      },
    );
  });
}

/**
 * Create (or reuse) the detached worktree for a card. Reuse happens on
 * resume: the card already has a live worktree with partial uncommitted work.
 * A stale git registration for the same path (dir deleted manually) is pruned
 * before adding.
 */
export async function createWorktree(
  repoPath: string,
  worktreesDir: string,
  cardId: string,
): Promise<WorktreeResult> {
  const repoCheck = await runGit(repoPath, ['rev-parse', '--git-dir']);
  if (!repoCheck.ok) return { ok: false, reason: 'project folder is not a git repository' };

  const worktreePath = path.join(worktreesDir, cardId);

  if (fs.existsSync(path.join(worktreePath, '.git'))) {
    // Existing worktree from a paused run — resume in place.
    const sha = await runGit(worktreePath, ['rev-parse', 'HEAD']);
    if (sha.ok) {
      return { ok: true, worktreePath, baseSha: sha.stdout.trim(), reused: true };
    }
    return { ok: false, reason: `existing worktree is unusable (${sha.reason}) — remove it from the card and retry` };
  }

  const head = await runGit(repoPath, ['rev-parse', 'HEAD']);
  if (!head.ok) return { ok: false, reason: 'project repository has no commits yet' };

  try {
    fs.mkdirSync(worktreesDir, { recursive: true });
  } catch (e: any) {
    return { ok: false, reason: `cannot create worktrees dir: ${e?.message ?? e}` };
  }

  // A manually-deleted worktree dir leaves a stale registration that blocks
  // `worktree add` at the same path.
  await runGit(repoPath, ['worktree', 'prune']);

  const add = await runGit(repoPath, ['worktree', 'add', '--detach', worktreePath, 'HEAD']);
  if (!add.ok) return { ok: false, reason: add.reason };

  logger.info(`[Backlog/worktree] created ${worktreePath} at ${head.stdout.trim().slice(0, 12)}`);
  return { ok: true, worktreePath, baseSha: head.stdout.trim(), reused: false };
}

/**
 * Capture the worktree's uncommitted changes as one apply-able patch.
 * Stage-then-diff: plain `git diff` misses untracked (new) files, so stage
 * everything first — the index is worktree-local, still zero commits.
 */
export async function captureDiff(worktreePath: string): Promise<
  { ok: true; diff: CapturedDiff } | { ok: false; reason: string }
> {
  const add = await runGit(worktreePath, ['add', '-A']);
  if (!add.ok) return { ok: false, reason: add.reason };

  const status = await runGit(worktreePath, ['status', '--porcelain']);
  if (!status.ok) return { ok: false, reason: status.reason };

  const diff = await runGit(worktreePath, ['diff', '--cached', '--binary']);
  if (!diff.ok) return { ok: false, reason: diff.reason };

  let patch = diff.stdout;
  let truncated = false;
  if (Buffer.byteLength(patch, 'utf8') > DIFF_MAX_BYTES) {
    patch = patch.slice(0, DIFF_MAX_BYTES);
    truncated = true;
  }
  return { ok: true, diff: { patch, statusSummary: status.stdout.trimEnd(), truncated } };
}

/**
 * Remove a card's worktree (explicit user action — it's dirty, so --force).
 * Tolerates a dir the user already deleted by hand: prune the registration
 * and clean up whatever is left on disk.
 */
export async function removeWorktree(repoPath: string, worktreePath: string): Promise<{ ok: boolean; reason?: string }> {
  const removed = await runGit(repoPath, ['worktree', 'remove', '--force', worktreePath]);
  if (!removed.ok) {
    await runGit(repoPath, ['worktree', 'prune']);
    if (fs.existsSync(worktreePath)) {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch (e: any) {
        return { ok: false, reason: `git refused (${removed.reason}) and the folder could not be deleted: ${e?.message ?? e}` };
      }
    }
  }
  logger.info(`[Backlog/worktree] removed ${worktreePath}`);
  return { ok: true };
}

/**
 * Startup reconciliation: delete worktree dirs no card references anymore
 * (crash between create and card update, or cards deleted while the app was
 * closed), then prune stale registrations in every registered project. Never
 * touches dirs outside `worktreesDir`.
 */
export async function reconcileWorktrees(
  worktreesDir: string,
  referencedPaths: Set<string>,
  projectPaths: string[],
): Promise<void> {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(worktreesDir);
  } catch {
    return; // dir doesn't exist yet — nothing to reconcile
  }
  for (const entry of entries) {
    const full = path.join(worktreesDir, entry);
    if (referencedPaths.has(full)) continue;
    try {
      fs.rmSync(full, { recursive: true, force: true });
      logger.info(`[Backlog/worktree] removed orphaned worktree ${full}`);
    } catch (e: any) {
      logger.warn(`[Backlog/worktree] failed to remove orphan ${full}: ${e?.message ?? e}`);
    }
  }
  for (const repo of projectPaths) {
    await runGit(repo, ['worktree', 'prune']);
  }
}

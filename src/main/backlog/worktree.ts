import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
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

type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; reason: string; stderr: string; stdout: string; code: number | null };

function runGit(cwd: string, args: string[]): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: DIFF_MAX_BYTES + 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || err.message || '').trim().split(/\r?\n/)[0]?.slice(0, 300) ?? 'unknown git error';
          resolve({
            ok: false,
            reason: `git ${args[0]} failed: ${detail}`,
            stderr: stderr ?? '',
            stdout: stdout ?? '',
            code: typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : null,
          });
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

export type ApplyResult =
  | { ok: true; empty?: boolean; alreadyApplied?: boolean; threeWay?: boolean; stashed?: boolean; stashConflicted?: boolean; statusSummary?: string; changedFiles?: string[] }
  | { ok: false; reason: string; conflicted?: boolean; dirtyTarget?: boolean };

/** Post-image (`b/…`) paths a patch touches — for diagnostics and UI. */
function changedPathsFromPatch(patch: string): string[] {
  const paths: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const m = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (m) paths.push(m[1]);
  }
  return paths;
}

/** Paths the patch creates as brand-new files (`new file mode` headers). */
function createdPathsFromPatch(patch: string): string[] {
  const created: string[] = [];
  let current: string | null = null;
  for (const line of patch.split(/\r?\n/)) {
    const h = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (h) {
      current = h[1];
      continue;
    }
    if (current && /^new file mode /.test(line)) {
      created.push(current);
      current = null;
    }
  }
  return created;
}

/**
 * Pull the actionable line(s) out of git stderr, skipping informational noise
 * like "Falling back to three-way merge..." that git prints *before* the real
 * error. Keeps our `runGit` first-line-only `reason` from masking the cause.
 */
function meaningfulGitError(output: string, fallback: string): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const errs = lines.filter((l) => /^(error|fatal):/i.test(l));
  if (errs.length) return errs.join('; ').slice(0, 400);
  const meaningful = lines.filter((l) => !/^(falling back to three-way merge|applied patch)/i.test(l));
  const chosen = meaningful.length ? meaningful : lines;
  return chosen.length ? chosen.join('; ').slice(0, 400) : fallback;
}

/**
 * Write the worktree patch to a temp file and `git apply` it into the project.
 * Prefers a clean apply; on context mismatch falls back to `git apply --3way`
 * (resolves against blob SHAs in the shared object store). Leaves the result
 * unstaged. Distinguishes, and logs the full git output for, four outcomes:
 * clean apply, already-present (reverse-applies), overlapping dirty target
 * (git bails touching nothing), real merge conflict (markers written), and a
 * hard failure that changed nothing.
 */
async function applyPatchToRepo(repoPath: string, patch: string, statusSummary: string): Promise<ApplyResult> {
  // Binary hunks and exact line endings survive a file more reliably than the
  // execFile stdin surface; the path is passed as an argv entry, never a shell
  // string.
  const patchFile = path.join(os.tmpdir(), `agent-pulse-apply-${Date.now()}.patch`);
  const changedFiles = changedPathsFromPatch(patch);
  logger.info(`[Backlog/worktree] applying patch → ${repoPath} (${Buffer.byteLength(patch, 'utf8')} bytes)`);
  logger.info(
    `[Backlog/worktree] patch touches ${changedFiles.length} file(s): ` +
      `${changedFiles.slice(0, 30).join(', ')}${changedFiles.length > 30 ? ' …' : ''}`,
  );
  try {
    fs.writeFileSync(patchFile, patch, 'utf8');

    // Preferred path: the patch applies cleanly onto the current tree.
    const check = await runGit(repoPath, ['apply', '--check', patchFile]);
    if (check.ok) {
      const applied = await runGit(repoPath, ['apply', patchFile]);
      if (applied.ok) {
        logger.info(`[Backlog/worktree] applied cleanly → ${repoPath}`);
        return { ok: true, statusSummary, changedFiles };
      }
      logger.warn(`[Backlog/worktree] clean apply failed (code ${applied.code}) → ${repoPath}\n${applied.stderr.trim()}`);
      return { ok: false, reason: `Nothing was applied. ${meaningfulGitError(applied.stderr, applied.reason)}` };
    }
    logger.info(
      `[Backlog/worktree] --check did not pass (${check.stderr.trim().split(/\r?\n/)[0] ?? check.reason}); probing further`,
    );

    // Is the patch already present? A reverse-apply that checks clean means
    // every hunk's post-image is already in the tree — a forward apply would be
    // a no-op that git reports as "does not apply". This is the usual cause of
    // "apply did nothing and Git Desktop shows no changes".
    const reverse = await runGit(repoPath, ['apply', '--reverse', '--check', patchFile]);
    if (reverse.ok) {
      // Defense-in-depth: a clean reverse-apply means every post-image is
      // already in the tree, so any file the patch *creates* must exist on
      // disk. If one is missing the reverse-check is lying to us (or the live
      // capture drifted from the card's stored diff) — log it loudly and fall
      // through to a real apply attempt rather than reporting a false success.
      const created = createdPathsFromPatch(patch);
      const missing = created.filter((rel) => !fs.existsSync(path.join(repoPath, rel)));
      if (missing.length === 0) {
        logger.info(
          `[Backlog/worktree] patch reverse-applies cleanly — already present in ${repoPath} ` +
            `(${changedFiles.length} file(s): ${changedFiles.slice(0, 30).join(', ')})`,
        );
        return { ok: true, alreadyApplied: true, statusSummary, changedFiles };
      }
      logger.warn(
        `[Backlog/worktree] reverse-check passed but ${missing.length} created file(s) are absent in ${repoPath}: ` +
          `${missing.join(', ')} — NOT reporting already-applied; attempting a real apply`,
      );
    }

    // Context didn't match (project moved / local edits) — best-effort 3-way.
    const threeWay = await runGit(repoPath, ['apply', '--3way', patchFile]);
    if (threeWay.ok) {
      logger.info(`[Backlog/worktree] applied (3-way) → ${repoPath}`);
      return { ok: true, threeWay: true, statusSummary, changedFiles };
    }

    // --3way exited non-zero. Log the FULL output — git prints "Falling back to
    // three-way merge..." as its first stderr line, so runGit's first-line
    // `reason` alone hides the real cause.
    logger.warn(`[Backlog/worktree] git apply --3way failed (code ${threeWay.code}) → ${repoPath}`);
    logger.warn(`[Backlog/worktree] --3way stderr:\n${threeWay.stderr.trim()}`);
    if (threeWay.stdout.trim()) logger.debug(`[Backlog/worktree] --3way stdout:\n${threeWay.stdout.trim()}`);
    const combined = `${threeWay.stderr}\n${threeWay.stdout}`;

    // `git apply --3way` first verifies every target file matches its staged
    // version (so a merge can't silently clobber unstaged work). When the
    // project's own working tree is dirty on an overlapping file it bails here
    // WITHOUT touching anything.
    if (/does not match index|does not exist in index|already exists in working directory/i.test(combined)) {
      const file = combined.match(/error:\s*(.+?):\s*(?:does not|already)/i)?.[1];
      const which = file ? `‘${file}’ has` : 'some files have';
      return {
        ok: false,
        dirtyTarget: true,
        reason: `Nothing was applied. The project’s working directory has uncommitted local changes where ${which} to be patched. Commit or stash those changes in the project, then apply again.`,
      };
    }

    // Did --3way actually write anything? A real merge conflict leaves markers
    // (unmerged paths in status); a hard failure ("lacks the necessary blob",
    // "patch does not apply") changes nothing — which is what the user sees as
    // "no changes, no conflict". Classify by the tree, not by the preamble.
    const status = await runGit(repoPath, ['status', '--porcelain']);
    const worktreeState = status.ok ? status.stdout : '';
    const hasConflicts = /with conflicts/i.test(combined) || /^(?:UU|AA|DD|AU|UA|DU|UD) /m.test(worktreeState);
    if (hasConflicts) {
      logger.warn(`[Backlog/worktree] applied with conflicts → ${repoPath}`);
      return {
        ok: false,
        conflicted: true,
        reason: 'The changes were applied but produced merge conflicts. Open the project folder to resolve the conflict markers, or discard them.',
      };
    }

    const real = meaningfulGitError(combined, threeWay.reason);
    logger.warn(`[Backlog/worktree] nothing applied → ${repoPath}: ${real}`);
    return { ok: false, reason: `Nothing was applied. Git could not apply the patch: ${real}` };
  } catch (e: any) {
    logger.error(`[Backlog/worktree] apply threw for ${repoPath}: ${e?.message ?? e}`);
    return { ok: false, reason: `failed to apply patch: ${e?.message ?? e}` };
  } finally {
    try {
      fs.rmSync(patchFile, { force: true });
    } catch {
      /* temp file cleanup is best-effort */
    }
  }
}

/**
 * Land the worktree's uncommitted changes onto the project's active working
 * tree (explicit user action from the card). We re-capture the worktree as an
 * apply-able patch and `git apply` it into the project repo, leaving the result
 * unstaged so the user reviews and commits it themselves. The worktree is left
 * intact — the user removes it separately once satisfied.
 */
export async function applyWorktree(repoPath: string, worktreePath: string): Promise<ApplyResult> {
  const repoCheck = await runGit(repoPath, ['rev-parse', '--git-dir']);
  if (!repoCheck.ok) return { ok: false, reason: 'project folder is not a git repository' };

  const captured = await captureDiff(worktreePath);
  if (!captured.ok) return { ok: false, reason: captured.reason };
  const { patch, statusSummary } = captured.diff;
  logger.info(
    `[Backlog/worktree] captured worktree ${worktreePath} — ${Buffer.byteLength(patch, 'utf8')} bytes; ` +
      `status:\n${statusSummary || '(clean — nothing staged, check .gitignore)'}`,
  );
  if (!patch.trim()) return { ok: true, empty: true };

  return applyPatchToRepo(repoPath, patch, statusSummary);
}

/**
 * Same as applyWorktree, but first `git stash`es the project's own uncommitted
 * changes so the patch lands on a clean tree, then pops the stash to re-merge
 * those changes on top. Used when a plain apply reported an overlapping dirty
 * target. Safe by design:
 *   - If the apply itself fails, the stash is popped straight back — the working
 *     tree returns to exactly how we found it.
 *   - If the pop can't cleanly re-merge (overlapping edits), git preserves the
 *     stash entry and writes conflict markers; nothing is lost.
 */
export async function applyWorktreeStashed(repoPath: string, worktreePath: string): Promise<ApplyResult> {
  const repoCheck = await runGit(repoPath, ['rev-parse', '--git-dir']);
  if (!repoCheck.ok) return { ok: false, reason: 'project folder is not a git repository' };

  const captured = await captureDiff(worktreePath);
  if (!captured.ok) return { ok: false, reason: captured.reason };
  const { patch, statusSummary } = captured.diff;
  logger.info(
    `[Backlog/worktree] (stashed) captured worktree ${worktreePath} — ${Buffer.byteLength(patch, 'utf8')} bytes; ` +
      `status:\n${statusSummary || '(clean — nothing staged, check .gitignore)'}`,
  );
  if (!patch.trim()) return { ok: true, empty: true };

  const stash = await runGit(repoPath, ['stash', 'push', '-m', `agent-pulse: apply worktree ${path.basename(worktreePath)}`]);
  if (!stash.ok) return { ok: false, reason: `could not stash local changes: ${stash.reason}` };
  const stashed = !/No local changes to save/i.test(stash.stdout);

  const applied = await applyPatchToRepo(repoPath, patch, statusSummary);

  if (!applied.ok) {
    // Roll the working tree back to how we found it before reporting failure.
    if (stashed) await runGit(repoPath, ['stash', 'pop']);
    return applied;
  }
  if (!stashed) return applied; // there was nothing to restore

  // Stage the just-applied changes before popping. `git stash pop` refuses
  // outright when an *unstaged* change would be overwritten; staging turns the
  // overlap into a proper 3-way merge (clean where possible, conflict markers
  // where not). Only the worktree patch is present now (stash cleaned the
  // tree), so this stages exactly what we applied.
  await runGit(repoPath, ['add', '-A']);
  const pop = await runGit(repoPath, ['stash', 'pop']);
  if (pop.ok) {
    logger.info(`[Backlog/worktree] applied (stash+pop) ${worktreePath} → ${repoPath}`);
    return { ok: true, threeWay: applied.threeWay, stashed: true, statusSummary };
  }
  // Pop couldn't cleanly restore — git keeps the stash entry, so the user's
  // work is recoverable (`git stash list`) and any conflicts are marked.
  logger.warn(`[Backlog/worktree] stash pop after apply needs manual resolution in ${repoPath}`);
  return { ok: true, stashed: true, stashConflicted: true, statusSummary };
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

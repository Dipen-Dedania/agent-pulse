import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWorktree, captureDiff, applyWorktree, applyWorktreeStashed, removeWorktree, reconcileWorktrees } from '../worktree';

// Real temp git repos, no mocks — the module's whole job is driving git
// correctly. Skips cleanly when git isn't on PATH (CI images without git).
function gitAvailable(): boolean {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe.skipIf(!gitAvailable())('backlog worktree module', () => {
  let root: string;        // temp sandbox
  let repo: string;        // the "project" repo
  let worktreesDir: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-worktree-'));
    repo = path.join(root, 'repo');
    worktreesDir = path.join(root, 'worktrees');
    fs.mkdirSync(repo, { recursive: true });
    git(repo, 'init');
    git(repo, 'config', 'user.email', 'test@test.local');
    git(repo, 'config', 'user.name', 'test');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'hello\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'initial');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates a detached worktree at HEAD and reports the base sha', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reused).toBe(false);
    expect(res.baseSha).toBe(git(repo, 'rev-parse', 'HEAD').trim());
    expect(fs.existsSync(path.join(res.worktreePath, 'a.txt'))).toBe(true);
    // Detached — no branch created in the project repo.
    const branches = git(repo, 'branch', '--list').trim().split(/\r?\n/).filter(Boolean);
    expect(branches.filter((b) => b.includes('backlog'))).toHaveLength(0);
  });

  it('reuses an existing worktree on resume, preserving dirty state', async () => {
    const first = await createWorktree(repo, worktreesDir, 'card-1');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    fs.writeFileSync(path.join(first.worktreePath, 'wip.txt'), 'partial work\n');

    const second = await createWorktree(repo, worktreesDir, 'card-1');
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.reused).toBe(true);
    expect(second.worktreePath).toBe(first.worktreePath);
    expect(fs.readFileSync(path.join(second.worktreePath, 'wip.txt'), 'utf8')).toBe('partial work\n');
  });

  it('rejects a non-repo project folder', async () => {
    const notRepo = path.join(root, 'plain');
    fs.mkdirSync(notRepo);
    const res = await createWorktree(notRepo, worktreesDir, 'card-1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('not a git repository');
  });

  it('captureDiff includes modified AND new untracked files in one patch', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    fs.writeFileSync(path.join(res.worktreePath, 'a.txt'), 'changed\n');
    fs.writeFileSync(path.join(res.worktreePath, 'new-file.txt'), 'brand new\n');

    const cap = await captureDiff(res.worktreePath);
    expect(cap.ok).toBe(true);
    if (!cap.ok) return;
    expect(cap.diff.patch).toContain('a.txt');
    expect(cap.diff.patch).toContain('new-file.txt'); // plain `git diff` would miss this
    expect(cap.diff.patch).toContain('brand new');
    expect(cap.diff.statusSummary).toMatch(/new-file\.txt/);
    expect(cap.diff.truncated).toBe(false);
    // Staging never creates a commit — HEAD is untouched.
    expect(git(res.worktreePath, 'rev-parse', 'HEAD').trim()).toBe(res.baseSha);
  });

  it('the captured patch applies cleanly onto the project repo', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    fs.writeFileSync(path.join(res.worktreePath, 'new-file.txt'), 'from executor\n');
    const cap = await captureDiff(res.worktreePath);
    if (!cap.ok) throw new Error(cap.reason);

    const patchFile = path.join(root, 'change.patch');
    fs.writeFileSync(patchFile, cap.diff.patch);
    git(repo, 'apply', patchFile);
    expect(fs.readFileSync(path.join(repo, 'new-file.txt'), 'utf8')).toBe('from executor\n');
  });

  it('applyWorktree lands modified + new files onto the project working tree, unstaged', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    fs.writeFileSync(path.join(res.worktreePath, 'a.txt'), 'changed\n');
    fs.writeFileSync(path.join(res.worktreePath, 'new-file.txt'), 'from executor\n');

    const applied = await applyWorktree(repo, res.worktreePath);
    expect(applied.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('changed\n');
    expect(fs.readFileSync(path.join(repo, 'new-file.txt'), 'utf8')).toBe('from executor\n');
    // Left unstaged for the user to review — the project HEAD is untouched.
    expect(git(repo, 'rev-parse', 'HEAD').trim()).toBe(res.baseSha);
    expect(git(repo, 'status', '--porcelain')).toMatch(/new-file\.txt/);
    // The worktree itself survives the apply.
    expect(fs.existsSync(res.worktreePath)).toBe(true);
  });

  it('applyWorktree reports empty when the worktree has no changes', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    const applied = await applyWorktree(repo, res.worktreePath);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.empty).toBe(true);
  });

  it('applyWorktree falls back to a 3-way merge when the project has since moved', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    // Worktree adds a brand-new file...
    fs.writeFileSync(path.join(res.worktreePath, 'feature.txt'), 'feature work\n');
    // ...while the project advances HEAD on an unrelated file.
    fs.writeFileSync(path.join(repo, 'b.txt'), 'unrelated\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'unrelated advance');

    const applied = await applyWorktree(repo, res.worktreePath);
    expect(applied.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'feature.txt'), 'utf8')).toBe('feature work\n');
  });

  it('applyWorktree refuses (touching nothing) when the target has overlapping uncommitted edits', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    // Worktree edits a.txt one way...
    fs.writeFileSync(path.join(res.worktreePath, 'a.txt'), 'worktree change\n');
    // ...while the project has its own unstaged edit to the same file.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'local uncommitted work\n');

    const applied = await applyWorktree(repo, res.worktreePath);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toMatch(/uncommitted local changes/i);
    expect(applied.conflicted).toBeUndefined();
    // The project's local edit is left exactly as it was — nothing clobbered.
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('local uncommitted work\n');
  });

  it('applyWorktree reports alreadyApplied with the file list when the changes are already present', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    fs.writeFileSync(path.join(res.worktreePath, 'a.txt'), 'changed\n');
    fs.writeFileSync(path.join(res.worktreePath, 'feature.txt'), 'feature work\n');

    // Land the changes once...
    const first = await applyWorktree(repo, res.worktreePath);
    expect(first.ok).toBe(true);
    // ...then applying the same worktree again is a no-op: every post-image is
    // already in the tree, so it reverse-applies clean.
    const second = await applyWorktree(repo, res.worktreePath);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.alreadyApplied).toBe(true);
    expect(second.changedFiles).toEqual(expect.arrayContaining(['a.txt', 'feature.txt']));
  });

  it('applyWorktree reports changedFiles on a clean apply', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    fs.writeFileSync(path.join(res.worktreePath, 'feature.txt'), 'feature work\n');

    const applied = await applyWorktree(repo, res.worktreePath);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.alreadyApplied).toBeFalsy();
    expect(applied.changedFiles).toContain('feature.txt');
  });

  it('applyWorktree rejects a non-repo project folder', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    const notRepo = path.join(root, 'plain');
    fs.mkdirSync(notRepo);
    const applied = await applyWorktree(notRepo, res.worktreePath);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toContain('not a git repository');
  });

  it('applyWorktreeStashed stashes, applies, and pops non-overlapping local changes back on top', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    fs.writeFileSync(path.join(res.worktreePath, 'feature.txt'), 'feature work\n');
    // Project has its own uncommitted edit to a different file.
    fs.writeFileSync(path.join(repo, 'a.txt'), 'locally edited\n');

    const applied = await applyWorktreeStashed(repo, res.worktreePath);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.stashed).toBe(true);
    expect(applied.stashConflicted).toBeUndefined();
    // Worktree change landed AND the local edit was restored on top.
    expect(fs.readFileSync(path.join(repo, 'feature.txt'), 'utf8')).toBe('feature work\n');
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('locally edited\n');
    // Stash was fully consumed on a clean pop.
    expect(git(repo, 'stash', 'list').trim()).toBe('');
  });

  it('applyWorktreeStashed preserves the stash and marks conflicts when edits overlap', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    // Worktree and project edit the SAME line different ways.
    fs.writeFileSync(path.join(res.worktreePath, 'a.txt'), 'worktree version\n');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'local version\n');

    const applied = await applyWorktreeStashed(repo, res.worktreePath);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.stashConflicted).toBe(true);
    // The applied worktree change is present, with conflict markers from the pop.
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toContain('<<<<<<<');
    // The user's work is not lost — the stash entry is kept for recovery.
    expect(git(repo, 'stash', 'list').trim()).not.toBe('');
  });

  it('applyWorktreeStashed with a clean project behaves like a plain apply', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    fs.writeFileSync(path.join(res.worktreePath, 'feature.txt'), 'feature work\n');

    const applied = await applyWorktreeStashed(repo, res.worktreePath);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.stashed).toBeFalsy();
    expect(fs.readFileSync(path.join(repo, 'feature.txt'), 'utf8')).toBe('feature work\n');
    expect(git(repo, 'stash', 'list').trim()).toBe('');
  });

  it('applyWorktreeStashed restores the project untouched when the apply fails', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    // Patch MODIFIES a.txt, so it depends on context/base blobs.
    fs.writeFileSync(path.join(res.worktreePath, 'a.txt'), 'worktree change\n');

    // An independent repo: it shares no history/objects with `repo`, so the
    // patch's base blob is missing and neither a clean apply nor --3way works —
    // the apply fails AFTER we've stashed the target's local edit.
    const other = path.join(root, 'other');
    fs.mkdirSync(other);
    git(other, 'init');
    git(other, 'config', 'user.email', 'test@test.local');
    git(other, 'config', 'user.name', 'test');
    fs.writeFileSync(path.join(other, 'a.txt'), 'totally different content\n');
    git(other, 'add', '-A');
    git(other, 'commit', '-m', 'other initial');
    fs.writeFileSync(path.join(other, 'a.txt'), 'other local edit\n');

    const applied = await applyWorktreeStashed(other, res.worktreePath);
    expect(applied.ok).toBe(false);
    // The stashed local edit was popped straight back — nothing left behind.
    expect(fs.readFileSync(path.join(other, 'a.txt'), 'utf8')).toBe('other local edit\n');
    expect(git(other, 'stash', 'list').trim()).toBe('');
  });

  it('removeWorktree force-removes a dirty worktree and its registration', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    fs.writeFileSync(path.join(res.worktreePath, 'dirty.txt'), 'uncommitted\n');

    const removed = await removeWorktree(repo, res.worktreePath);
    expect(removed.ok).toBe(true);
    expect(fs.existsSync(res.worktreePath)).toBe(false);
    // Registration gone → the same path can be re-added.
    const again = await createWorktree(repo, worktreesDir, 'card-1');
    expect(again.ok).toBe(true);
  });

  it('removeWorktree tolerates a dir the user already deleted by hand', async () => {
    const res = await createWorktree(repo, worktreesDir, 'card-1');
    if (!res.ok) throw new Error(res.reason);
    fs.rmSync(res.worktreePath, { recursive: true, force: true });

    const removed = await removeWorktree(repo, res.worktreePath);
    expect(removed.ok).toBe(true);
    const again = await createWorktree(repo, worktreesDir, 'card-1');
    expect(again.ok).toBe(true);
  });

  it('reconcileWorktrees deletes unreferenced dirs and keeps referenced ones', async () => {
    const kept = await createWorktree(repo, worktreesDir, 'card-kept');
    const orphan = await createWorktree(repo, worktreesDir, 'card-orphan');
    if (!kept.ok || !orphan.ok) throw new Error('setup failed');

    await reconcileWorktrees(worktreesDir, new Set([kept.worktreePath]), [repo]);

    expect(fs.existsSync(kept.worktreePath)).toBe(true);
    expect(fs.existsSync(orphan.worktreePath)).toBe(false);
    // Pruned registration → the orphan's path is re-usable.
    const reAdd = await createWorktree(repo, worktreesDir, 'card-orphan');
    expect(reAdd.ok).toBe(true);
  });
});

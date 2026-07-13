import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createWorktree, captureDiff, removeWorktree, reconcileWorktrees } from '../worktree';

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

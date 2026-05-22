import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveProject, _resetProjectResolverCache } from '../project-resolver';

describe('resolveProject', () => {
  let tmpRoot: string;
  let tmpProject: string;
  let tmpSubdir: string;

  beforeEach(() => {
    _resetProjectResolverCache();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pulse-test-'));
    tmpProject = path.join(tmpRoot, 'my-project');
    tmpSubdir = path.join(tmpProject, 'nested', 'deep');
    fs.mkdirSync(tmpSubdir, { recursive: true });
    fs.mkdirSync(path.join(tmpProject, '.git'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns null for empty cwd', () => {
    expect(resolveProject(undefined)).toBeNull();
    expect(resolveProject(null)).toBeNull();
    expect(resolveProject('')).toBeNull();
  });

  it('walks up from a nested directory to the .git root', () => {
    const resolved = resolveProject(tmpSubdir);
    expect(resolved).not.toBeNull();
    // realpathSync may resolve to a slightly different cased/canonical form on
    // some systems; compare the basename which is what users see.
    expect(resolved!.displayName).toBe('my-project');
    expect(resolved!.projectId).toMatch(/^[a-f0-9]{8}$/);
  });

  it('produces a stable id for the same project across calls', () => {
    const a = resolveProject(tmpSubdir);
    const b = resolveProject(tmpProject);
    expect(a!.projectId).toBe(b!.projectId);
  });

  it('falls back to cwd when no .git root is found', () => {
    const orphan = fs.mkdtempSync(path.join(os.tmpdir(), 'orphan-'));
    try {
      const resolved = resolveProject(orphan);
      expect(resolved).not.toBeNull();
      expect(resolved!.projectId).toMatch(/^[a-f0-9]{8}$/);
    } finally {
      fs.rmSync(orphan, { recursive: true, force: true });
    }
  });
});

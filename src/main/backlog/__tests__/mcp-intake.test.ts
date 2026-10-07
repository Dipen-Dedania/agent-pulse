import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { openBacklogDb, Database } from '../db';
import { BacklogStore } from '../store';
import {
  chatFingerprint,
  findGitRoot,
  intakeCard,
  normalizeCardRequest,
  resolveProject,
  MAX_TITLE_CHARS,
} from '../mcp-intake';

describe('normalizeCardRequest', () => {
  const base = { title: 'Debounce the drag handler', projectPath: 'E:/repos/demo' };

  it('rejects a missing title and a missing project path', () => {
    expect(normalizeCardRequest({ ...base, title: '   ' })).toMatchObject({ ok: false });
    expect(normalizeCardRequest({ title: 'x' })).toMatchObject({ ok: false, reason: expect.stringContaining('projectPath') });
  });

  it('rejects a title long enough to be a description in disguise', () => {
    const res = normalizeCardRequest({ ...base, title: 'x'.repeat(MAX_TITLE_CHARS + 1) });
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining('too long') });
  });

  it('collapses whitespace in the title and defaults to a green execution card in To-Do', () => {
    const res = normalizeCardRequest({ ...base, title: '  Fix   the\tbubble ' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.title).toBe('Fix the bubble');
    expect(res.value).toMatchObject({ taskType: 'execution', agent: 'claude', riskTier: 'green', state: 'todo', estimatedMinutes: null });
  });

  it('keeps valid enums and drops invalid ones back to the default', () => {
    const good = normalizeCardRequest({ ...base, taskType: 'research', riskTier: 'amber', state: 'refinement' });
    expect(good.ok && good.value).toMatchObject({ taskType: 'research', riskTier: 'amber', state: 'refinement' });
    const bad = normalizeCardRequest({ ...base, taskType: 'deploy', riskTier: 'chartreuse', state: 'done', agent: 'gemini' });
    expect(bad.ok && bad.value).toMatchObject({ taskType: 'execution', agent: 'claude', riskTier: 'green', state: 'todo' });
    const codex = normalizeCardRequest({ ...base, agent: 'codex' });
    expect(codex.ok && codex.value).toMatchObject({ agent: 'codex' });
  });

  it('cleans acceptance criteria and rounds estimates up to at least a minute', () => {
    const res = normalizeCardRequest({
      ...base,
      acceptanceCriteria: ['  drag is smooth  ', '', 42, '   ', 'no jitter'],
      estimatedMinutes: 12.4,
    });
    expect(res.ok && res.value.acceptanceCriteria).toEqual(['drag is smooth', 'no jitter']);
    expect(res.ok && res.value.estimatedMinutes).toBe(12);
    const tiny = normalizeCardRequest({ ...base, estimatedMinutes: 0.2 });
    expect(tiny.ok && tiny.value.estimatedMinutes).toBe(1);
  });
});

describe('findGitRoot', () => {
  const sep = path.sep;

  it('walks up to the nearest .git and stops at the filesystem root', () => {
    const root = path.resolve('E:/repos/demo');
    const exists = (p: string) => p === path.join(root, '.git');
    expect(findGitRoot(path.join(root, 'src', 'main'), exists)).toBe(root);
    expect(findGitRoot(root, exists)).toBe(root);
    expect(findGitRoot(path.resolve(`${sep}elsewhere`), exists)).toBeNull();
  });
});

describe('chatFingerprint', () => {
  it('is stable across casing and spacing but differs per project', () => {
    expect(chatFingerprint('p1', 'Fix the  bubble')).toBe(chatFingerprint('p1', 'fix THE bubble'));
    expect(chatFingerprint('p1', 'Fix the bubble')).not.toBe(chatFingerprint('p2', 'Fix the bubble'));
    expect(chatFingerprint('p1', 'Fix the bubble')).toMatch(/^chat:[0-9a-f]{40}$/);
  });
});

// The store half needs better-sqlite3, which is built against Electron's ABI
// and may not load under plain Node — same skip pattern as store.test.ts.
const probe = openBacklogDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

describe.skipIf(!dbAvailable)('resolveProject', () => {
  let db: Database;
  let store: BacklogStore;

  beforeEach(() => {
    db = openBacklogDb(':memory:')!;
    store = new BacklogStore(db);
  });

  it('matches an exactly registered path without touching the filesystem', () => {
    const project = store.addProject(path.resolve('E:/repos/demo'));
    const res = resolveProject(store, path.resolve('E:/repos/demo'), () => null);
    expect(res).toMatchObject({ ok: true, projectId: project.id, registered: false });
  });

  it('maps a chat in a subfolder onto the registered repo root', () => {
    const project = store.addProject(path.resolve('E:/repos/demo'));
    const res = resolveProject(store, path.resolve('E:/repos/demo/src/main'), () => path.resolve('E:/repos/demo'));
    expect(res).toMatchObject({ ok: true, projectId: project.id, registered: false });
  });

  it('falls back to the nearest registered ancestor when no git root is found', () => {
    store.addProject(path.resolve('E:/repos'));
    const inner = store.addProject(path.resolve('E:/repos/demo'));
    const res = resolveProject(store, path.resolve('E:/repos/demo/packages/web'), () => null);
    expect(res).toMatchObject({ ok: true, projectId: inner.id });
  });

  it('auto-registers the git root for an unknown repo', () => {
    const root = path.resolve('E:/repos/fresh');
    const res = resolveProject(store, path.join(root, 'src'), () => root);
    expect(res).toMatchObject({ ok: true, registered: true, projectName: 'fresh' });
    expect(store.listProjects().map((p) => p.path)).toEqual([root]);
  });

  it('refuses a folder that is not inside a git repository', () => {
    const res = resolveProject(store, path.resolve('E:/Downloads'), () => null);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('not inside a git repository');
  });
});

describe.skipIf(!dbAvailable)('intakeCard', () => {
  let db: Database;
  let store: BacklogStore;
  let projectPath: string;

  beforeEach(() => {
    db = openBacklogDb(':memory:')!;
    store = new BacklogStore(db);
    projectPath = path.resolve('E:/repos/demo');
    store.addProject(projectPath);
  });

  it('creates a To-Do card carrying the chat fingerprint', () => {
    const res = intakeCard(store, {
      title: 'Debounce the drag handler',
      description: 'It fires on every mousemove — see Bubble.tsx.',
      projectPath,
      acceptanceCriteria: ['no jitter while dragging'],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.duplicate).toBe(false);
    expect(res.card).toMatchObject({
      title: 'Debounce the drag handler',
      state: 'todo',
      taskType: 'execution',
      riskTier: 'green',
      acceptanceCriteria: ['no jitter while dragging'],
    });
    expect(res.card.sourceFingerprint).toMatch(/^chat:/);
  });

  it('returns the existing card instead of a duplicate when asked twice', () => {
    const first = intakeCard(store, { title: 'Debounce the drag handler', projectPath });
    const second = intakeCard(store, { title: 'debounce the   DRAG handler', projectPath });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.duplicate).toBe(true);
    expect(second.card.id).toBe(first.card.id);
    expect(store.listCards()).toHaveLength(1);
  });

  it('surfaces validation failures as a reason rather than throwing', () => {
    expect(intakeCard(store, { title: '', projectPath })).toMatchObject({ ok: false, reason: 'title is required' });
  });
});

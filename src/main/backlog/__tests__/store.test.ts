import { describe, it, expect, beforeEach } from 'vitest';
import { openBacklogDb, Database } from '../db';
import { BacklogStore } from '../store';
import { ATTACHMENT_MAX_COUNT, ATTACHMENT_MAX_FILE_BYTES } from '../../../common/backlog-types';

// better-sqlite3 is rebuilt against Electron's ABI (`npm run rebuild:native`),
// so it may not load under vitest's plain Node — same coverage nuance as the
// timeline. Skip the suite cleanly instead of failing.
const probe = openBacklogDb(':memory:');
const dbAvailable = probe !== null;
probe?.close();

describe.skipIf(!dbAvailable)('BacklogStore', () => {
  let db: Database;
  let store: BacklogStore;
  let projectId: string;

  beforeEach(() => {
    db = openBacklogDb(':memory:')!;
    store = new BacklogStore(db);
    // Forward slashes: path.basename treats them as separators on every
    // platform, while backslashes only split on Windows.
    projectId = store.addProject('E:/repos/demo').id;
  });

  it('addProject is idempotent on path and derives name from basename', () => {
    const again = store.addProject('E:/repos/demo');
    expect(again.id).toBe(projectId);
    expect(again.name).toBe('demo');
    expect(store.listProjects()).toHaveLength(1);
  });

  it('removeProject refuses while cards reference it', () => {
    store.createCard({ title: 'x', projectId });
    expect(store.removeProject(projectId).ok).toBe(false);
    store.listCards().forEach((c) => store.deleteCard(c.id));
    expect(store.removeProject(projectId).ok).toBe(true);
  });

  it('creates cards in refinement by default, todo cards get increasing sortOrder', () => {
    const a = store.createCard({ title: 'a', projectId });
    expect(a.state).toBe('refinement');
    const b = store.createCard({ title: 'b', projectId, state: 'todo' });
    const c = store.createCard({ title: 'c', projectId, state: 'todo' });
    expect(c.sortOrder).toBeGreaterThan(b.sortOrder);
  });

  it('persists a safe model, nulls unsafe ones, and clears on update', () => {
    const a = store.createCard({ title: 'a', projectId, model: 'sonnet' });
    expect(store.getCard(a.id)!.model).toBe('sonnet');
    // cmd.exe metacharacters must never reach the runner's argv
    const b = store.createCard({ title: 'b', projectId, model: 'sonnet && del *' });
    expect(store.getCard(b.id)!.model).toBeNull();
    store.updateCard(a.id, { model: 'claude-fable-5[1m]' });
    expect(store.getCard(a.id)!.model).toBe('claude-fable-5[1m]');
    store.updateCard(a.id, { model: null });
    expect(store.getCard(a.id)!.model).toBeNull();
  });

  it('claimCard is atomic: second claim on the same card fails', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    expect(store.claimCard(card.id)).toBe(true);
    expect(store.claimCard(card.id)).toBe(false);
    expect(store.getCard(card.id)!.state).toBe('claimed');
  });

  it('claimCard also claims paused and blocked cards but not done/refinement', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    store.setCardState(card.id, 'paused');
    expect(store.claimCard(card.id)).toBe(true);
    // Blocked: manual Retry/Restart claim directly (autorun never picks blocked).
    store.setCardState(card.id, 'blocked', 'run failed');
    expect(store.claimCard(card.id)).toBe(true);
    store.setCardState(card.id, 'done');
    expect(store.claimCard(card.id)).toBe(false);
    store.setCardState(card.id, 'refinement');
    expect(store.claimCard(card.id)).toBe(false);
  });

  it('moveCard rejects engine-only targets and running cards', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    expect(store.moveCard(card.id, 'in-progress').ok).toBe(false);
    expect(store.moveCard(card.id, 'claimed').ok).toBe(false);
    store.claimCard(card.id);
    expect(store.moveCard(card.id, 'done').ok).toBe(false);
  });

  it('moveCard to todo assigns a tail sortOrder and clears blockedReason', () => {
    const queued = store.createCard({ title: 'q', projectId, state: 'todo' });
    const card = store.createCard({ title: 'x', projectId });
    store.setCardState(card.id, 'blocked', 'boom');
    const res = store.moveCard(card.id, 'todo');
    expect(res.ok).toBe(true);
    expect(res.card!.blockedReason).toBeNull();
    expect(res.card!.sortOrder).toBeGreaterThan(queued.sortOrder);
  });

  it('reorderTodo rewrites sort order from the given list', () => {
    const a = store.createCard({ title: 'a', projectId, state: 'todo' });
    const b = store.createCard({ title: 'b', projectId, state: 'todo' });
    const c = store.createCard({ title: 'c', projectId, state: 'todo' });
    store.reorderTodo([c.id, a.id, b.id]);
    const order = store.listCards().filter((x) => x.state === 'todo').map((x) => x.id);
    expect(order).toEqual([c.id, a.id, b.id]);
  });

  it('crash recovery flips claimed/in-progress → paused on open', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    store.claimCard(card.id);
    store.setCardState(card.id, 'in-progress');
    // Re-running the recovery statement models a fresh open on the same file
    // (in-memory DBs vanish on close, so exercise the same UPDATE directly).
    db.prepare("UPDATE cards SET state = 'paused', updated_at = ? WHERE state IN ('claimed', 'in-progress')")
      .run(Date.now());
    expect(store.getCard(card.id)!.state).toBe('paused');
  });

  it('attempts and artifacts round-trip with outcome fields', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    const attempt = store.insertAttempt(card.id, false);
    store.finishAttempt(attempt.id, { outcome: 'success', costUsd: 0.42, numTurns: 7, sessionId: 'sess-1' });
    store.insertArtifact({ cardId: card.id, attemptId: attempt.id, path: 'C:\\x\\r.md', preview: 'hello' });

    const attempts = store.listAttempts(card.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].outcome).toBe('success');
    expect(attempts[0].costUsd).toBeCloseTo(0.42);
    expect(attempts[0].manual).toBe(false);

    const artifacts = store.listArtifacts(card.id);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].preview).toBe('hello');
    expect(store.getArtifact(artifacts[0].id)!.path).toBe('C:\\x\\r.md');
  });

  it('countConsecutiveKills counts trailing budget kills and resets on other outcomes', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    const finishAt = (outcome: 'success' | 'failed' | 'paused' | 'killed', startedAt: number) => {
      const attempt = store.insertAttempt(card.id, false);
      store.finishAttempt(attempt.id, { outcome });
      // insertAttempt stamps Date.now(); pin distinct times so DESC order is deterministic.
      db.prepare('UPDATE attempts SET started_at = ? WHERE id = ?').run([startedAt, attempt.id]);
    };

    expect(store.countConsecutiveKills(card.id)).toBe(0);

    finishAt('killed', 1_000);
    expect(store.countConsecutiveKills(card.id)).toBe(1);

    finishAt('killed', 2_000);
    expect(store.countConsecutiveKills(card.id)).toBe(2);

    // A user stop / window-end pause breaks the streak…
    finishAt('paused', 3_000);
    expect(store.countConsecutiveKills(card.id)).toBe(0);

    // …and the count restarts from the newest attempt afterwards.
    finishAt('killed', 4_000);
    expect(store.countConsecutiveKills(card.id)).toBe(1);

    // A running (unfinished) attempt is ignored.
    store.insertAttempt(card.id, false);
    expect(store.countConsecutiveKills(card.id)).toBe(1);
  });

  // ── Phase 2: execution tasks ───────────────────────────────────────────────

  it('cards default to research; execution taskType persists and is patchable', () => {
    const a = store.createCard({ title: 'a', projectId });
    expect(a.taskType).toBe('research');
    const b = store.createCard({ title: 'b', projectId, taskType: 'execution' });
    expect(store.getCard(b.id)!.taskType).toBe('execution');
    store.updateCard(a.id, { taskType: 'execution' });
    expect(store.getCard(a.id)!.taskType).toBe('execution');
    // Unknown values are ignored, not stored.
    store.updateCard(a.id, { taskType: 'evil' as any });
    expect(store.getCard(a.id)!.taskType).toBe('execution');
  });

  it('accepts enabled QA providers, rejects browser and unknowns', () => {
    const a = store.createCard({ title: 'a', projectId, taskType: 'execution', qaProvider: 'tests' });
    expect(a.qaProvider).toBe('tests');
    const b = store.createCard({ title: 'b', projectId, qaProvider: 'browser' as any });
    expect(b.qaProvider).toBe('none');
    store.updateCard(a.id, { qaProvider: 'browser' });
    expect(store.getCard(a.id)!.qaProvider).toBe('tests'); // rejected, unchanged
    store.updateCard(a.id, { qaProvider: 'custom' });
    expect(store.getCard(a.id)!.qaProvider).toBe('custom');
  });

  it('normalizes qaCommand and acceptance criteria', () => {
    const a = store.createCard({
      title: 'a', projectId,
      qaCommand: '  npm run e2e  ',
      acceptanceCriteria: [' keeps API stable ', '', 42 as any, 'tests pass'],
    });
    expect(a.qaCommand).toBe('npm run e2e');
    expect(a.acceptanceCriteria).toEqual(['keeps API stable', 'tests pass']);
    store.updateCard(a.id, { qaCommand: '   ' });
    expect(store.getCard(a.id)!.qaCommand).toBeNull();
  });

  it('claimCard also claims rework cards', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    store.setCardState(card.id, 'rework');
    expect(store.claimCard(card.id)).toBe(true);
    expect(store.getCard(card.id)!.state).toBe('claimed');
  });

  it('moveCard allows rework → todo for a manual requeue', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    store.setCardState(card.id, 'rework');
    const res = store.moveCard(card.id, 'todo');
    expect(res.ok).toBe(true);
    expect(res.card!.state).toBe('todo');
  });

  it('setWorktree / clearWorktree round-trip', () => {
    const card = store.createCard({ title: 'x', projectId, taskType: 'execution' });
    store.setWorktree(card.id, 'E:/wt/abc', 'deadbeef123');
    let got = store.getCard(card.id)!;
    expect(got.worktreePath).toBe('E:/wt/abc');
    expect(got.baseSha).toBe('deadbeef123');
    store.clearWorktree(card.id);
    got = store.getCard(card.id)!;
    expect(got.worktreePath).toBeNull();
    expect(got.baseSha).toBeNull();
  });

  it('artifacts persist their kind (report default, diff, qa-report)', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    const attempt = store.insertAttempt(card.id, false);
    store.insertArtifact({ cardId: card.id, attemptId: attempt.id, path: 'a.md', preview: '' });
    store.insertArtifact({ cardId: card.id, attemptId: attempt.id, path: 'a.patch', preview: '', kind: 'diff' });
    store.insertArtifact({ cardId: card.id, attemptId: attempt.id, path: 'a.qa.txt', preview: '', kind: 'qa-report' });
    const kinds = store.listArtifacts(card.id).map((a) => a.kind).sort();
    expect(kinds).toEqual(['diff', 'qa-report', 'report']);
  });

  it('countConsecutiveQaFails counts trailing qa-failed and resets on success', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    const finishAt = (outcome: 'success' | 'qa-failed' | 'paused', startedAt: number) => {
      const attempt = store.insertAttempt(card.id, false);
      store.finishAttempt(attempt.id, { outcome });
      db.prepare('UPDATE attempts SET started_at = ? WHERE id = ?').run([startedAt, attempt.id]);
    };
    expect(store.countConsecutiveQaFails(card.id)).toBe(0);
    finishAt('qa-failed', 1_000);
    expect(store.countConsecutiveQaFails(card.id)).toBe(1);
    // A qa-failed streak never counts as budget kills and vice versa.
    expect(store.countConsecutiveKills(card.id)).toBe(0);
    finishAt('success', 2_000);
    expect(store.countConsecutiveQaFails(card.id)).toBe(0);
  });
});

describe.skipIf(!dbAvailable)('BacklogStore attachments', () => {
  let db: Database;
  let store: BacklogStore;
  let cardId: string;

  beforeEach(() => {
    db = openBacklogDb(':memory:')!;
    store = new BacklogStore(db);
    const projectId = store.addProject('E:/repos/demo').id;
    cardId = store.createCard({ title: 'card', projectId }).id;
  });

  it('adds, lists (metadata only), and exposes content for the prompt', () => {
    const rows = store.setCardAttachments(cardId, {
      keepIds: [],
      add: [{ filename: 'plan.md', content: '# Plan\n\ndetails', bytes: 15 }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe('plan.md');
    // Metadata list carries no content; the engine fetches content separately.
    expect((rows[0] as any).content).toBeUndefined();
    expect(store.listAttachmentContents(cardId)).toEqual([{ filename: 'plan.md', content: '# Plan\n\ndetails' }]);
    // bytes is recomputed from content, not trusted from the caller.
    expect(rows[0].bytes).toBe(Buffer.byteLength('# Plan\n\ndetails', 'utf8'));
  });

  it('replace-all: keeps listed ids, drops the rest, appends new files', () => {
    const first = store.setCardAttachments(cardId, {
      keepIds: [],
      add: [{ filename: 'a.md', content: 'a', bytes: 1 }, { filename: 'b.md', content: 'b', bytes: 1 }],
    });
    const keepId = first.find((a) => a.filename === 'a.md')!.id;
    const after = store.setCardAttachments(cardId, {
      keepIds: [keepId],
      add: [{ filename: 'c.md', content: 'c', bytes: 1 }],
    });
    expect(after.map((a) => a.filename).sort()).toEqual(['a.md', 'c.md']);
  });

  it('drops files over the per-file byte cap', () => {
    const big = 'x'.repeat(ATTACHMENT_MAX_FILE_BYTES + 1);
    const rows = store.setCardAttachments(cardId, { keepIds: [], add: [{ filename: 'big.txt', content: big, bytes: big.length }] });
    expect(rows).toHaveLength(0);
  });

  it('stops adding once the count cap is reached', () => {
    const add = Array.from({ length: ATTACHMENT_MAX_COUNT + 3 }, (_, i) => ({ filename: `f${i}.md`, content: 'x', bytes: 1 }));
    const rows = store.setCardAttachments(cardId, { keepIds: [], add });
    expect(rows).toHaveLength(ATTACHMENT_MAX_COUNT);
  });

  it('cascades on card delete', () => {
    store.setCardAttachments(cardId, { keepIds: [], add: [{ filename: 'a.md', content: 'a', bytes: 1 }] });
    store.deleteCard(cardId);
    expect(store.listAttachments(cardId)).toEqual([]);
  });
});

describe.skipIf(!dbAvailable)('backlog schema migration v2 → v4', () => {
  it('adds the Phase 2 columns and the attachments table to an existing v2 board', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const Database = require('better-sqlite3');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mig-'));
    const dbPath = path.join(dir, 'board.db');
    try {
      // Build a minimal v2 board (pre-Phase-2 cards table, version pinned to 2).
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
        CREATE TABLE cards (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          project_id TEXT NOT NULL REFERENCES projects(id), state TEXT NOT NULL DEFAULT 'refinement',
          risk_tier TEXT NOT NULL DEFAULT 'green', estimated_minutes INTEGER, estimated_cost_usd REAL,
          prereq_ids TEXT NOT NULL DEFAULT '[]', qa_provider TEXT NOT NULL DEFAULT 'none',
          acceptance_criteria TEXT NOT NULL DEFAULT '[]', sort_order INTEGER NOT NULL DEFAULT 0,
          blocked_reason TEXT, model TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE attempts (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, started_at INTEGER NOT NULL,
          ended_at INTEGER, outcome TEXT, reason TEXT, cost_usd REAL, num_turns INTEGER, session_id TEXT,
          manual INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE artifacts (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'report', path TEXT NOT NULL, preview TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL);
        INSERT INTO schema_version (version) VALUES (2);
        INSERT INTO projects (id, name, path, created_at) VALUES ('p1', 'demo', 'E:/repos/demo', 1);
        INSERT INTO cards (id, title, project_id, state, created_at, updated_at)
          VALUES ('c1', 'legacy card', 'p1', 'todo', 1, 1);
      `);
      legacy.close();

      const migrated = openBacklogDb(dbPath)!;
      expect(migrated).not.toBeNull();
      const store = new BacklogStore(migrated);
      const card = store.getCard('c1')!;
      expect(card.taskType).toBe('research');   // v3 default
      expect(card.worktreePath).toBeNull();
      expect(card.baseSha).toBeNull();
      expect(card.qaCommand).toBeNull();
      const version = migrated.prepare('SELECT version FROM schema_version').get() as { version: number };
      expect(version.version).toBe(4);
      // v4: the attachments table exists and is usable on a migrated board.
      expect(store.listAttachments('c1')).toEqual([]);
      store.setCardAttachments('c1', { keepIds: [], add: [{ filename: 'note.md', content: 'hi', bytes: 2 }] });
      expect(store.listAttachments('c1')).toHaveLength(1);
      migrated.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(dbAvailable)('BacklogStore (native module unavailable)', () => {
  it('openBacklogDb returns null instead of throwing', () => {
    expect(openBacklogDb(':memory:')).toBeNull();
  });
});

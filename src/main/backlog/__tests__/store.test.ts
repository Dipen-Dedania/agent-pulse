import { describe, it, expect, beforeEach } from 'vitest';
import { openBacklogDb, Database } from '../db';
import { BacklogStore } from '../store';

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

  it('claimCard also claims paused cards but not done/blocked/refinement', () => {
    const card = store.createCard({ title: 'x', projectId, state: 'todo' });
    store.setCardState(card.id, 'paused');
    expect(store.claimCard(card.id)).toBe(true);
    store.setCardState(card.id, 'done');
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

});

describe.skipIf(dbAvailable)('BacklogStore (native module unavailable)', () => {
  it('openBacklogDb returns null instead of throwing', () => {
    expect(openBacklogDb(':memory:')).toBeNull();
  });
});

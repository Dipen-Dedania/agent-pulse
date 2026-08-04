import { describe, it, expect, beforeEach } from 'vitest';
import { openBacklogDb, Database, SCHEMA_VERSION } from '../db';
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

  it('records a refinement plan-mode session id without changing card state', () => {
    const card = store.createCard({ title: 'plan me', projectId });
    expect(card.refinementSessionId).toBeNull();
    expect(card.refinementStartedAt).toBeNull();

    const sessionId = '0e40aad9-6cf6-4014-8ab5-b48f79dd0b7c';
    store.setRefinementSession(card.id, sessionId);
    const after = store.getCard(card.id)!;
    expect(after.refinementSessionId).toBe(sessionId);
    expect(after.refinementStartedAt).toBeGreaterThan(0);
    // State is untouched — the card stays in Refinement until the human queues it.
    expect(after.state).toBe('refinement');
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

  // ── QA task type (browser verification cards) ─────────────────────────────

  it('qa taskType persists and round-trips like the others', () => {
    const a = store.createCard({ title: 'a', projectId, taskType: 'qa' });
    expect(store.getCard(a.id)!.taskType).toBe('qa');
    store.updateCard(a.id, { taskType: 'research' });
    expect(store.getCard(a.id)!.taskType).toBe('research');
    store.updateCard(a.id, { taskType: 'qa' });
    expect(store.getCard(a.id)!.taskType).toBe('qa');
  });

  it('normalizes qaUrl: http(s) only, trimmed, bounded', () => {
    const a = store.createCard({ title: 'a', projectId, taskType: 'qa', qaUrl: '  http://localhost:5173/settings  ' });
    expect(a.qaUrl).toBe('http://localhost:5173/settings');
    expect(store.getCard(a.id)!.qaUrl).toBe('http://localhost:5173/settings');

    // Non-http schemes and non-URLs become null instead of reaching the prompt.
    const b = store.createCard({ title: 'b', projectId, taskType: 'qa', qaUrl: 'file:///C:/secrets.txt' });
    expect(b.qaUrl).toBeNull();
    const c = store.createCard({ title: 'c', projectId, taskType: 'qa', qaUrl: 'localhost:5173' });
    expect(c.qaUrl).toBeNull();

    store.updateCard(a.id, { qaUrl: 'https://staging.example.com' });
    expect(store.getCard(a.id)!.qaUrl).toBe('https://staging.example.com');
    store.updateCard(a.id, { qaUrl: '   ' });
    expect(store.getCard(a.id)!.qaUrl).toBeNull();
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

  // ── Phase 3: issue population (source-neutral) ────────────────────────────

  it('a new project starts unlinked (no source) with the default issue filter', () => {
    const p = store.listProjects().find((x) => x.id === projectId)!;
    expect(p.source).toBeNull();
    expect(p.sourceLastScanAt).toBeNull();
    expect(p.issueFilter).toEqual({ mode: 'assigned', labels: [] });
  });

  it('createCard carries source provenance and defaults it to null', () => {
    const plain = store.createCard({ title: 'hand-authored', projectId });
    expect(plain.sourceUrl).toBeNull();
    expect(plain.sourceFingerprint).toBeNull();

    const fromIssue = store.createCard({
      title: 'from gitlab',
      projectId,
      sourceUrl: 'https://gitlab.com/grp/proj/-/issues/42',
      sourceFingerprint: 'gitlab:1234:42',
    });
    const got = store.getCard(fromIssue.id)!;
    expect(got.sourceUrl).toBe('https://gitlab.com/grp/proj/-/issues/42');
    expect(got.sourceFingerprint).toBe('gitlab:1234:42');
  });

  it('setSourceLink (gitlab + linear + jira) / setIssueFilter round-trip; clearSourceLink resets', () => {
    store.setSourceLink(projectId, { kind: 'gitlab', ref: '555', host: 'gitlab.com', slug: 'grp/proj', name: 'grp/proj' });
    store.setIssueFilter(projectId, { mode: 'label', labels: ['bug', 'p1'] });
    let p = store.listProjects().find((x) => x.id === projectId)!;
    expect(p.source).toEqual({ kind: 'gitlab', ref: '555', host: 'gitlab.com', slug: 'grp/proj', name: 'grp/proj' });
    expect(p.issueFilter).toEqual({ mode: 'label', labels: ['bug', 'p1'] });

    // Re-linking to Linear (one source per project) overwrites the GitLab link.
    store.setSourceLink(projectId, { kind: 'linear', ref: 'team-uuid', host: null, slug: 'DEV', name: 'Development' });
    p = store.listProjects().find((x) => x.id === projectId)!;
    expect(p.source).toEqual({ kind: 'linear', ref: 'team-uuid', host: null, slug: 'DEV', name: 'Development' });

    // Re-linking to JIRA must survive the rowToSource read path (regression: the
    // read allowlist once dropped any kind that wasn't gitlab/linear → null).
    store.setSourceLink(projectId, {
      kind: 'jira', ref: 'cloud-uuid', host: 'https://acme.atlassian.net',
      slug: 'DSOC', name: 'Data - Sales Ops & Category', scopeRef: 'DSOC', scopeName: 'Data - Sales Ops & Category',
    });
    p = store.listProjects().find((x) => x.id === projectId)!;
    expect(p.source).toEqual({
      kind: 'jira', ref: 'cloud-uuid', host: 'https://acme.atlassian.net',
      slug: 'DSOC', name: 'Data - Sales Ops & Category', scopeRef: 'DSOC', scopeName: 'Data - Sales Ops & Category',
    });

    store.clearSourceLink(projectId);
    p = store.listProjects().find((x) => x.id === projectId)!;
    expect(p.source).toBeNull();
  });

  it('candidate upsert / list / delete / prune (source-neutral ref)', () => {
    const mk = (n: number) => ({
      fingerprint: `gitlab:1:${n}`, projectId, sourceKind: 'gitlab' as const, ref: String(n), title: `t${n}`,
      description: '', webUrl: `u${n}`, labels: ['x'], fetchedAt: n,
    });
    store.upsertCandidates([mk(1), mk(2), mk(3)]);
    expect(store.listCandidates(projectId)).toHaveLength(3);
    // Upsert updates in place (no duplicate) and refreshes fields.
    store.upsertCandidates([{ ...mk(1), title: 'renamed' }]);
    const list = store.listCandidates(projectId);
    expect(list).toHaveLength(3);
    expect(list.find((c) => c.ref === '1')!.title).toBe('renamed');
    // Prune keeps only the fingerprints the latest scan returned.
    store.pruneCandidatesNotIn(projectId, ['gitlab:1:2']);
    expect(store.listCandidates(projectId).map((c) => c.ref)).toEqual(['2']);
    store.deleteCandidates(['gitlab:1:2']);
    expect(store.listCandidates(projectId)).toHaveLength(0);
  });

  it('a linear candidate round-trips with a string ref', () => {
    store.upsertCandidates([{
      fingerprint: 'linear:team-uuid:DEV-1036', projectId, sourceKind: 'linear', ref: 'DEV-1036',
      title: 'homepage', description: 'd', webUrl: 'https://linear.app/x', labels: ['FE'], fetchedAt: 1,
    }]);
    const c = store.listCandidates(projectId)[0];
    expect(c.sourceKind).toBe('linear');
    expect(c.ref).toBe('DEV-1036');
  });

  it('dismiss tombstones a fingerprint; hasCardForFingerprint sees any state', () => {
    expect(store.isDismissed('gitlab:1:9')).toBe(false);
    store.dismiss([{ fingerprint: 'gitlab:1:9', projectId, sourceKind: 'gitlab' }]);
    expect(store.isDismissed('gitlab:1:9')).toBe(true);
    // A card carrying the fingerprint is detected regardless of its state.
    const card = store.createCard({ title: 'imported', projectId, sourceFingerprint: 'gitlab:1:10' });
    expect(store.hasCardForFingerprint('gitlab:1:10')).toBe(true);
    store.setCardState(card.id, 'done');
    expect(store.hasCardForFingerprint('gitlab:1:10')).toBe(true);
    expect(store.hasCardForFingerprint('gitlab:1:404')).toBe(false);
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

  // ── Apply tracking + Overnight Backlog stats ──────────────────────────────

  it('recordApply freezes the apply snapshot onto the card', () => {
    const card = store.createCard({ title: 'x', projectId, taskType: 'execution' });
    expect(store.getCard(card.id)!.appliedAt).toBeNull();
    store.recordApply(card.id, { method: 'three-way', autorun: true, additions: 42, deletions: 7, files: 3 });
    const got = store.getCard(card.id)!;
    expect(got.appliedAt).toBeGreaterThan(0);
    expect(got.applyMethod).toBe('three-way');
    expect(got.appliedAutorun).toBe(true);
    expect(got.appliedAdditions).toBe(42);
    expect(got.appliedDeletions).toBe(7);
    expect(got.appliedFiles).toBe(3);
  });

  it('getShippedStats aggregates ship count, rate, autonomous split, method, LOC, cost, and projects', () => {
    const now = Date.now();
    const day = 86_400_000;
    // Seed an applied execution card, then pin applied_at deterministically.
    const seed = (o: {
      method: 'clean' | 'three-way' | 'stashed' | 'already-present';
      manual?: boolean; add?: number; del?: number; files?: number;
      minutes?: number; cost?: number; appliedAt: number; projId?: string;
    }) => {
      const card = store.createCard({
        title: 'ship', projectId: o.projId ?? projectId, taskType: 'execution',
        estimatedMinutes: o.minutes ?? null,
      });
      store.setWorktree(card.id, `E:/wt/${card.id}`, 'sha');
      store.setCardState(card.id, 'done');
      const attempt = store.insertAttempt(card.id, o.manual ?? false);
      store.finishAttempt(attempt.id, { outcome: 'success', costUsd: o.cost ?? 0 });
      store.recordApply(card.id, {
        method: o.method, autorun: !(o.manual ?? false),
        additions: o.add ?? 0, deletions: o.del ?? 0, files: o.files ?? 0,
      });
      db.prepare('UPDATE cards SET applied_at = ? WHERE id = ?').run([o.appliedAt, card.id]);
      return card;
    };

    // Two autorun ships + one manual ship, all within 7d.
    seed({ method: 'clean', add: 100, del: 10, files: 5, minutes: 30, cost: 0.5, appliedAt: now - 1 * day });
    seed({ method: 'three-way', add: 20, del: 5, files: 2, minutes: 15, cost: 0.25, appliedAt: now - 2 * day });
    seed({ method: 'stashed', manual: true, add: 8, del: 1, files: 1, minutes: 10, cost: 0.1, appliedAt: now - 3 * day });
    // An already-present apply delivered nothing new — counted apart from a ship.
    seed({ method: 'already-present', add: 0, del: 0, files: 0, appliedAt: now - 1 * day });
    // Out of the 7d window — excluded from a 7d query.
    seed({ method: 'clean', add: 999, del: 999, files: 9, appliedAt: now - 20 * day });

    // A done execution card with a diff that was never applied → denominator + awaiting review.
    const pending = store.createCard({ title: 'pending', projectId, taskType: 'execution' });
    store.setWorktree(pending.id, 'E:/wt/pending', 'sha');
    store.setCardState(pending.id, 'done');

    const s = store.getShippedStats('7d', now);
    expect(s.shipped).toBe(3);              // clean + three-way + stashed
    expect(s.fromAutorun).toBe(2);
    expect(s.fromManual).toBe(1);
    expect(s.alreadyPresent).toBe(1);
    expect(s.methodBreakdown).toEqual({ clean: 1, threeWay: 1, stashed: 1, alreadyPresent: 1, manual: 0 });
    expect(s.additions).toBe(128);          // 100 + 20 + 8 (already-present/out-of-range excluded)
    expect(s.deletions).toBe(16);
    expect(s.filesTouched).toBe(8);
    expect(s.minutesLanded).toBe(55);
    expect(s.costUsdLanded).toBeCloseTo(0.85);
    expect(s.awaitingReview).toBe(1);
    expect(s.doneWithDiff).toBe(4);         // 3 shipped + 1 pending
    expect(s.shipRatePct).toBe(75);
    expect(s.perProject).toEqual([{ projectId, name: 'demo', shipped: 3 }]);
    // Per-day buckets are gap-filled across the range; their ship totals sum to shipped.
    expect(s.perDay.reduce((n, d) => n + d.autorun + d.manual, 0)).toBe(3);
    // Task mix: 5 execution cards ran in-window (3 shipped + already-present +
    // the out-of-range-by-applied seed, all with an in-range attempt); the
    // never-run `pending` card is excluded. No research cards ran.
    expect(s.taskMix.research.count).toBe(0);
    expect(s.taskMix.execution.count).toBe(5);
    expect(s.taskMix.shipped.count).toBe(3);
    expect(s.taskMix.execution.costUsd).toBeCloseTo(0.85);
    expect(s.taskMix.shipped.costUsd).toBeCloseTo(0.85);
    expect(s.taskMix.totalCostUsd).toBeCloseTo(0.85);
  });

  it('a manual mark counts as a real ship, and clearApply reverts it', () => {
    const now = Date.now();
    const card = store.createCard({ title: 'landed elsewhere', projectId, taskType: 'execution' });
    store.setWorktree(card.id, `E:/wt/${card.id}`, 'sha');
    store.setCardState(card.id, 'done');
    // Manual mark: method 'manual', no LOC snapshot (worktree gone).
    store.recordApply(card.id, { method: 'manual', autorun: false, additions: null, deletions: null, files: null });

    let s = store.getShippedStats('7d', now);
    expect(s.shipped).toBe(1);
    expect(s.fromManual).toBe(1);
    expect(s.fromAutorun).toBe(0);
    expect(s.methodBreakdown.manual).toBe(1);
    expect(s.alreadyPresent).toBe(0);
    // No LOC snapshot on a hand-mark — sums stay at zero, ship still counts.
    expect(s.additions).toBe(0);
    expect(s.awaitingReview).toBe(0);

    store.clearApply(card.id);
    expect(store.getCard(card.id)!.appliedAt).toBeNull();
    expect(store.getCard(card.id)!.applyMethod).toBeNull();
    s = store.getShippedStats('7d', now);
    expect(s.shipped).toBe(0);
    expect(s.methodBreakdown.manual).toBe(0);
    expect(s.awaitingReview).toBe(1); // back to a done-but-unapplied diff
  });

  it('getShippedStats ignores research/qa cards and returns a clean zero payload', () => {
    const now = Date.now();
    const r = store.createCard({ title: 'r', projectId, taskType: 'research' });
    store.recordApply(r.id, { method: 'clean', autorun: true, additions: 5, deletions: 5, files: 1 });
    const s = store.getShippedStats('30d', now);
    expect(s.shipped).toBe(0);
    expect(s.shipRatePct).toBe(0);
    expect(s.perProject).toEqual([]);
    expect(s.costUsdLanded).toBe(0);
    // No attempt was ever run on the research card, so it isn't in the mix.
    expect(s.taskMix.research.count).toBe(0);
    expect(s.taskMix.execution.count).toBe(0);
    expect(s.taskMix.totalCostUsd).toBe(0);
  });

  it('getShippedStats counts a run research card in the task mix (never shipped)', () => {
    const now = Date.now();
    const card = store.createCard({ title: 'investigate', projectId, taskType: 'research' });
    const attempt = store.insertAttempt(card.id, false);
    store.finishAttempt(attempt.id, { outcome: 'success', costUsd: 0.4 });
    store.setCardState(card.id, 'done');

    const s = store.getShippedStats('7d', now);
    expect(s.shipped).toBe(0);                          // research never ships
    expect(s.taskMix.research.count).toBe(1);
    expect(s.taskMix.research.costUsd).toBeCloseTo(0.4);
    expect(s.taskMix.execution.count).toBe(0);
    expect(s.taskMix.shipped.count).toBe(0);
    expect(s.taskMix.totalCostUsd).toBeCloseTo(0.4);
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

describe.skipIf(!dbAvailable)('backlog schema migration v2 → v9', () => {
  it('adds Phase 2 columns, attachments, qa_url, apply-tracking, and the source-neutral population columns/tables to an existing v2 board', () => {
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
      expect(card.qaUrl).toBeNull();   // v5 default
      // v7 apply-tracking defaults: unapplied until the user lands the worktree.
      expect(card.appliedAt).toBeNull();
      expect(card.applyMethod).toBeNull();
      expect(card.appliedAutorun).toBe(false);
      expect(card.appliedAdditions).toBeNull();
      const version = migrated.prepare('SELECT version FROM schema_version').get() as { version: number };
      expect(version.version).toBe(SCHEMA_VERSION);
      // v4: the attachments table exists and is usable on a migrated board.
      expect(store.listAttachments('c1')).toEqual([]);
      store.setCardAttachments('c1', { keepIds: [], add: [{ filename: 'note.md', content: 'hi', bytes: 2 }] });
      expect(store.listAttachments('c1')).toHaveLength(1);
      // v9 population defaults on a migrated board: unlinked, default filter.
      const project = store.listProjects().find((p) => p.id === 'p1')!;
      expect(project.source).toBeNull();
      expect(project.sourceLastScanAt).toBeNull();
      expect(project.issueFilter).toEqual({ mode: 'assigned', labels: [] });
      expect(card.sourceUrl).toBeNull();
      expect(card.sourceFingerprint).toBeNull();
      // v9 source-neutral tables were created by SCHEMA_SQL on the migrating board.
      const tables = migrated
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('issue_candidates','issue_dismissed')")
        .all() as { name: string }[];
      expect(tables.map((t) => t.name).sort()).toEqual(['issue_candidates', 'issue_dismissed']);
      // idx_cards_source (created after the migration block) exists too.
      const idx = migrated
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_cards_source'")
        .get() as { name: string } | undefined;
      expect(idx?.name).toBe('idx_cards_source');
      migrated.close();
    } finally {
      // Windows can hold the SQLite file handle briefly after close(), so retry
      // the unlink to avoid a flaky EBUSY here.
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe.skipIf(!dbAvailable)('backlog schema migration v8 → v9 (GitLab → source-neutral)', () => {
  it('backfills source_* from gitlab_*, carries candidates/dismissals into issue_* tables, and drops the old tables', () => {
    const fs = require('fs') as typeof import('fs');
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const Database = require('better-sqlite3');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulse-mig9-'));
    const dbPath = path.join(dir, 'board.db');
    try {
      // Build a v8 board: gitlab_* columns on a linked project, plus the
      // gitlab_candidates / gitlab_dismissed tables with rows.
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
        CREATE TABLE projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
          gitlab_project_id INTEGER, gitlab_host TEXT, gitlab_project_path TEXT,
          issue_filter TEXT NOT NULL DEFAULT '{"mode":"assigned","labels":[]}', gitlab_last_scan_at INTEGER
        );
        CREATE TABLE cards (
          id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
          project_id TEXT NOT NULL REFERENCES projects(id), state TEXT NOT NULL DEFAULT 'refinement',
          sort_order INTEGER NOT NULL DEFAULT 0, source_url TEXT, source_fingerprint TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE gitlab_candidates (
          fingerprint TEXT PRIMARY KEY, project_id TEXT NOT NULL, iid INTEGER NOT NULL,
          title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', web_url TEXT NOT NULL,
          labels TEXT NOT NULL DEFAULT '[]', fetched_at INTEGER NOT NULL
        );
        CREATE TABLE gitlab_dismissed (
          fingerprint TEXT PRIMARY KEY, project_id TEXT NOT NULL, dismissed_at INTEGER NOT NULL
        );
        INSERT INTO schema_version (version) VALUES (8);
        INSERT INTO projects (id, name, path, created_at, gitlab_project_id, gitlab_host, gitlab_project_path, gitlab_last_scan_at)
          VALUES ('p1', 'demo', 'E:/repos/demo', 1, 4242, 'gitlab.com', 'grp/demo', 999);
        INSERT INTO gitlab_candidates (fingerprint, project_id, iid, title, description, web_url, labels, fetched_at)
          VALUES ('gitlab:4242:7', 'p1', 7, 'cand', 'd', 'https://x/7', '["bug"]', 5);
        INSERT INTO gitlab_dismissed (fingerprint, project_id, dismissed_at)
          VALUES ('gitlab:4242:9', 'p1', 6);
      `);
      legacy.close();

      const migrated = openBacklogDb(dbPath)!;
      expect(migrated).not.toBeNull();
      const store = new BacklogStore(migrated);

      // Version advanced, and the GitLab link backfilled onto the source shape.
      expect((migrated.prepare('SELECT version FROM schema_version').get() as { version: number }).version).toBe(SCHEMA_VERSION);
      const project = store.listProjects().find((p) => p.id === 'p1')!;
      expect(project.source).toEqual({ kind: 'gitlab', ref: '4242', host: 'gitlab.com', slug: 'grp/demo', name: 'grp/demo' });
      expect(project.sourceLastScanAt).toBe(999);

      // Candidate + dismissal carried into the source-neutral tables.
      const cands = store.listCandidates('p1');
      expect(cands).toHaveLength(1);
      expect(cands[0]).toMatchObject({ fingerprint: 'gitlab:4242:7', sourceKind: 'gitlab', ref: '7', title: 'cand' });
      expect(store.isDismissed('gitlab:4242:9')).toBe(true);

      // The old GitLab tables are gone; the source-neutral ones exist.
      const tables = migrated
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('gitlab_candidates','gitlab_dismissed','issue_candidates','issue_dismissed')")
        .all() as { name: string }[];
      expect(tables.map((t) => t.name).sort()).toEqual(['issue_candidates', 'issue_dismissed']);

      migrated.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
});

describe.skipIf(dbAvailable)('BacklogStore (native module unavailable)', () => {
  it('openBacklogDb returns null instead of throwing', () => {
    expect(openBacklogDb(':memory:')).toBeNull();
  });
});

import { randomUUID } from 'crypto';
import path from 'path';
import {
  BacklogArtifact,
  BacklogAttempt,
  BacklogAttemptOutcome,
  BacklogCard,
  BacklogCardState,
  BacklogProject,
  QaProvider,
  RiskTier,
  isSafeModelId,
} from '../../common/backlog-types';
import { Database } from './db';

// States only the engine may set — a user "move" can never target these, and
// a card currently in one of them is owned by the running executor.
const ENGINE_ONLY_STATES: BacklogCardState[] = ['claimed', 'in-progress'];

const CARD_STATES: BacklogCardState[] = [
  'refinement', 'todo', 'claimed', 'in-progress', 'done', 'blocked', 'paused',
];
const RISK_TIERS: RiskTier[] = ['green', 'amber', 'red'];
const QA_PROVIDERS: QaProvider[] = ['browser', 'tests', 'lint', 'typecheck', 'custom', 'none'];

interface CardRow {
  id: string; title: string; description: string; project_id: string;
  state: string; risk_tier: string;
  estimated_minutes: number | null; estimated_cost_usd: number | null;
  prereq_ids: string; qa_provider: string; acceptance_criteria: string;
  sort_order: number; blocked_reason: string | null; model: string | null;
  created_at: number; updated_at: number;
}

/** Untrusted (IPC) model value → stored value. Anything unsafe becomes null (project default). */
function normalizeModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isSafeModelId(trimmed) ? trimmed : null;
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rowToCard(row: CardRow): BacklogCard {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    projectId: row.project_id,
    state: row.state as BacklogCardState,
    riskTier: row.risk_tier as RiskTier,
    model: row.model,
    estimatedMinutes: row.estimated_minutes,
    estimatedCostUsd: row.estimated_cost_usd,
    prereqIds: parseJsonStringArray(row.prereq_ids),
    qaProvider: row.qa_provider as QaProvider,
    acceptanceCriteria: parseJsonStringArray(row.acceptance_criteria),
    sortOrder: row.sort_order,
    blockedReason: row.blocked_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateCardInput {
  title: string;
  description?: string;
  projectId: string;
  state?: 'refinement' | 'todo';
  riskTier?: RiskTier;
  model?: string | null;
  estimatedMinutes?: number | null;
  estimatedCostUsd?: number | null;
  prereqIds?: string[];
}

export type UpdateCardPatch = Partial<Pick<BacklogCard,
  'title' | 'description' | 'projectId' | 'riskTier' | 'model' |
  'estimatedMinutes' | 'estimatedCostUsd' | 'prereqIds' |
  'qaProvider' | 'acceptanceCriteria'
>>;

export interface MoveResult {
  ok: boolean;
  reason?: string;
  card?: BacklogCard;
}

/**
 * Synchronous data layer over pulse-backlog.db. All methods are plain
 * prepared-statement calls; the engine and IPC handlers own broadcasting.
 * Constructor takes the DB handle so tests can pass an in-memory database.
 */
export class BacklogStore {
  constructor(private readonly db: Database) {}

  // ── Projects ──────────────────────────────────────────────────────────────

  listProjects(): BacklogProject[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at').all() as any[];
    return rows.map((r) => ({ id: r.id, name: r.name, path: r.path, createdAt: r.created_at }));
  }

  /** Idempotent on path: adding an already-registered folder returns the existing project. */
  addProject(projectPath: string, name?: string): BacklogProject {
    const existing = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(projectPath) as any;
    if (existing) {
      return { id: existing.id, name: existing.name, path: existing.path, createdAt: existing.created_at };
    }
    const project: BacklogProject = {
      id: randomUUID(),
      name: name?.trim() || path.basename(projectPath),
      path: projectPath,
      createdAt: Date.now(),
    };
    this.db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (@id, @name, @path, @createdAt)')
      .run(project);
    return project;
  }

  removeProject(id: string): { ok: boolean; reason?: string } {
    const inUse = this.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE project_id = ?').get(id) as { n: number };
    if (inUse.n > 0) {
      return { ok: false, reason: `${inUse.n} card(s) still reference this project — delete or reassign them first` };
    }
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return { ok: true };
  }

  // ── Cards ─────────────────────────────────────────────────────────────────

  listCards(): BacklogCard[] {
    const rows = this.db.prepare('SELECT * FROM cards ORDER BY sort_order, created_at').all() as CardRow[];
    return rows.map(rowToCard);
  }

  getCard(id: string): BacklogCard | null {
    const row = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id) as CardRow | undefined;
    return row ? rowToCard(row) : null;
  }

  createCard(input: CreateCardInput): BacklogCard {
    const now = Date.now();
    const state: BacklogCardState = input.state === 'todo' ? 'todo' : 'refinement';
    const card: BacklogCard = {
      id: randomUUID(),
      title: input.title.trim(),
      description: input.description ?? '',
      projectId: input.projectId,
      state,
      riskTier: RISK_TIERS.includes(input.riskTier as RiskTier) ? (input.riskTier as RiskTier) : 'green',
      model: normalizeModel(input.model),
      estimatedMinutes: typeof input.estimatedMinutes === 'number' ? input.estimatedMinutes : null,
      estimatedCostUsd: typeof input.estimatedCostUsd === 'number' ? input.estimatedCostUsd : null,
      prereqIds: Array.isArray(input.prereqIds) ? input.prereqIds : [],
      qaProvider: 'none',        // Phase 1: QA fields exist but stay disabled
      acceptanceCriteria: [],
      sortOrder: state === 'todo' ? this.nextSortOrder() : 0,
      blockedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO cards (
        id, title, description, project_id, state, risk_tier, model,
        estimated_minutes, estimated_cost_usd, prereq_ids, qa_provider,
        acceptance_criteria, sort_order, blocked_reason, created_at, updated_at
      ) VALUES (
        @id, @title, @description, @projectId, @state, @riskTier, @model,
        @estimatedMinutes, @estimatedCostUsd, @prereqIds, @qaProvider,
        @acceptanceCriteria, @sortOrder, @blockedReason, @createdAt, @updatedAt
      )
    `).run({
      ...card,
      prereqIds: JSON.stringify(card.prereqIds),
      acceptanceCriteria: JSON.stringify(card.acceptanceCriteria),
    });
    return card;
  }

  updateCard(id: string, patch: UpdateCardPatch): BacklogCard | null {
    const card = this.getCard(id);
    if (!card) return null;
    const next: BacklogCard = {
      ...card,
      ...(typeof patch.title === 'string' ? { title: patch.title.trim() } : {}),
      ...(typeof patch.description === 'string' ? { description: patch.description } : {}),
      ...(typeof patch.projectId === 'string' ? { projectId: patch.projectId } : {}),
      ...(RISK_TIERS.includes(patch.riskTier as RiskTier) ? { riskTier: patch.riskTier as RiskTier } : {}),
      ...(patch.model !== undefined ? { model: normalizeModel(patch.model) } : {}),
      ...(patch.estimatedMinutes !== undefined ? { estimatedMinutes: patch.estimatedMinutes } : {}),
      ...(patch.estimatedCostUsd !== undefined ? { estimatedCostUsd: patch.estimatedCostUsd } : {}),
      ...(Array.isArray(patch.prereqIds) ? { prereqIds: patch.prereqIds } : {}),
      ...(QA_PROVIDERS.includes(patch.qaProvider as QaProvider) ? { qaProvider: patch.qaProvider as QaProvider } : {}),
      ...(Array.isArray(patch.acceptanceCriteria) ? { acceptanceCriteria: patch.acceptanceCriteria } : {}),
      updatedAt: Date.now(),
    };
    this.db.prepare(`
      UPDATE cards SET
        title = @title, description = @description, project_id = @projectId,
        risk_tier = @riskTier, model = @model, estimated_minutes = @estimatedMinutes,
        estimated_cost_usd = @estimatedCostUsd, prereq_ids = @prereqIds,
        qa_provider = @qaProvider, acceptance_criteria = @acceptanceCriteria,
        updated_at = @updatedAt
      WHERE id = @id
    `).run({
      ...next,
      prereqIds: JSON.stringify(next.prereqIds),
      acceptanceCriteria: JSON.stringify(next.acceptanceCriteria),
    });
    return next;
  }

  deleteCard(id: string): void {
    this.db.prepare('DELETE FROM cards WHERE id = ?').run(id);
  }

  /**
   * User-initiated column move. Engine-only states are rejected in both
   * directions: you can't drop a card into claimed/in-progress, and a card
   * the executor currently owns can't be yanked out from under it.
   */
  moveCard(id: string, state: BacklogCardState): MoveResult {
    if (!CARD_STATES.includes(state)) return { ok: false, reason: `unknown state '${state}'` };
    if (ENGINE_ONLY_STATES.includes(state)) return { ok: false, reason: `'${state}' is set by the executor, not manually` };
    const card = this.getCard(id);
    if (!card) return { ok: false, reason: 'card not found' };
    if (ENGINE_ONLY_STATES.includes(card.state)) {
      return { ok: false, reason: 'card is currently running — wait for it to finish' };
    }
    if (card.state === state) return { ok: true, card };

    const sortOrder = state === 'todo' ? this.nextSortOrder() : card.sortOrder;
    // Leaving blocked (or re-queueing) clears the stale reason.
    const blockedReason = state === 'blocked' ? card.blockedReason : null;
    this.db.prepare(
      'UPDATE cards SET state = ?, sort_order = ?, blocked_reason = ?, updated_at = ? WHERE id = ?',
    ).run([state, sortOrder, blockedReason, Date.now(), id]);
    return { ok: true, card: this.getCard(id)! };
  }

  /** Rewrite Todo ordering from the renderer's complete ordered id list. */
  reorderTodo(orderedIds: string[]): void {
    const stmt = this.db.prepare("UPDATE cards SET sort_order = ?, updated_at = ? WHERE id = ? AND state = 'todo'");
    const apply = this.db.transaction((ids: string[]) => {
      const now = Date.now();
      ids.forEach((id, index) => stmt.run([index * 10, now, id]));
    });
    apply(orderedIds);
  }

  /**
   * Atomic claim: flips todo/paused → claimed in a single UPDATE so two
   * concurrent claimers can't grab the same card. Returns false if the card
   * was already claimed, moved, or deleted.
   */
  claimCard(id: string): boolean {
    const info = this.db.prepare(
      "UPDATE cards SET state = 'claimed', updated_at = ? WHERE id = ? AND state IN ('todo', 'paused')",
    ).run([Date.now(), id]);
    return Number(info.changes) === 1;
  }

  /** Engine-internal transition (in-progress / done / blocked / paused). */
  setCardState(id: string, state: BacklogCardState, blockedReason?: string | null): void {
    this.db.prepare('UPDATE cards SET state = ?, blocked_reason = ?, updated_at = ? WHERE id = ?')
      .run([state, blockedReason ?? null, Date.now(), id]);
  }

  private nextSortOrder(): number {
    const row = this.db.prepare("SELECT MAX(sort_order) AS m FROM cards WHERE state = 'todo'").get() as { m: number | null };
    return (row.m ?? 0) + 10;
  }

  // ── Attempts & artifacts ──────────────────────────────────────────────────

  insertAttempt(cardId: string, manual: boolean): BacklogAttempt {
    const attempt: BacklogAttempt = {
      id: randomUUID(),
      cardId,
      startedAt: Date.now(),
      endedAt: null,
      outcome: null,
      reason: null,
      costUsd: null,
      numTurns: null,
      sessionId: null,
      manual,
    };
    this.db.prepare(`
      INSERT INTO attempts (id, card_id, started_at, ended_at, outcome, reason, cost_usd, num_turns, session_id, manual)
      VALUES (@id, @cardId, @startedAt, @endedAt, @outcome, @reason, @costUsd, @numTurns, @sessionId, @manual)
    `).run({ ...attempt, manual: manual ? 1 : 0 });
    return attempt;
  }

  finishAttempt(
    id: string,
    result: {
      outcome: BacklogAttemptOutcome;
      reason?: string | null;
      costUsd?: number | null;
      numTurns?: number | null;
      sessionId?: string | null;
    },
  ): void {
    this.db.prepare(`
      UPDATE attempts SET ended_at = ?, outcome = ?, reason = ?, cost_usd = ?, num_turns = ?, session_id = ?
      WHERE id = ?
    `).run([
      Date.now(), result.outcome, result.reason ?? null,
      result.costUsd ?? null, result.numTurns ?? null, result.sessionId ?? null, id,
    ]);
  }

  /**
   * How many of the card's most recent FINISHED attempts ended 'killed'
   * (budget overrun), counting back until any other outcome. User stops and
   * window-end pauses record 'paused', so they reset the streak — only
   * back-to-back budget kills escalate.
   */
  countConsecutiveKills(cardId: string): number {
    const rows = this.db.prepare(
      'SELECT outcome FROM attempts WHERE card_id = ? AND outcome IS NOT NULL ORDER BY started_at DESC',
    ).all(cardId) as { outcome: string }[];
    let n = 0;
    for (const row of rows) {
      if (row.outcome !== 'killed') break;
      n += 1;
    }
    return n;
  }

  listAttempts(cardId: string): BacklogAttempt[] {
    const rows = this.db.prepare('SELECT * FROM attempts WHERE card_id = ? ORDER BY started_at DESC').all(cardId) as any[];
    return rows.map((r) => ({
      id: r.id, cardId: r.card_id, startedAt: r.started_at, endedAt: r.ended_at,
      outcome: r.outcome, reason: r.reason, costUsd: r.cost_usd,
      numTurns: r.num_turns, sessionId: r.session_id, manual: r.manual === 1,
    }));
  }

  insertArtifact(input: { cardId: string; attemptId: string; path: string; preview: string }): BacklogArtifact {
    const artifact: BacklogArtifact = {
      id: randomUUID(),
      cardId: input.cardId,
      attemptId: input.attemptId,
      kind: 'report',
      path: input.path,
      preview: input.preview,
      createdAt: Date.now(),
    };
    this.db.prepare(`
      INSERT INTO artifacts (id, card_id, attempt_id, kind, path, preview, created_at)
      VALUES (@id, @cardId, @attemptId, @kind, @path, @preview, @createdAt)
    `).run(artifact);
    return artifact;
  }

  listArtifacts(cardId: string): BacklogArtifact[] {
    const rows = this.db.prepare('SELECT * FROM artifacts WHERE card_id = ? ORDER BY created_at DESC').all(cardId) as any[];
    return rows.map((r) => ({
      id: r.id, cardId: r.card_id, attemptId: r.attempt_id, kind: r.kind,
      path: r.path, preview: r.preview, createdAt: r.created_at,
    }));
  }

  getArtifact(id: string): BacklogArtifact | null {
    const r = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as any;
    return r
      ? { id: r.id, cardId: r.card_id, attemptId: r.attempt_id, kind: r.kind, path: r.path, preview: r.preview, createdAt: r.created_at }
      : null;
  }
}

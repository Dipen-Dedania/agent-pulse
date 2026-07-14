import { randomUUID } from 'crypto';
import path from 'path';
import {
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MAX_TOTAL_BYTES,
  AttachmentIntent,
  BacklogArtifact,
  BacklogArtifactKind,
  BacklogAttachment,
  BacklogAttempt,
  BacklogAttemptOutcome,
  BacklogCard,
  BacklogCardState,
  BacklogProject,
  BacklogTaskType,
  QaProvider,
  RiskTier,
  isSafeModelId,
} from '../../common/backlog-types';
import { Database } from './db';

// States only the engine may set — a user "move" can never target these, and
// a card currently in one of them is owned by the running executor.
const ENGINE_ONLY_STATES: BacklogCardState[] = ['claimed', 'in-progress'];

const CARD_STATES: BacklogCardState[] = [
  'refinement', 'todo', 'claimed', 'in-progress', 'done', 'blocked', 'rework', 'paused',
];
const RISK_TIERS: RiskTier[] = ['green', 'amber', 'red'];
const TASK_TYPES: BacklogTaskType[] = ['research', 'execution'];
// 'browser' exists in the QaProvider type but isn't selectable until the
// browser-QA phase — the store rejects it like any unknown value.
const QA_PROVIDERS_ENABLED: QaProvider[] = ['tests', 'lint', 'typecheck', 'custom', 'none'];

const QA_COMMAND_MAX_LENGTH = 500;

interface CardRow {
  id: string; title: string; description: string; project_id: string;
  state: string; task_type: string; risk_tier: string;
  estimated_minutes: number | null; estimated_cost_usd: number | null;
  prereq_ids: string; qa_provider: string; qa_command: string | null;
  acceptance_criteria: string;
  worktree_path: string | null; base_sha: string | null;
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

/** Untrusted (IPC) custom QA command → stored value. Runs with user privileges
 * by design (same trust as the user's own terminal), but bounded and trimmed. */
function normalizeQaCommand(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= QA_COMMAND_MAX_LENGTH ? trimmed : null;
}

/** Untrusted (IPC) criteria list → trimmed non-empty strings. */
function normalizeCriteria(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function rowToCard(row: CardRow): BacklogCard {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    projectId: row.project_id,
    state: row.state as BacklogCardState,
    taskType: row.task_type === 'execution' ? 'execution' : 'research',
    riskTier: row.risk_tier as RiskTier,
    model: row.model,
    estimatedMinutes: row.estimated_minutes,
    estimatedCostUsd: row.estimated_cost_usd,
    prereqIds: parseJsonStringArray(row.prereq_ids),
    qaProvider: row.qa_provider as QaProvider,
    qaCommand: row.qa_command,
    acceptanceCriteria: parseJsonStringArray(row.acceptance_criteria),
    worktreePath: row.worktree_path,
    baseSha: row.base_sha,
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
  taskType?: BacklogTaskType;
  riskTier?: RiskTier;
  model?: string | null;
  estimatedMinutes?: number | null;
  estimatedCostUsd?: number | null;
  prereqIds?: string[];
  qaProvider?: QaProvider;
  qaCommand?: string | null;
  acceptanceCriteria?: string[];
}

export type UpdateCardPatch = Partial<Pick<BacklogCard,
  'title' | 'description' | 'projectId' | 'taskType' | 'riskTier' | 'model' |
  'estimatedMinutes' | 'estimatedCostUsd' | 'prereqIds' |
  'qaProvider' | 'qaCommand' | 'acceptanceCriteria'
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
      taskType: TASK_TYPES.includes(input.taskType as BacklogTaskType) ? (input.taskType as BacklogTaskType) : 'research',
      riskTier: RISK_TIERS.includes(input.riskTier as RiskTier) ? (input.riskTier as RiskTier) : 'green',
      model: normalizeModel(input.model),
      estimatedMinutes: typeof input.estimatedMinutes === 'number' ? input.estimatedMinutes : null,
      estimatedCostUsd: typeof input.estimatedCostUsd === 'number' ? input.estimatedCostUsd : null,
      prereqIds: Array.isArray(input.prereqIds) ? input.prereqIds : [],
      qaProvider: QA_PROVIDERS_ENABLED.includes(input.qaProvider as QaProvider) ? (input.qaProvider as QaProvider) : 'none',
      qaCommand: normalizeQaCommand(input.qaCommand),
      acceptanceCriteria: normalizeCriteria(input.acceptanceCriteria),
      worktreePath: null,
      baseSha: null,
      sortOrder: state === 'todo' ? this.nextSortOrder() : 0,
      blockedReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO cards (
        id, title, description, project_id, state, task_type, risk_tier, model,
        estimated_minutes, estimated_cost_usd, prereq_ids, qa_provider, qa_command,
        acceptance_criteria, worktree_path, base_sha, sort_order, blocked_reason,
        created_at, updated_at
      ) VALUES (
        @id, @title, @description, @projectId, @state, @taskType, @riskTier, @model,
        @estimatedMinutes, @estimatedCostUsd, @prereqIds, @qaProvider, @qaCommand,
        @acceptanceCriteria, @worktreePath, @baseSha, @sortOrder, @blockedReason,
        @createdAt, @updatedAt
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
      ...(TASK_TYPES.includes(patch.taskType as BacklogTaskType) ? { taskType: patch.taskType as BacklogTaskType } : {}),
      ...(RISK_TIERS.includes(patch.riskTier as RiskTier) ? { riskTier: patch.riskTier as RiskTier } : {}),
      ...(patch.model !== undefined ? { model: normalizeModel(patch.model) } : {}),
      ...(patch.estimatedMinutes !== undefined ? { estimatedMinutes: patch.estimatedMinutes } : {}),
      ...(patch.estimatedCostUsd !== undefined ? { estimatedCostUsd: patch.estimatedCostUsd } : {}),
      ...(Array.isArray(patch.prereqIds) ? { prereqIds: patch.prereqIds } : {}),
      ...(QA_PROVIDERS_ENABLED.includes(patch.qaProvider as QaProvider) ? { qaProvider: patch.qaProvider as QaProvider } : {}),
      ...(patch.qaCommand !== undefined ? { qaCommand: normalizeQaCommand(patch.qaCommand) } : {}),
      ...(Array.isArray(patch.acceptanceCriteria) ? { acceptanceCriteria: normalizeCriteria(patch.acceptanceCriteria) } : {}),
      updatedAt: Date.now(),
    };
    this.db.prepare(`
      UPDATE cards SET
        title = @title, description = @description, project_id = @projectId,
        task_type = @taskType, risk_tier = @riskTier, model = @model,
        estimated_minutes = @estimatedMinutes,
        estimated_cost_usd = @estimatedCostUsd, prereq_ids = @prereqIds,
        qa_provider = @qaProvider, qa_command = @qaCommand,
        acceptance_criteria = @acceptanceCriteria,
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
   * Atomic claim: flips todo/paused/rework → claimed in a single UPDATE so
   * two concurrent claimers can't grab the same card. Returns false if the
   * card was already claimed, moved, or deleted.
   */
  claimCard(id: string): boolean {
    const info = this.db.prepare(
      "UPDATE cards SET state = 'claimed', updated_at = ? WHERE id = ? AND state IN ('todo', 'paused', 'rework')",
    ).run([Date.now(), id]);
    return Number(info.changes) === 1;
  }

  /** Engine-internal transition (in-progress / done / blocked / rework / paused). */
  setCardState(id: string, state: BacklogCardState, blockedReason?: string | null): void {
    this.db.prepare('UPDATE cards SET state = ?, blocked_reason = ?, updated_at = ? WHERE id = ?')
      .run([state, blockedReason ?? null, Date.now(), id]);
  }

  /** Engine-internal: record the execution worktree created for this card. */
  setWorktree(id: string, worktreePath: string, baseSha: string): void {
    this.db.prepare('UPDATE cards SET worktree_path = ?, base_sha = ?, updated_at = ? WHERE id = ?')
      .run([worktreePath, baseSha, Date.now(), id]);
  }

  /** The user removed the worktree from the card — clear the pointer. */
  clearWorktree(id: string): void {
    this.db.prepare('UPDATE cards SET worktree_path = NULL, base_sha = NULL, updated_at = ? WHERE id = ?')
      .run([Date.now(), id]);
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
    return this.countTrailingOutcome(cardId, 'killed');
  }

  /**
   * Same streak logic for QA failures: back-to-back 'qa-failed' attempts
   * escalate a rework card to Blocked instead of retrying forever. Any other
   * outcome (success, pause, kill) resets the streak.
   */
  countConsecutiveQaFails(cardId: string): number {
    return this.countTrailingOutcome(cardId, 'qa-failed');
  }

  private countTrailingOutcome(cardId: string, outcome: BacklogAttemptOutcome): number {
    const rows = this.db.prepare(
      'SELECT outcome FROM attempts WHERE card_id = ? AND outcome IS NOT NULL ORDER BY started_at DESC',
    ).all(cardId) as { outcome: string }[];
    let n = 0;
    for (const row of rows) {
      if (row.outcome !== outcome) break;
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

  insertArtifact(input: {
    cardId: string; attemptId: string; path: string; preview: string;
    kind?: BacklogArtifactKind;
  }): BacklogArtifact {
    const artifact: BacklogArtifact = {
      id: randomUUID(),
      cardId: input.cardId,
      attemptId: input.attemptId,
      kind: input.kind ?? 'report',
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

  // ─── Attachments ──────────────────────────────────────────────────────────

  /** Metadata only (no content) — for the editor list and any UI. */
  listAttachments(cardId: string): BacklogAttachment[] {
    const rows = this.db
      .prepare('SELECT id, card_id, filename, bytes, created_at FROM card_attachments WHERE card_id = ? ORDER BY created_at ASC')
      .all(cardId) as any[];
    return rows.map((r) => ({
      id: r.id, cardId: r.card_id, filename: r.filename, bytes: r.bytes, createdAt: r.created_at,
    }));
  }

  /** filename + content, in stable order — used by the engine at prompt build. */
  listAttachmentContents(cardId: string): { filename: string; content: string }[] {
    const rows = this.db
      .prepare('SELECT filename, content FROM card_attachments WHERE card_id = ? ORDER BY created_at ASC')
      .all(cardId) as any[];
    return rows.map((r) => ({ filename: r.filename, content: r.content }));
  }

  /**
   * Apply the desired attachment set for a card in one transaction: delete any
   * existing rows not in `keepIds`, then insert the newly-picked files. Enforces
   * the per-file / total-size / count caps defensively (the IPC layer also
   * checks, with user-facing messages). Returns the resulting metadata list.
   */
  setCardAttachments(cardId: string, intent: AttachmentIntent): BacklogAttachment[] {
    const keep = new Set(Array.isArray(intent?.keepIds) ? intent.keepIds : []);
    const add = Array.isArray(intent?.add) ? intent.add : [];

    const apply = this.db.transaction(() => {
      // Delete rows the user removed (anything for this card not kept).
      const existing = this.db.prepare('SELECT id FROM card_attachments WHERE card_id = ?').all(cardId) as { id: string }[];
      for (const row of existing) {
        if (!keep.has(row.id)) {
          this.db.prepare('DELETE FROM card_attachments WHERE id = ?').run(row.id);
        }
      }

      let total = (this.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM card_attachments WHERE card_id = ?').get(cardId) as { n: number }).n;
      let count = (this.db.prepare('SELECT COUNT(*) AS n FROM card_attachments WHERE card_id = ?').get(cardId) as { n: number }).n;

      for (const item of add) {
        if (typeof item?.filename !== 'string' || typeof item?.content !== 'string') continue;
        const bytes = Buffer.byteLength(item.content, 'utf8');
        if (bytes > ATTACHMENT_MAX_FILE_BYTES) continue;          // per-file cap
        if (count + 1 > ATTACHMENT_MAX_COUNT) break;              // count cap
        if (total + bytes > ATTACHMENT_MAX_TOTAL_BYTES) break;    // total cap
        this.db.prepare(`
          INSERT INTO card_attachments (id, card_id, filename, content, bytes, created_at)
          VALUES (@id, @cardId, @filename, @content, @bytes, @createdAt)
        `).run({
          id: randomUUID(), cardId, filename: item.filename.slice(0, 255),
          content: item.content, bytes, createdAt: Date.now(),
        });
        total += bytes;
        count += 1;
      }
    });
    apply();
    return this.listAttachments(cardId);
  }
}

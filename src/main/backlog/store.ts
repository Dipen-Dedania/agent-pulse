import { randomUUID } from 'crypto';
import path from 'path';
import {
  ApplyMethod,
  ATTACHMENT_MAX_COUNT,
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENT_MAX_TOTAL_BYTES,
  AttachmentIntent,
  BacklogAgent,
  BacklogArtifact,
  BacklogArtifactKind,
  BacklogAttachment,
  BacklogAttempt,
  BacklogAttemptOutcome,
  BacklogCard,
  BacklogCardState,
  BacklogProject,
  BacklogStatsPayload,
  BacklogStatsRange,
  BacklogTaskType,
  IssueCandidate,
  IssueFilter,
  IssueSourceKind,
  IssueSourceLink,
  QaProvider,
  RiskTier,
  isSafeModelId,
  normalizeAgent,
} from '../../common/backlog-types';
import { Database } from './db';

// States only the engine may set — a user "move" can never target these, and
// a card currently in one of them is owned by the running executor.
const ENGINE_ONLY_STATES: BacklogCardState[] = ['claimed', 'in-progress'];

const CARD_STATES: BacklogCardState[] = [
  'refinement', 'todo', 'claimed', 'in-progress', 'done', 'blocked', 'rework', 'paused',
];
const RISK_TIERS: RiskTier[] = ['green', 'amber', 'red'];
const TASK_TYPES: BacklogTaskType[] = ['research', 'execution', 'qa'];
// 'browser' exists in the QaProvider type but isn't selectable until the
// browser-QA phase — the store rejects it like any unknown value.
const QA_PROVIDERS_ENABLED: QaProvider[] = ['tests', 'lint', 'typecheck', 'custom', 'none'];

const QA_COMMAND_MAX_LENGTH = 500;
const QA_URL_MAX_LENGTH = 2000;

interface CardRow {
  id: string; title: string; description: string; project_id: string;
  state: string; task_type: string; risk_tier: string;
  estimated_minutes: number | null; estimated_cost_usd: number | null;
  prereq_ids: string; qa_provider: string; qa_command: string | null;
  qa_url: string | null;
  acceptance_criteria: string;
  worktree_path: string | null; base_sha: string | null;
  refinement_session_id: string | null; refinement_started_at: number | null;
  applied_at: number | null; apply_method: string | null; applied_autorun: number;
  applied_additions: number | null; applied_deletions: number | null; applied_files: number | null;
  sort_order: number; blocked_reason: string | null; model: string | null;
  agent: string | null;
  source_url: string | null; source_fingerprint: string | null;
  created_at: number; updated_at: number;
}

interface ProjectRow {
  id: string; name: string; path: string; created_at: number;
  source_kind: string | null; source_ref: string | null;
  source_host: string | null; source_slug: string | null;
  source_name: string | null;
  source_scope_ref: string | null; source_scope_name: string | null;
  issue_filter: string | null;
  source_last_scan_at: number | null;
}

/** Persisted issue_filter JSON → validated IssueFilter (defaults on garbage). */
function parseIssueFilter(raw: unknown): IssueFilter {
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      const mode = p?.mode === 'all' || p?.mode === 'label' ? p.mode : 'assigned';
      const labels = Array.isArray(p?.labels)
        ? p.labels.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      return { mode, labels };
    } catch {
      /* fall through to default */
    }
  }
  return { mode: 'assigned', labels: [] };
}

/** Assemble the nullable IssueSourceLink from a project row (null = unlinked). */
function rowToSource(r: ProjectRow): IssueSourceLink | null {
  if (r.source_kind !== 'gitlab' && r.source_kind !== 'linear' && r.source_kind !== 'jira') return null;
  if (r.source_ref == null) return null;
  return {
    kind: r.source_kind,
    ref: r.source_ref,
    host: r.source_host ?? null,
    slug: r.source_slug ?? '',
    name: r.source_name ?? r.source_slug ?? '',
    ...(r.source_scope_ref ? { scopeRef: r.source_scope_ref } : {}),
    ...(r.source_scope_name ? { scopeName: r.source_scope_name } : {}),
  };
}

function rowToProject(r: ProjectRow): BacklogProject {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    createdAt: r.created_at,
    source: rowToSource(r),
    issueFilter: parseIssueFilter(r.issue_filter),
    sourceLastScanAt: r.source_last_scan_at ?? null,
  };
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

/** Untrusted (IPC) QA-card URL → stored value. Only http(s) URLs the browser
 * agent can open; anything else becomes null. The value reaches the prompt via
 * stdin (never argv), so this is a sanity gate, not an injection barrier. */
function normalizeQaUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > QA_URL_MAX_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
  } catch {
    return null;
  }
}

/** Untrusted (IPC) criteria list → trimmed non-empty strings. */
function normalizeCriteria(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

// ─── Overnight Backlog stats: local-time date bucketing ──────────────────────
// The shipped-per-period bar chart adapts its granularity to the range so the
// x-axis never blows past ~31 bars: day for 7d/30d, week (Mon-start) for 90d,
// month for 1y. All bucketing is in LOCAL time — "shipped overnight" is a
// wall-clock notion, so a UTC bucket would smear runs across the wrong day.
type StatsGranularity = 'day' | 'week' | 'month';

function granularityFor(range: BacklogStatsRange): StatsGranularity {
  if (range === '7d' || range === '30d') return 'day';
  if (range === '90d') return 'week';
  return 'month';
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const dayStr = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** Start-of-bucket Date (local) for the period `ms` falls in. */
function bucketStart(ms: number, g: StatsGranularity): Date {
  const d = new Date(ms);
  if (g === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
  if (g === 'week') {
    const mondayOffset = (d.getDay() + 6) % 7; // 0 = Monday
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - mondayOffset);
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Stable bucket key: 'YYYY-MM' for months, else the day/week-start 'YYYY-MM-DD'. */
function bucketKey(ms: number, g: StatsGranularity): string {
  const start = bucketStart(ms, g);
  return g === 'month' ? `${start.getFullYear()}-${pad2(start.getMonth() + 1)}` : dayStr(start);
}

/** Ordered, gap-filled bucket keys spanning [cutoff, now] at granularity `g`. */
function bucketKeysInRange(cutoff: number, now: number, g: StatsGranularity): string[] {
  const keys: string[] = [];
  let cursor = bucketStart(cutoff, g);
  while (cursor.getTime() <= now) {
    keys.push(bucketKey(cursor.getTime(), g));
    if (g === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    else cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + (g === 'week' ? 7 : 1));
  }
  return keys;
}

function rowToCard(row: CardRow): BacklogCard {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    projectId: row.project_id,
    state: row.state as BacklogCardState,
    taskType: row.task_type === 'execution' || row.task_type === 'qa' ? row.task_type : 'research',
    agent: normalizeAgent(row.agent),
    riskTier: row.risk_tier as RiskTier,
    model: row.model,
    estimatedMinutes: row.estimated_minutes,
    estimatedCostUsd: row.estimated_cost_usd,
    prereqIds: parseJsonStringArray(row.prereq_ids),
    qaProvider: row.qa_provider as QaProvider,
    qaCommand: row.qa_command,
    qaUrl: row.qa_url,
    acceptanceCriteria: parseJsonStringArray(row.acceptance_criteria),
    worktreePath: row.worktree_path,
    baseSha: row.base_sha,
    refinementSessionId: row.refinement_session_id,
    refinementStartedAt: row.refinement_started_at,
    appliedAt: row.applied_at,
    applyMethod: (row.apply_method as ApplyMethod | null) ?? null,
    appliedAutorun: row.applied_autorun === 1,
    appliedAdditions: row.applied_additions,
    appliedDeletions: row.applied_deletions,
    appliedFiles: row.applied_files,
    sortOrder: row.sort_order,
    blockedReason: row.blocked_reason,
    sourceUrl: row.source_url,
    sourceFingerprint: row.source_fingerprint,
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
  agent?: BacklogAgent;
  riskTier?: RiskTier;
  model?: string | null;
  estimatedMinutes?: number | null;
  estimatedCostUsd?: number | null;
  prereqIds?: string[];
  qaProvider?: QaProvider;
  qaCommand?: string | null;
  qaUrl?: string | null;
  acceptanceCriteria?: string[];
  // Provenance for auto-populated cards (Phase 3); engine-supplied, absent for
  // hand-authored cards.
  sourceUrl?: string | null;
  sourceFingerprint?: string | null;
}

export type UpdateCardPatch = Partial<Pick<BacklogCard,
  'title' | 'description' | 'projectId' | 'taskType' | 'agent' | 'riskTier' | 'model' |
  'estimatedMinutes' | 'estimatedCostUsd' | 'prereqIds' |
  'qaProvider' | 'qaCommand' | 'qaUrl' | 'acceptanceCriteria'
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
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at').all() as ProjectRow[];
    return rows.map(rowToProject);
  }

  /** Idempotent on path: adding an already-registered folder returns the existing project. */
  addProject(projectPath: string, name?: string): BacklogProject {
    const existing = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(projectPath) as ProjectRow | undefined;
    if (existing) return rowToProject(existing);
    const id = randomUUID();
    const createdAt = Date.now();
    this.db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (@id, @name, @path, @createdAt)')
      .run({ id, name: name?.trim() || path.basename(projectPath), path: projectPath, createdAt });
    // GitLab columns take their DDL defaults on insert; re-read for the full shape.
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow;
    return rowToProject(row);
  }

  removeProject(id: string): { ok: boolean; reason?: string } {
    const inUse = this.db.prepare('SELECT COUNT(*) AS n FROM cards WHERE project_id = ?').get(id) as { n: number };
    if (inUse.n > 0) {
      return { ok: false, reason: `${inUse.n} card(s) still reference this project — delete or reassign them first` };
    }
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return { ok: true };
  }

  // ── Issue population (Phase 3): GitLab + Linear ─────────────────────────────

  /** Cache a resolved issue-source identity on a project. Leaves issue_filter
   * as-is (it keeps its DDL default 'assigned' on a first link; setIssueFilter
   * edits it). One source per project — this overwrites any prior link. */
  setSourceLink(projectId: string, link: IssueSourceLink): void {
    this.db.prepare(
      `UPDATE projects SET source_kind = @kind, source_ref = @ref, source_host = @host,
         source_slug = @slug, source_name = @name,
         source_scope_ref = @scopeRef, source_scope_name = @scopeName
       WHERE id = @projectId`,
    ).run({
      projectId,
      kind: link.kind,
      ref: link.ref,
      host: link.host ?? null,
      slug: link.slug,
      name: link.name,
      scopeRef: link.scopeRef ?? null,
      scopeName: link.scopeName ?? null,
    });
  }

  /** Unlink a project: clear its issue-source identity and drop its transient
   * candidate/dismissed rows so a future re-link starts from a clean slate. */
  clearSourceLink(projectId: string): void {
    this.db.prepare(
      `UPDATE projects SET source_kind = NULL, source_ref = NULL, source_host = NULL,
         source_slug = NULL, source_name = NULL, source_scope_ref = NULL,
         source_scope_name = NULL, source_last_scan_at = NULL WHERE id = ?`,
    ).run(projectId);
    this.db.prepare('DELETE FROM issue_candidates WHERE project_id = ?').run(projectId);
    this.db.prepare('DELETE FROM issue_dismissed WHERE project_id = ?').run(projectId);
  }

  setIssueFilter(projectId: string, filter: IssueFilter): void {
    const mode = filter.mode === 'all' || filter.mode === 'label' ? filter.mode : 'assigned';
    const labels = Array.isArray(filter.labels) ? filter.labels.filter((x) => typeof x === 'string') : [];
    this.db.prepare('UPDATE projects SET issue_filter = ? WHERE id = ?')
      .run([JSON.stringify({ mode, labels }), projectId]);
  }

  setLastScan(projectId: string, at: number): void {
    this.db.prepare('UPDATE projects SET source_last_scan_at = ? WHERE id = ?').run([at, projectId]);
  }

  /** Dedup guard: is there ANY card (any state) already carrying this fingerprint?
   * Any-state so a handled-but-still-open issue never re-surfaces as a candidate. */
  hasCardForFingerprint(fingerprint: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM cards WHERE source_fingerprint = ? LIMIT 1').get(fingerprint);
  }

  // Candidates: the Review & Import picker's backing store (source-neutral).

  upsertCandidates(rows: IssueCandidate[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO issue_candidates (fingerprint, project_id, source_kind, ref, title, description, web_url, labels, fetched_at)
       VALUES (@fingerprint, @projectId, @sourceKind, @ref, @title, @description, @webUrl, @labels, @fetchedAt)
       ON CONFLICT(fingerprint) DO UPDATE SET
         title = excluded.title, description = excluded.description,
         web_url = excluded.web_url, labels = excluded.labels, fetched_at = excluded.fetched_at`,
    );
    for (const c of rows) {
      stmt.run({ ...c, labels: JSON.stringify(Array.isArray(c.labels) ? c.labels : []) });
    }
  }

  listCandidates(projectId?: string): IssueCandidate[] {
    const rows = (projectId
      ? this.db.prepare('SELECT * FROM issue_candidates WHERE project_id = ? ORDER BY fetched_at DESC').all(projectId)
      : this.db.prepare('SELECT * FROM issue_candidates ORDER BY fetched_at DESC').all()) as any[];
    return rows.map((r) => ({
      fingerprint: r.fingerprint,
      projectId: r.project_id,
      sourceKind: r.source_kind as IssueSourceKind,
      ref: r.ref,
      title: r.title,
      description: r.description,
      webUrl: r.web_url,
      labels: parseJsonStringArray(r.labels),
      fetchedAt: r.fetched_at,
    }));
  }

  deleteCandidates(fingerprints: string[]): void {
    const stmt = this.db.prepare('DELETE FROM issue_candidates WHERE fingerprint = ?');
    for (const fp of fingerprints) stmt.run(fp);
  }

  /** Drop this project's candidates whose fingerprint the latest scan no longer returned. */
  pruneCandidatesNotIn(projectId: string, keepFingerprints: string[]): void {
    const keep = new Set(keepFingerprints);
    const existing = this.db.prepare('SELECT fingerprint FROM issue_candidates WHERE project_id = ?')
      .all(projectId) as { fingerprint: string }[];
    this.deleteCandidates(existing.map((r) => r.fingerprint).filter((fp) => !keep.has(fp)));
  }

  // Dismissed tombstones: a rejected issue must not re-surface on the next scan.

  dismiss(rows: { fingerprint: string; projectId: string; sourceKind: IssueSourceKind }[]): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO issue_dismissed (fingerprint, project_id, source_kind, dismissed_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(fingerprint) DO NOTHING`,
    );
    for (const r of rows) stmt.run([r.fingerprint, r.projectId, r.sourceKind, now]);
  }

  isDismissed(fingerprint: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM issue_dismissed WHERE fingerprint = ? LIMIT 1').get(fingerprint);
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
      agent: normalizeAgent(input.agent),
      riskTier: RISK_TIERS.includes(input.riskTier as RiskTier) ? (input.riskTier as RiskTier) : 'green',
      model: normalizeModel(input.model),
      estimatedMinutes: typeof input.estimatedMinutes === 'number' ? input.estimatedMinutes : null,
      estimatedCostUsd: typeof input.estimatedCostUsd === 'number' ? input.estimatedCostUsd : null,
      prereqIds: Array.isArray(input.prereqIds) ? input.prereqIds : [],
      qaProvider: QA_PROVIDERS_ENABLED.includes(input.qaProvider as QaProvider) ? (input.qaProvider as QaProvider) : 'none',
      qaCommand: normalizeQaCommand(input.qaCommand),
      qaUrl: normalizeQaUrl(input.qaUrl),
      acceptanceCriteria: normalizeCriteria(input.acceptanceCriteria),
      worktreePath: null,
      baseSha: null,
      refinementSessionId: null,
      refinementStartedAt: null,
      appliedAt: null,
      applyMethod: null,
      appliedAutorun: false,
      appliedAdditions: null,
      appliedDeletions: null,
      appliedFiles: null,
      sortOrder: state === 'todo' ? this.nextSortOrder() : 0,
      blockedReason: null,
      sourceUrl: typeof input.sourceUrl === 'string' ? input.sourceUrl : null,
      sourceFingerprint: typeof input.sourceFingerprint === 'string' ? input.sourceFingerprint : null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.prepare(`
      INSERT INTO cards (
        id, title, description, project_id, state, task_type, agent, risk_tier, model,
        estimated_minutes, estimated_cost_usd, prereq_ids, qa_provider, qa_command,
        qa_url, acceptance_criteria, worktree_path, base_sha, sort_order,
        blocked_reason, source_url, source_fingerprint, created_at, updated_at
      ) VALUES (
        @id, @title, @description, @projectId, @state, @taskType, @agent, @riskTier, @model,
        @estimatedMinutes, @estimatedCostUsd, @prereqIds, @qaProvider, @qaCommand,
        @qaUrl, @acceptanceCriteria, @worktreePath, @baseSha, @sortOrder,
        @blockedReason, @sourceUrl, @sourceFingerprint, @createdAt, @updatedAt
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
      ...(patch.agent !== undefined ? { agent: normalizeAgent(patch.agent) } : {}),
      ...(RISK_TIERS.includes(patch.riskTier as RiskTier) ? { riskTier: patch.riskTier as RiskTier } : {}),
      ...(patch.model !== undefined ? { model: normalizeModel(patch.model) } : {}),
      ...(patch.estimatedMinutes !== undefined ? { estimatedMinutes: patch.estimatedMinutes } : {}),
      ...(patch.estimatedCostUsd !== undefined ? { estimatedCostUsd: patch.estimatedCostUsd } : {}),
      ...(Array.isArray(patch.prereqIds) ? { prereqIds: patch.prereqIds } : {}),
      ...(QA_PROVIDERS_ENABLED.includes(patch.qaProvider as QaProvider) ? { qaProvider: patch.qaProvider as QaProvider } : {}),
      ...(patch.qaCommand !== undefined ? { qaCommand: normalizeQaCommand(patch.qaCommand) } : {}),
      ...(patch.qaUrl !== undefined ? { qaUrl: normalizeQaUrl(patch.qaUrl) } : {}),
      ...(Array.isArray(patch.acceptanceCriteria) ? { acceptanceCriteria: normalizeCriteria(patch.acceptanceCriteria) } : {}),
      updatedAt: Date.now(),
    };
    this.db.prepare(`
      UPDATE cards SET
        title = @title, description = @description, project_id = @projectId,
        task_type = @taskType, agent = @agent, risk_tier = @riskTier, model = @model,
        estimated_minutes = @estimatedMinutes,
        estimated_cost_usd = @estimatedCostUsd, prereq_ids = @prereqIds,
        qa_provider = @qaProvider, qa_command = @qaCommand, qa_url = @qaUrl,
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
    // 'blocked' is claimable so the card tile's manual Retry/Restart can run it
    // directly. Autorun still never reaches a blocked card — pickNextCard only
    // returns PICKABLE_RANK states — so this widens the manual path only; the
    // atomic UPDATE's job (no double-claim race) is unchanged.
    const info = this.db.prepare(
      "UPDATE cards SET state = 'claimed', updated_at = ? WHERE id = ? AND state IN ('todo', 'paused', 'rework', 'blocked')",
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

  /**
   * Record the interactive plan-mode session started for a refinement card
   * ("Refine Now"). The session id (a generated UUID) locates the transcript
   * the plan is later extracted from; state is untouched — the card stays in
   * `refinement` until the human queues it.
   */
  setRefinementSession(id: string, sessionId: string): void {
    const now = Date.now();
    this.db.prepare('UPDATE cards SET refinement_session_id = ?, refinement_started_at = ?, updated_at = ? WHERE id = ?')
      .run([sessionId, now, now, id]);
  }

  /** The user removed the worktree from the card — clear the pointer. */
  clearWorktree(id: string): void {
    this.db.prepare('UPDATE cards SET worktree_path = NULL, base_sha = NULL, updated_at = ? WHERE id = ?')
      .run([Date.now(), id]);
  }

  /**
   * Record that the user landed this card's worktree onto the project ("Apply
   * to project"). Captured from values the apply flow already produces (method
   * flags + patch LOC) and frozen here — after the worktree is removed the diff
   * is unrecoverable, so this snapshot is the only durable record. Latest apply
   * wins (a re-apply overwrites). Drives the board's Shipped ribbon and the
   * Overnight Backlog analytics.
   */
  recordApply(
    id: string,
    apply: { method: ApplyMethod; autorun: boolean; additions: number | null; deletions: number | null; files: number | null },
  ): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE cards SET applied_at = ?, apply_method = ?, applied_autorun = ?,
        applied_additions = ?, applied_deletions = ?, applied_files = ?, updated_at = ?
       WHERE id = ?`,
    ).run([now, apply.method, apply.autorun ? 1 : 0, apply.additions, apply.deletions, apply.files, now, id]);
  }

  /**
   * Clear a recorded apply, returning the card to the un-applied state (drops
   * the Shipped ribbon, removes it from the Overnight Backlog aggregates). Used
   * to undo a manual "Mark as applied" mis-click — the IPC layer restricts this
   * to hand-marked cards so a real git-apply snapshot is never silently erased.
   */
  clearApply(id: string): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE cards SET applied_at = NULL, apply_method = NULL, applied_autorun = 0,
        applied_additions = NULL, applied_deletions = NULL, applied_files = NULL, updated_at = ?
       WHERE id = ?`,
    ).run([now, id]);
  }

  /**
   * Aggregate applied execution cards for the Overnight Backlog analytics card.
   * `nowMs` is injected (not read from the clock) so the range cutoff and the
   * per-period buckets are deterministic under test. Served entirely from the
   * backlog DB — no timeline dependency. Costs are ESTIMATED (attempt cost_usd
   * from `claude -p`), never real plan billing.
   */
  getShippedStats(range: BacklogStatsRange, nowMs: number): BacklogStatsPayload {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 365;
    const cutoff = nowMs - days * 86_400_000;
    const g = granularityFor(range);

    const applied = this.db.prepare(
      `SELECT id, project_id, applied_at, apply_method, applied_autorun,
              applied_additions, applied_deletions, applied_files, estimated_minutes
         FROM cards
        WHERE task_type = 'execution' AND applied_at IS NOT NULL AND applied_at >= ?`,
    ).all(cutoff) as {
      id: string; project_id: string; applied_at: number; apply_method: string | null;
      applied_autorun: number; applied_additions: number | null; applied_deletions: number | null;
      applied_files: number | null; estimated_minutes: number | null;
    }[];

    const projectNames = new Map(this.listProjects().map((p) => [p.id, p.name]));

    let shipped = 0, fromAutorun = 0, fromManual = 0, alreadyPresent = 0;
    let minutesLanded = 0, additions = 0, deletions = 0, filesTouched = 0;
    const methodBreakdown = { clean: 0, threeWay: 0, stashed: 0, alreadyPresent: 0, manual: 0 };
    const perDayMap = new Map<string, { autorun: number; manual: number }>();
    const perProjectMap = new Map<string, number>();
    const shippedIds: string[] = [];

    for (const r of applied) {
      switch (r.apply_method) {
        case 'clean': methodBreakdown.clean += 1; break;
        case 'three-way': methodBreakdown.threeWay += 1; break;
        case 'stashed': methodBreakdown.stashed += 1; break;
        case 'already-present': methodBreakdown.alreadyPresent += 1; break;
        case 'manual': methodBreakdown.manual += 1; break;
      }
      // 'already-present' delivered nothing new — count it apart from a real ship.
      if (r.apply_method === 'already-present') { alreadyPresent += 1; continue; }

      shipped += 1;
      shippedIds.push(r.id);
      const auto = r.applied_autorun === 1;
      if (auto) fromAutorun += 1; else fromManual += 1;
      minutesLanded += r.estimated_minutes ?? 0;
      additions += r.applied_additions ?? 0;
      deletions += r.applied_deletions ?? 0;
      filesTouched += r.applied_files ?? 0;

      const key = bucketKey(r.applied_at, g);
      const bucket = perDayMap.get(key) ?? { autorun: 0, manual: 0 };
      if (auto) bucket.autorun += 1; else bucket.manual += 1;
      perDayMap.set(key, bucket);

      perProjectMap.set(r.project_id, (perProjectMap.get(r.project_id) ?? 0) + 1);
    }

    // Estimated cost of shipped work: total attempt spend across the shipped cards.
    let costUsdLanded = 0;
    if (shippedIds.length > 0) {
      const placeholders = shippedIds.map(() => '?').join(',');
      const row = this.db.prepare(
        `SELECT COALESCE(SUM(cost_usd), 0) AS c FROM attempts WHERE card_id IN (${placeholders})`,
      ).get(...shippedIds) as { c: number };
      costUsdLanded = row.c ?? 0;
    }

    // Denominator (range-bound by updated_at) + a current, all-time backlog of
    // done-but-unapplied diffs the user still needs to review.
    const doneUnappliedInRange = (this.db.prepare(
      `SELECT COUNT(*) AS n FROM cards
        WHERE task_type = 'execution' AND state = 'done'
          AND worktree_path IS NOT NULL AND applied_at IS NULL AND updated_at >= ?`,
    ).get(cutoff) as { n: number }).n;
    const awaitingReview = (this.db.prepare(
      `SELECT COUNT(*) AS n FROM cards
        WHERE task_type = 'execution' AND state = 'done'
          AND worktree_path IS NOT NULL AND applied_at IS NULL`,
    ).get() as { n: number }).n;

    const doneWithDiff = shipped + doneUnappliedInRange;
    const shipRatePct = doneWithDiff > 0 ? Math.round((shipped / doneWithDiff) * 100) : 0;

    const perDay = bucketKeysInRange(cutoff, nowMs, g).map((date) => ({
      date,
      autorun: perDayMap.get(date)?.autorun ?? 0,
      manual: perDayMap.get(date)?.manual ?? 0,
    }));

    const perProject = [...perProjectMap.entries()]
      .map(([projectId, s]) => ({ projectId, name: projectNames.get(projectId) ?? 'Unknown project', shipped: s }))
      .sort((a, b) => b.shipped - a.shipped);

    // Task-type mix for the donut. Population = cards the planner actually
    // worked on in this window (≥1 attempt started in range); per-group cost =
    // estimated attempt spend within the window. Shipped stays as computed
    // above (applied_at in range), and we clamp execution ≥ shipped so the
    // inner "shipped" arc is always a subset of the execution slice — even in
    // the rare case a shipped card's only run predates the window.
    const mixRows = this.db.prepare(
      `SELECT c.task_type AS tt,
              COUNT(DISTINCT c.id) AS n,
              COALESCE(SUM(a.cost_usd), 0) AS cost
         FROM cards c
         JOIN attempts a ON a.card_id = c.id AND a.started_at >= ?
        WHERE c.task_type IN ('research', 'execution')
        GROUP BY c.task_type`,
    ).all(cutoff) as { tt: string; n: number; cost: number }[];

    let researchCount = 0, researchCost = 0, executionCount = 0, executionCost = 0;
    for (const r of mixRows) {
      if (r.tt === 'research') { researchCount = r.n; researchCost = r.cost; }
      else if (r.tt === 'execution') { executionCount = r.n; executionCost = r.cost; }
    }
    executionCount = Math.max(executionCount, shipped);

    const taskMix = {
      research: { count: researchCount, costUsd: researchCost },
      execution: { count: executionCount, costUsd: executionCost },
      shipped: { count: shipped, costUsd: costUsdLanded },
      totalCostUsd: researchCost + executionCost,
    };

    return {
      range, shipped, fromAutorun, fromManual, alreadyPresent,
      doneWithDiff, awaitingReview, shipRatePct,
      minutesLanded, costUsdLanded, additions, deletions, filesTouched,
      methodBreakdown, perDay, perProject, taskMix, queriedAt: nowMs,
    };
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
      inputTokens: null,
      outputTokens: null,
      manual,
    };
    this.db.prepare(`
      INSERT INTO attempts (id, card_id, started_at, ended_at, outcome, reason, cost_usd, num_turns, session_id, input_tokens, output_tokens, manual)
      VALUES (@id, @cardId, @startedAt, @endedAt, @outcome, @reason, @costUsd, @numTurns, @sessionId, @inputTokens, @outputTokens, @manual)
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
      inputTokens?: number | null;
      outputTokens?: number | null;
    },
  ): void {
    this.db.prepare(`
      UPDATE attempts SET ended_at = ?, outcome = ?, reason = ?, cost_usd = ?, num_turns = ?, session_id = ?,
        input_tokens = ?, output_tokens = ?
      WHERE id = ?
    `).run([
      Date.now(), result.outcome, result.reason ?? null,
      result.costUsd ?? null, result.numTurns ?? null, result.sessionId ?? null,
      result.inputTokens ?? null, result.outputTokens ?? null, id,
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
      numTurns: r.num_turns, sessionId: r.session_id,
      inputTokens: r.input_tokens ?? null, outputTokens: r.output_tokens ?? null,
      manual: r.manual === 1,
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

// Backlog board + Backlog Scheduler (Phase 1: research tasks; Phase 2:
// execution tasks in isolated worktrees). Shared between the main process
// (engine, store, runner) and the renderer (board tab, scheduler section) —
// like SchedulerStatus in types.ts. See backlog.md for the product spec.

export type BacklogCardState =
  | 'refinement'   // raw idea, not yet runnable
  | 'todo'         // refined & queued; sortable; autorun source
  | 'claimed'      // transient: atomically claimed, about to spawn
  | 'in-progress'  // executor running
  | 'done'         // report attached (research) / diff + QA report (execution)
  | 'blocked'      // run failed / can't proceed; needs human attention
  | 'rework'       // execution succeeded but QA failed; auto-retries once
  | 'paused';      // killed at window end / budget / usage limit; re-runs next window

// Only green autoruns; amber/red are manual "Run now" only in Phase 1.
export type RiskTier = 'green' | 'amber' | 'red';

// 'browser' stays disabled until the browser-QA phase; the rest are live in
// Phase 2 for execution cards (QA runs as an engine-driven command, not agent
// Bash — see qa.ts).
export type QaProvider = 'browser' | 'tests' | 'lint' | 'typecheck' | 'custom' | 'none';

// Phase 2: research cards keep the Phase 1 read-only path; execution cards run
// with Write/Edit in a detached git worktree and deliver an uncommitted diff.
export type BacklogTaskType = 'research' | 'execution';

export interface BacklogProject {
  id: string;          // uuid
  name: string;        // basename of path by default, editable
  path: string;        // absolute repo folder — the executor's cwd
  createdAt: number;
}

export interface BacklogCard {
  id: string;                      // uuid
  title: string;
  description: string;
  projectId: string;
  state: BacklogCardState;
  taskType: BacklogTaskType;       // research = read-only report; execution = code edits in a worktree
  riskTier: RiskTier;
  model: string | null;            // claude model id/alias for runs; null = project default
  estimatedMinutes: number | null; // drives size-fit + hard time budget
  estimatedCostUsd: number | null; // drives the forecast glance
  prereqIds: string[];             // card ids that must be done first
  qaProvider: QaProvider;          // execution cards only; research ignores it
  qaCommand: string | null;        // command line for qaProvider 'custom'
  acceptanceCriteria: string[];    // injected into the prompt; not machine-checked in Phase 2
  worktreePath: string | null;     // execution: detached worktree dir (userData/backlog-worktrees/<id>)
  baseSha: string | null;          // execution: HEAD the worktree was created at
  sortOrder: number;               // position within Todo
  blockedReason: string | null;
  createdAt: number;
  updatedAt: number;
}

// A card's model travels as a `--model` argv entry, which on Windows goes
// through `cmd.exe /c` where no quoting-safe escape exists — so anything
// beyond a strict id/alias charset is rejected (store nulls it, runner skips
// it). Covers aliases ('sonnet'), full ids ('claude-sonnet-4-6'), and
// bracket-suffixed ids ('claude-fable-5[1m]').
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._[\]-]*$/;
const MODEL_ID_MAX_LENGTH = 100;

export function isSafeModelId(value: string): boolean {
  return value.length > 0 && value.length <= MODEL_ID_MAX_LENGTH && MODEL_ID_RE.test(value);
}

/**
 * Prereqs not yet satisfied: every prereq id must reference a Done card.
 * Ids pointing at deleted cards are ignored rather than blocking forever.
 * Shared by the picker (main) and the board's "waiting on prereq" badge
 * (renderer) so both sides agree on what "runnable" means.
 */
export function countUnmetPrereqs(
  card: Pick<BacklogCard, 'prereqIds'>,
  cards: Pick<BacklogCard, 'id' | 'state'>[],
): number {
  if (card.prereqIds.length === 0) return 0;
  const stateById = new Map(cards.map((c) => [c.id, c.state]));
  return card.prereqIds.filter((id) => stateById.has(id) && stateById.get(id) !== 'done').length;
}

// 'qa-failed': the run itself succeeded but the QA command failed — distinct
// from 'failed' so the QA-fail escalation streak never mixes with run failures,
// and from 'killed' so it never trips the budget-kill escalation.
// 'no-changes': an execution run finished cleanly but the worktree diff was
// empty — nothing was delivered, so it must never read as a green success.
// 'blocked': the agent reported it could not proceed (STATUS: blocked). Both
// new outcomes route the card to the 'blocked' state for a human rather than
// silently going Done — see engine.finalizeSuccess.
export type BacklogAttemptOutcome =
  | 'success' | 'failed' | 'paused' | 'killed' | 'qa-failed' | 'no-changes' | 'blocked';

export interface BacklogAttempt {
  id: string;
  cardId: string;
  startedAt: number;
  endedAt: number | null;
  outcome: BacklogAttemptOutcome | null; // null while running
  reason: string | null;                 // failure/kill detail
  costUsd: number | null;                // total_cost_usd from claude -p JSON
  numTurns: number | null;
  sessionId: string | null;              // claude session id (future --resume)
  manual: boolean;                       // true for "Run now"
}

// report = markdown (research report, or the executor's change summary);
// diff = staged patch of the worktree (git diff --cached --binary + untracked
// listing); qa-report = QA command output with pass/fail verdict.
export type BacklogArtifactKind = 'report' | 'diff' | 'qa-report';

export interface BacklogArtifact {
  id: string;
  cardId: string;
  attemptId: string;
  kind: BacklogArtifactKind;
  path: string;      // absolute path under userData/backlog-artifacts
  preview: string;   // first ~500 chars for board rendering
  createdAt: number;
}

// Card attachments: text files attached to a card and inlined verbatim into the
// executor prompt. This lets a card carry context that isn't committed to the
// repo — the exact gap that makes an untracked plan file invisible to the
// detached execution worktree. Stored as durable copies (content in the DB),
// so they survive edits/deletion of the source file.
export const ATTACHMENT_MAX_FILE_BYTES = 256 * 1024;   // per file
export const ATTACHMENT_MAX_TOTAL_BYTES = 512 * 1024;  // summed across a card
export const ATTACHMENT_MAX_COUNT = 10;

// List/UI payload — content is fetched separately (only the engine needs it, at
// prompt-build time), so the board and editor never carry the full text around.
export interface BacklogAttachment {
  id: string;
  cardId: string;
  filename: string;
  bytes: number;      // UTF-8 byte length of the content
  createdAt: number;
}

// A file the user just picked but hasn't persisted yet — content travels over
// IPC once, on save.
export interface PendingAttachment {
  filename: string;
  content: string;
  bytes: number;
}

// The desired final attachment set for a card, sent on save: keep these existing
// rows (by id), add these newly-picked files. Anything not in `keepIds` is
// deleted. Replace-all semantics keep create and edit paths identical.
export interface AttachmentIntent {
  keepIds: string[];
  add: PendingAttachment[];
}

// Quick-task templates: pre-written prompts that pre-fill a new card.
// Editable list persisted in user-config, seeded from backlog.md.
export interface BacklogTemplate {
  id: string;
  name: string;        // shown in the picker, e.g. "Update README"
  title: string;       // pre-fills card title
  description: string; // pre-fills card description
}

// ─── Scheduler config (persisted in user-config.ts, sibling of SchedulerConfig) ──

// A backlog slot is a time RANGE (the Cowork slot is a fire instant): the
// hours during which queued cards are allowed to auto-execute.
export interface BacklogSlot {
  start: string;    // 'HH:mm' local
  end: string;      // 'HH:mm' local — end <= start wraps past midnight
  days: number[];   // 0=Sun … 6=Sat — the day the slot STARTS
  enabled: boolean; // disable a row without deleting it
}

export interface BacklogSchedulerConfig {
  enabled: boolean;
  slots: BacklogSlot[];
  requireIdle: boolean;    // only claim when no input for K min, even inside a slot
  maxConcurrent: number;   // fixed at 1 in Phase 1 (migration clamps it)
}

// ─── Live status broadcast to the renderer ───────────────────────────────────

export interface BacklogSchedulerStatus {
  enabled: boolean;
  windowActive: boolean;
  windowEndsAt: number | null;      // set when windowActive
  nextWindowStartAt: number | null;
  runningCardId: string | null;
  runningCardTitle: string | null;
  runningAttemptStartedAt: number | null;
  waitingForIdle: boolean;          // inside a window, gated on requireIdle
  queueReady: number;               // green todo/paused/rework cards, prereqs met
  // Usage latch: auto-claims suspended until this time because the Claude
  // 5-hour window is exhausted. Manual Run-now still works.
  usagePausedUntil: number | null;
  lastRun: {
    at: number;
    cardId: string;
    cardTitle: string;
    outcome: BacklogAttemptOutcome;
  } | null;
  // "Queue will burn ~$X in the next window (N cards fit)."
  forecast: { windowStartAt: number; cardCount: number; totalCostUsd: number } | null;
}

// Single hydration payload for the board tab (backlog:get-state).
export interface BacklogState {
  available: boolean;   // false when the SQLite store failed to load
  reason?: string;
  projects: BacklogProject[];
  cards: BacklogCard[];
  templates: BacklogTemplate[];
  status: BacklogSchedulerStatus | null;
}

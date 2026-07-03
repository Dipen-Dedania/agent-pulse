// Backlog board + Backlog Scheduler (Phase 1: research tasks only).
// Shared between the main process (engine, store, runner) and the renderer
// (board tab, scheduler section) — like SchedulerStatus in types.ts.
// See backlog.md for the product spec; Phase 1 scope is at the bottom.

export type BacklogCardState =
  | 'refinement'   // raw idea, not yet runnable
  | 'todo'         // refined & queued; sortable; autorun source
  | 'claimed'      // transient: atomically claimed, about to spawn
  | 'in-progress'  // executor running
  | 'done'         // report attached
  | 'blocked'      // run failed / can't proceed; needs human attention
  | 'paused';      // killed at window end / budget; re-runs next window

// Only green autoruns; amber/red are manual "Run now" only in Phase 1.
export type RiskTier = 'green' | 'amber' | 'red';

// Present-but-disabled in Phase 1 UI (schema keeps them for the execution phase).
export type QaProvider = 'browser' | 'tests' | 'lint' | 'typecheck' | 'custom' | 'none';

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
  riskTier: RiskTier;
  model: string | null;            // claude model id/alias for runs; null = project default
  estimatedMinutes: number | null; // drives size-fit + hard time budget
  estimatedCostUsd: number | null; // drives the forecast glance
  prereqIds: string[];             // card ids that must be done first
  qaProvider: QaProvider;          // stored, always 'none' in Phase 1 (UI disabled)
  acceptanceCriteria: string[];    // stored, empty in Phase 1 (UI disabled)
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

export type BacklogAttemptOutcome = 'success' | 'failed' | 'paused' | 'killed';

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

export interface BacklogArtifact {
  id: string;
  cardId: string;
  attemptId: string;
  kind: 'report';    // Phase 1: markdown research report only
  path: string;      // absolute path under userData/backlog-artifacts
  preview: string;   // first ~500 chars for board rendering
  createdAt: number;
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
  queueReady: number;               // green Todo cards + paused re-runs
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

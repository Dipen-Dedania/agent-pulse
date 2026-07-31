// Backlog board + Backlog Scheduler (Phase 1: research tasks; Phase 2:
// execution tasks in isolated worktrees). Shared between the main process
// (engine, store, runner) and the renderer (board tab, scheduler section) —
// like SchedulerStatus in types.ts. See backlog.md for the product spec.

// Type-only import (erased at compile) so the shared webhook shape can be
// reused for backlog completion pings without a runtime dependency cycle.
import type { WebhookTarget } from './types';

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

// How an execution card's worktree diff landed on the project when the user
// applied it. 'already-present' means the reverse-apply check found every hunk
// already in the tree — nothing new was delivered, so it's counted apart from a
// real ship. 'manual' means the user marked the card applied by hand (the diff
// landed outside Agent Pulse, e.g. their own git merge/commit) — a real ship,
// but with no LOC snapshot since the worktree is typically already gone. The
// git-driven variants mirror the flags returned by worktree.ts → ApplyResult.
export type ApplyMethod = 'clean' | 'three-way' | 'stashed' | 'already-present' | 'manual';

// 'browser' stays disabled until the browser-QA phase; the rest are live in
// Phase 2 for execution cards (QA runs as an engine-driven command, not agent
// Bash — see qa.ts).
export type QaProvider = 'browser' | 'tests' | 'lint' | 'typecheck' | 'custom' | 'none';

// Phase 2: research cards keep the Phase 1 read-only path; execution cards run
// with Write/Edit in a detached git worktree and deliver an uncommitted diff.
// 'qa': research's read-only pipeline + chrome-devtools-mcp browser tools — the
// agent opens the card's qaUrl, checks each acceptance criterion against the
// live UI, and delivers a report + evidence screenshots. Changes nothing.
export type BacklogTaskType = 'research' | 'execution' | 'qa';

// Issue population (Phase 3). Which open issues a scan pulls for a linked
// project. Shared by every provider (GitLab, Linear). See
// backlog-phase3-gitlab-population-plan.md.
export type IssueFilterMode = 'assigned' | 'all' | 'label';

export interface IssueFilter {
  mode: IssueFilterMode;
  labels: string[]; // used when mode === 'label'
}

// Which external system a project pulls issues from. One source per project.
export type IssueSourceKind = 'gitlab' | 'linear';

// A Linear team, the unit a project links to. Surfaced by the link-time picker
// (the Linear scout's list_teams) and passed back on link.
export interface LinearTeam {
  id: string;    // uuid — the stable link key (stored as source.ref)
  key?: string;  // e.g. 'DEV' — display only; list_teams no longer returns it
  name: string;  // e.g. 'Development'
}

// A Linear project within a team — the optional narrowing step at link time. If
// the workspace runs one Linear project per repo, picking one here scopes scans
// to just that repo's issues instead of the whole team's backlog (stored as
// source.scopeRef / scopeName; the Linear list_issues `project` filter param).
export interface LinearProject {
  id: string;   // uuid — the list_issues `project` filter value
  name: string; // e.g. 'Being website rebuild'
}

// A project's resolved link to an external issue source. `ref` is the stable
// key (GitLab numeric project id as text; Linear team id); `slug`/`name` are
// display-facing (GitLab 'group/sub/project'; Linear team key 'DEV' / name).
// `scopeRef`/`scopeName` are an optional, provider-interpreted narrowing within
// `ref` — for Linear, a project id + name that scopes scans to one project;
// unused by GitLab. They never affect dedup (the fingerprint keys on `ref`).
export interface IssueSourceLink {
  kind: IssueSourceKind;
  ref: string;
  host: string | null; // GitLab host (self-managed support); null for Linear
  slug: string;
  name: string;
  scopeRef?: string;   // Linear project id; undefined = whole team
  scopeName?: string;  // Linear project name (display)
}

export interface BacklogProject {
  id: string;          // uuid
  name: string;        // basename of path by default, editable
  path: string;        // absolute repo folder — the executor's cwd
  createdAt: number;
  // Issue-source link (Phase 3). null until the user links this project to a
  // GitLab project (via its `origin` remote) or a Linear team (via a picker).
  source: IssueSourceLink | null;
  issueFilter: IssueFilter;
  sourceLastScanAt: number | null;
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
  qaProvider: QaProvider;          // execution cards only; research/qa ignore it
  qaCommand: string | null;        // command line for qaProvider 'custom'
  qaUrl: string | null;            // qa cards: the running app URL the agent opens
  acceptanceCriteria: string[];    // execution: prompt checklist; qa: agent-checked per criterion
  worktreePath: string | null;     // execution: detached worktree dir (userData/backlog-worktrees/<id>)
  baseSha: string | null;          // execution: HEAD the worktree was created at
  refinementSessionId: string | null; // interactive plan-mode session id (claude --session-id)
  refinementStartedAt: number | null; // when "Refine Now" launched the plan session
  // Apply tracking (execution cards): set the first time the user lands this
  // card's worktree onto the project. Drives the board's "Shipped" ribbon and
  // the Overnight Backlog analytics. All null until applied; captured from
  // values the apply flow already produces (see worktree.ts).
  appliedAt: number | null;            // when the diff was applied to the project
  applyMethod: ApplyMethod | null;     // how it landed (clean / 3-way / stashed / already-present)
  appliedAutorun: boolean;             // true = the diff came from an unattended autorun (the "overnight" signal)
  appliedAdditions: number | null;     // LOC snapshot: inserted lines, frozen at apply time
  appliedDeletions: number | null;     // LOC snapshot: deleted lines
  appliedFiles: number | null;         // files the applied patch touched
  sortOrder: number;               // position within Todo
  blockedReason: string | null;
  // Provenance for auto-populated cards (Phase 3); null for hand-authored ones.
  // sourceFingerprint is the dedup key, e.g. 'gitlab:<projectId>:<iid>'.
  sourceUrl: string | null;
  sourceFingerprint: string | null;
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

// report = markdown (research report, the executor's change summary, or a QA
// card's verification report); diff = staged patch of the worktree (git diff
// --cached --binary + untracked listing); qa-report = QA command output with
// pass/fail verdict; screenshot = PNG evidence saved by a QA card's browser
// (written by chrome-devtools-mcp via take_screenshot filePath, swept into
// artifacts by the engine after the run).
export type BacklogArtifactKind = 'report' | 'diff' | 'qa-report' | 'screenshot';

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
  // Proactive usage gate: don't claim a new card once the Claude 5-hour window
  // is at/above this % — a run that would just die mid-task. 100 = never gate
  // proactively (only the reactive latch stops runs when the window is truly
  // spent). Clamped to 50–100 by migration.
  usageGatePercent: number;
  maxConcurrent: number;   // fixed at 1 in Phase 1 (migration clamps it)
  // Discord/Slack webhooks pinged when a card settles into a terminal state
  // (done / blocked / rework). Independent of the attention-escalation list so
  // task-completion pings can route to their own channel. Empty = no pings.
  webhooks: WebhookTarget[];
}

// ─── Issue population (Phase 3) ──────────────────────────────────────────────

// An external issue surfaced by a scan but not yet imported or dismissed — the
// backing row for the Review & Import picker. `ref` is the provider's human
// key (GitLab iid '54'; Linear identifier 'DEV-1036'). fingerprint is
// 'gitlab:<projectId>:<iid>' or 'linear:<teamId>:<identifier>'.
export interface IssueCandidate {
  fingerprint: string;
  projectId: string;
  sourceKind: IssueSourceKind;
  ref: string;
  title: string;
  description: string;
  webUrl: string;
  labels: string[];
  fetchedAt: number;
}

// Persisted in user-config (sibling of BacklogSchedulerConfig). Governs issue
// population for every provider. `scoutModel` defaults to a cheap model; the
// config migration validates it via isSafeModelId and falls back to the default.
export interface BacklogPopulationConfig {
  enabled: boolean;
  defaultFilterMode: IssueFilterMode; // seeds a newly-linked project's filter
  scoutModel: string;                 // e.g. 'claude-haiku-4-5'
  backgroundRefresh: boolean;         // low-frequency badge refresh
  refreshIntervalMinutes: number;     // used when backgroundRefresh is on
}

// Live population state shipped in the board hydrate (BacklogState.population).
// connector is the verdict of the last scan (D8/D9); 'unknown' before any scan.
export interface IssuePopulationState {
  candidates: IssueCandidate[];
  connector: 'connected' | 'needs-auth' | 'unknown';
  scanning: boolean;
  lastScanAt: number | null;
  lastReason: string | null; // a human hint when the last scan failed / was skipped
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

// ─── Overnight Backlog analytics (backlog:get-stats) ─────────────────────────
// Aggregates over applied execution cards, served from the backlog DB (NOT the
// timeline DB) so a corrupt analytics store never affects it. All costs are
// estimated API list prices, never real plan billing — same posture as the
// timeline analytics.

// Range union kept identical to the timeline's TimelineRange literals so the
// shared Analytics range filter drives this card too, without backlog-types
// importing from timeline-types.
export type BacklogStatsRange = '7d' | '30d' | '90d' | '1y';

// One local day of shipped cards, split by how the diff was produced.
export interface BacklogShippedDayBucket {
  date: string;      // 'YYYY-MM-DD' local
  autorun: number;   // shipped diffs produced by an unattended autorun
  manual: number;    // shipped diffs produced by a "Run now"
}

export interface BacklogShippedProjectBucket {
  projectId: string;
  name: string;
  shipped: number;
}

export interface BacklogStatsPayload {
  range: BacklogStatsRange;
  shipped: number;            // applied execution cards in range (excludes already-present)
  fromAutorun: number;        // subset produced by autorun — "shipped overnight by the planner"
  fromManual: number;         // subset produced by "Run now"
  alreadyPresent: number;     // applies that were no-ops (diff already in the tree)
  doneWithDiff: number;       // range denominator: execution cards that produced a reviewable diff
  awaitingReview: number;     // current: done execution cards with a diff, not yet applied
  shipRatePct: number;        // shipped / doneWithDiff × 100 (0 when denominator is 0)
  minutesLanded: number;      // Σ estimatedMinutes of shipped cards
  costUsdLanded: number;      // Σ attempt cost of shipped cards (ESTIMATED list price)
  additions: number;          // Σ applied additions across shipped cards
  deletions: number;          // Σ applied deletions
  filesTouched: number;       // Σ applied file counts
  methodBreakdown: { clean: number; threeWay: number; stashed: number; alreadyPresent: number; manual: number };
  perDay: BacklogShippedDayBucket[];       // ascending by date, gap-filled
  perProject: BacklogShippedProjectBucket[]; // descending by shipped
  queriedAt: number;
}

// Single hydration payload for the board tab (backlog:get-state).
export interface BacklogState {
  available: boolean;   // false when the SQLite store failed to load
  reason?: string;
  projects: BacklogProject[];
  cards: BacklogCard[];
  templates: BacklogTemplate[];
  status: BacklogSchedulerStatus | null;
  population: IssuePopulationState;
}

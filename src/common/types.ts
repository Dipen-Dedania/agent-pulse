export type ToolId = 'claude-code' | 'cursor' | 'vscode-copilot' | 'openai-codex' | 'kiro' | 'antigravity-cli';
export type AgentState = 'working' | 'waiting' | 'idle' | 'idle-active' | 'error';

// ─── Bubble appearance & behavior ────────────────────────────────────────────
// User-tunable look/feel of the status bubbles. Persisted in user-config and
// shared between the main process (window sizing/placement) and the renderer
// (orb scaling + inactivity chime). Kept in src/common so both sides agree on
// the exact string unions.

// Three discrete bubble sizes. The pixel dimensions live wherever they're
// consumed (BubbleManager for the window, Bubble.tsx for the orb).
export type BubbleSize = 'small' | 'medium' | 'large';

// Which screen corner the bubble stack anchors to. Bubbles grow toward the
// vertical center from whichever corner is chosen.
export type BubbleStackPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

// Where the user last dragged the stack: the top-of-stack bubble's window
// position in global DIP coordinates (so it lands on whichever monitor it was
// dragged to). Overrides stackPosition while set; cleared when the user picks
// a corner preset in Settings. If the monitor it lived on is unplugged, the
// stack clamps onto the nearest remaining display rather than vanishing.
export interface BubbleAnchor {
  x: number;
  y: number;
}

// Sound played when a bubble flips into the "waiting for input" state. 'pop'
// is the bundled wav; the rest are synthesized in the renderer; 'none' is silent.
export type BubbleSoundId = 'pop' | 'chime' | 'ding' | 'marimba' | 'none';

// Backdrop behind the orb. 'glass' keeps the frosted, state-tinted gradient
// (default). 'solid' paints `fillColor` opaquely so logos stay legible against
// busy/dark desktops (e.g. Cursor's black icon over a dark VS Code window).
export type BubbleFillMode = 'glass' | 'solid';

// Durable identity for the chosen monitor. Electron display ids are NOT
// stable across reboots (macOS regenerates CGDirectDisplayIDs), so the id
// alone "forgets" the user's monitor on restart. The OS label + bounds let
// BubbleManager re-find the same physical screen and heal the stale id.
export interface BubbleDisplayMatch {
  label: string;  // OS monitor name, e.g. "DELL U2720Q"; may be empty
  bounds: { x: number; y: number; width: number; height: number };
}

export interface BubbleConfig {
  size: BubbleSize;
  stackPosition: BubbleStackPosition;
  anchor: BubbleAnchor | null; // drag-placed stack position; null → use stackPosition
  displayId: number | null;   // monitor for corner presets; null → primary. Ignored while anchor is set (the anchor point already encodes its monitor). If the display is unplugged, falls back to primary.
  displayMatch: BubbleDisplayMatch | null; // reboot-stable fallback identity for displayId; stamped by the main process when the user picks a monitor
  sound: BubbleSoundId;
  fillMode: BubbleFillMode;
  fillColor: string;          // CSS color used when fillMode === 'solid' (e.g. '#ffffff')
}

// Snapshot of a connected monitor, sent main → renderer for the Settings
// display picker (Electron's Display object isn't structured-clonable as-is).
export interface DisplayInfo {
  id: number;
  label: string;       // OS-provided name, e.g. "DELL U2720Q"; may be empty
  bounds: { x: number; y: number; width: number; height: number };
  primary: boolean;
}

// ─── "Needs you" attention escalation ────────────────────────────────────────
// When a tool stays in the `waiting` state (agent finished, blocked on the
// user) longer than `escalateAfterSeconds`, Agent Pulse escalates: it
// intensifies the bubble animation and POSTs to the user's chat webhook(s).
// Notify-once per waiting episode; clicking the bubble acknowledges it.

export type WebhookKind = 'discord' | 'slack';

export interface WebhookTarget {
  id: string;        // stable key for list rendering + delete
  kind: WebhookKind;
  label?: string;    // optional user note, e.g. "team channel"
  url: string;
  enabled: boolean;
}

export interface AttentionConfig {
  enabled: boolean;             // master switch
  escalateAfterSeconds: number; // delay in `waiting` before escalating (floor enforced)
  intensifyBubble: boolean;     // visual escalation on the bubble
  osNotification: boolean;      // also fire a native OS notification (default off)
  webhooks: WebhookTarget[];
}

// Content for the rich hover tooltip rendered in a dedicated overlay window
// (the bubble window is too small to host it). Sent from the bubble renderer
// to the main process, which positions the overlay and forwards the payload.
export interface BubbleTooltipPayload {
  title: string;        // tool label, e.g. "Claude Code"
  subtitle?: string;    // state · agents · last-seen
  lines: string[];      // usage / scheduler / task detail rows
  accent?: string;      // rgba glow for the title status dot
}

export interface NormalizedEvent {
  toolId: ToolId;
  state: AgentState;
  timestamp: number;
  payload: {
    sessionId?: string;
    taskSummary?: string;
    activeAgents?: number;
    errorMessage?: string;
    cwd?: string;
    agentPid?: number;
    // Ancestor PID chain captured at hook time. The agent's immediate parent
    // is often a short-lived shim (cmd.exe /C wrapper, transient launcher)
    // that dies before the user clicks the bubble; the rest of the chain
    // contains longer-lived ancestors we can still focus.
    agentPidChain?: number[];
    transcriptPath?: string;
    model?: string;
  };
}

export interface ToolStatus {
  toolId: ToolId;
  state: AgentState;
  lastUpdated: number;
  activeAgents: number;
  currentTask?: string;
  // Latest agent PID reported by a hook for this tool. Sticky across state
  // changes (we keep the last-known until a new hook overwrites it) so the
  // bubble can request a window focus even after the agent goes idle.
  agentPid?: number;
  // Latest ancestor PID chain reported by a hook. Same stickiness rule as
  // agentPid; lets the focus path survive shim death (see NormalizedEvent).
  agentPidChain?: number[];
}

// ─── Claude Code subscription usage ──────────────────────────────────────────
// Sourced from Anthropic's undocumented OAuth usage endpoint.
// `resetsAt` is Unix epoch milliseconds (normalized from the endpoint's
// number-or-ISO-string format by parseUsageResponse).

export interface UsageWindow {
  utilization: number; // 0–100
  resetsAt: number;    // ms epoch
}

export interface UsageSnapshot {
  fiveHour: UsageWindow;
  sevenDay: UsageWindow;
}

export type UsageState =
  | 'ok'              // Have a fresh snapshot.
  | 'unknown'         // Never polled successfully yet.
  | 'unauthenticated' // 401 or missing credentials — polling paused.
  | 'unavailable'     // Endpoint moved / shape unrecognised.
  | 'rate-limited'    // 429 — backing off.
  | 'network-error';  // Transient — still polling.

// Per-window flag indicating the "use it or lose it" nudge is currently
// active (remaining credit ≥ threshold AND reset is imminent). The bubble
// badge mirrors this; once the user acts (utilization rises) or the window
// resets, the flag clears.
export interface UsageNudgeFlags {
  fiveHour: boolean;
  sevenDay: boolean;
}

export interface UsageStatus {
  state: UsageState;
  snapshot?: UsageSnapshot;
  lastUpdated?: number; // ms epoch of last successful poll
  message?: string;     // user-facing detail for non-ok states
  nudgeActive?: UsageNudgeFlags;
}

// ─── Codex (ChatGPT) subscription usage ──────────────────────────────────────
// Sourced from ChatGPT's undocumented /backend-api/wham/usage endpoint.
// Codex exposes a `primary_window` (always present) plus an optional
// `secondary_window`. The bubble renders one bar per window that exists.

export interface CodexUsageSnapshot {
  primary: UsageWindow;
  secondary?: UsageWindow;
}

export interface CodexUsageNudgeFlags {
  primary: boolean;
  secondary: boolean;
}

export interface CodexUsageStatus {
  state: UsageState;
  snapshot?: CodexUsageSnapshot;
  lastUpdated?: number;
  message?: string;
  nudgeActive?: CodexUsageNudgeFlags;
}

// ─── Cursor subscription usage ───────────────────────────────────────────────
// Sourced from Cursor's undocumented /api/usage-summary endpoint, authenticated
// with the WorkosCursorSessionToken built from the access token Cursor stores in
// its local SQLite DB (…/Cursor/User/globalStorage/state.vscdb). Unlike Claude/
// Codex (rolling rate-limit windows), Cursor is a single BILLING-CYCLE quota:
// `utilization` is the % of the plan consumed and `resetsAt` is the cycle end.
// We reuse UsageWindow so the bubble bar + tooltip render the same as the others.

export interface CursorUsageSnapshot {
  plan: UsageWindow;          // utilization = totalPercentUsed, resetsAt = billingCycleEnd
  membershipType?: string;    // "free" | "pro" | "business" | …
  used?: number;
  limit?: number;             // 0 / null upstream → treated as unlimited
  remaining?: number;
  breakdown?: { included: number; bonus: number; total: number };
  onDemandEnabled?: boolean;
}

export interface CursorUsageNudgeFlags {
  plan: boolean;
}

export interface CursorUsageStatus {
  state: UsageState;
  snapshot?: CursorUsageSnapshot;
  lastUpdated?: number;
  message?: string;
  nudgeActive?: CursorUsageNudgeFlags;
}

// ─── GitHub Copilot usage ────────────────────────────────────────────────────
// Two-tier source (see memory `copilot-usage-source`):
//   - METADATA (always, no network/keychain): signed-in username + SKU read from
//     VS Code's local state.vscdb (`github.copilot-github`, copilotSku keys) —
//     same SQLite/ItemTable shape Cursor uses.
//   - LIVE QUOTA (opt-in, off by default): GET api.github.com/copilot_internal/user
//     with the gho_ OAuth token read from the OS keychain. Returns monthly
//     quota_snapshots for chat / completions / premium_interactions. Undocumented
//     ("official clients only" per GitHub) — hence the explicit opt-in.
// Each quota maps to one monthly-cycle window: utilization = 100 − percent_remaining,
// resetsAt = quota_reset_date_utc. We reuse the same bar/tooltip visuals as the others.

export interface CopilotQuotaWindow {
  key: 'chat' | 'completions' | 'premium_interactions';
  label: string;            // user-facing, e.g. "Chat"
  utilization: number;      // 0–100 (= 100 − percent_remaining)
  remaining: number;
  entitlement: number;      // monthly allowance
  unlimited: boolean;
  resetsAt: number;         // ms epoch (monthly reset)
}

export interface CopilotUsageSnapshot {
  username?: string;
  sku?: string;             // e.g. "free_limited_copilot"
  quotas: CopilotQuotaWindow[];   // only windows with entitlement > 0 or unlimited
  source: 'live' | 'metadata-only';
}

export interface CopilotUsageNudgeFlags {
  chat: boolean;
  completions: boolean;
}

export interface CopilotUsageStatus {
  state: UsageState;
  snapshot?: CopilotUsageSnapshot;
  lastUpdated?: number;
  message?: string;
  nudgeActive?: CopilotUsageNudgeFlags;
}

// ─── Antigravity IDE subscription usage ──────────────────────────────────────
// Sourced from the Antigravity IDE's local gRPC-Web endpoint
// (https://127.0.0.1:5362/exa.language_server_pb.LanguageServerService/
// GetAvailableModels). The response lists every model the IDE knows about;
// most are placeholders with remainingFraction=1 and no resetTime. We track
// only the entries with a real resetTime — those are the gated/paid quotas.

export interface AntigravityModelWindow {
  modelKey: string;         // stable key, e.g. "claude-opus-4-6-thinking"
  displayName: string;      // user-facing, e.g. "Claude Opus 4.6 (Thinking)"
  utilization: number;      // 0–100 (= (1 − remainingFraction) × 100)
  resetsAt: number;         // ms epoch
  recommended?: boolean;
  exhausted?: boolean;      // true when remainingFraction was 0 or omitted (proto default)
}

export interface AntigravityUsageSnapshot {
  models: AntigravityModelWindow[];
}

// modelKey → true when the nudge ("use it or lose it") is active for that
// specific model. Empty when no model qualifies.
export type AntigravityUsageNudgeFlags = Record<string, boolean>;

export interface AntigravityUsageStatus {
  state: UsageState;
  snapshot?: AntigravityUsageSnapshot;
  lastUpdated?: number;
  message?: string;
  nudgeActive?: AntigravityUsageNudgeFlags;
}

// ─── Cowork Scheduler ────────────────────────────────────────────────────────
// Active sibling of the usage "nudge": fires a minimal `claude -p` ping to open
// a fresh 5-hour window (and refresh the OAuth token) on the user's schedule.
// The scheduler reads window state from UsagePoller — it never re-detects it.

// What the scheduler's next timer is waiting on.
//   opener — a window-opening ping (fixed slot or adaptive resetsAt).
//   nudge  — a token-refresh ping near expiresAt (off mode / long gaps only).
export type SchedulerEventKind = 'opener' | 'nudge';

// Result of the most recent ping. `rode` is true when the ping landed inside a
// still-live window (so it refreshed the token but did NOT open a new block).
export interface SchedulerLastRun {
  at: number;            // ms epoch when the ping fired
  kind: SchedulerEventKind;
  ok: boolean;           // process exited cleanly
  rode?: boolean;        // rode a live window instead of opening a fresh one
  reason?: string;       // failure detail when !ok
}

export interface SchedulerStatus {
  mode: 'off' | 'fixed' | 'adaptive';
  nextFireAt: number | null;      // ms epoch of the next scheduled ping (any kind)
  nextEventKind: SchedulerEventKind | null;
  lastRun: SchedulerLastRun | null;
  openersToday: number;           // count of openers fired since local midnight
  windowResetsAt?: number | null; // mirror of the live 5-hour resetsAt, for the glance
}

// ─── Claude Code status line ─────────────────────────────────────────────────
// Agent Pulse can install & configure Claude Code's custom status line — the bar
// at the bottom of the terminal. Claude Code runs a command after each message,
// feeding it session JSON on stdin (model, context %, cost, rate limits, git, …)
// and renders whatever the command prints. We deploy ONE renderer script (in the
// first available runtime) that reads a config file projected from `StatusLineConfig`.
// Kept in src/common so the main process (writes config + script) and the renderer
// (segment editor + live preview) agree on the exact shape.

// Which session field a segment renders. Maps to the documented stdin schema.
export type StatusLineSegmentType =
  | 'model'        // model.display_name
  | 'contextBar'   // context_window.used_percentage → bar + %
  | 'cwd'          // workspace.current_dir
  | 'projectDir'   // workspace.project_dir
  | 'gitBranch'    // workspace.git_worktree / worktree.branch
  | 'repo'         // workspace.repo.owner/name
  | 'cost'         // cost.total_cost_usd
  | 'duration'     // cost.total_duration_ms
  | 'linesChanged' // cost.total_lines_added/removed
  | 'rateLimit'    // rate_limits.{five_hour,seven_day}.used_percentage
  | 'outputStyle'  // output_style.name
  | 'effort'       // effort.level
  | 'vimMode'      // vim.mode
  | 'pr';          // pr.number / pr.review_state

// Named ANSI colors (resolved to escape codes by the renderer). `auto` lets a
// segment color itself by value (e.g. the context bar / rate-limit thresholds).
export type StatusLineColor =
  | 'auto' | 'white' | 'gray' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan';

// One threshold stop for value-colored segments: at `at`% or above, use `color`.
export interface StatusLineThreshold {
  at: number;             // 0–100
  color: StatusLineColor;
}

// A single segment. Type-specific options are optional and only read for the
// relevant `type`; the renderer ignores irrelevant fields.
export interface StatusLineSegment {
  type: StatusLineSegmentType;
  enabled: boolean;
  color?: StatusLineColor;        // base color (ignored where `auto`/thresholds apply)
  icon?: string;                  // optional emoji/glyph prefixed before the text (e.g. 📁)
  // contextBar
  width?: number;                 // bar width in chars (clamped 4–40)
  fillChar?: string;              // filled cell glyph (default █)
  emptyChar?: string;             // empty cell glyph (default ░)
  showPercent?: boolean;          // append "NN%"
  thresholds?: StatusLineThreshold[]; // value→color stops (contextBar, rateLimit)
  // rateLimit
  window?: 'five_hour' | 'seven_day';
  // cwd
  basenameOnly?: boolean;         // show only the last path segment
}

// One rendered line. Multi-line status is supported via multiple entries.
export interface StatusLineRow {
  separator?: string;             // joins segments on this row (overrides top-level)
  segments: StatusLineSegment[];
}

export interface StatusLineConfig {
  version: 1;
  separator: string;              // default separator between segments
  lines: StatusLineRow[];
  // When > 0, a configured line with more than this many rendered segments is
  // wrapped onto multiple terminal rows (chunks of this size). Lets a crowded
  // line flow across lines instead of overflowing/truncating. 0/undefined = off.
  maxItemsPerLine?: number;
}

// First script runtime found on PATH, in preference order.
export type StatusLineRuntime = 'node' | 'python' | 'powershell';

// Install state of the `statusLine` key in ~/.claude/settings.json:
//   none    — no status line configured
//   ours    — points at a script under ~/.claude/agent-pulse/ (Agent Pulse owns it)
//   foreign — a status line exists but someone else configured it (back up before replacing)
export type StatusLineState = 'none' | 'ours' | 'foreign';

// What `status-line:detect` returns to the renderer.
export interface StatusLineDetectInfo {
  runtime: StatusLineRuntime | null; // null when no runtime is available
  binPath: string | null;            // absolute path to the interpreter
  state: StatusLineState;
  settingsPath: string;              // ~/.claude/settings.json (for the "open" link)
}

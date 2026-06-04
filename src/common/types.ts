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

// Sound played when a bubble flips into the "waiting for input" state. 'pop'
// is the bundled wav; the rest are synthesized in the renderer; 'none' is silent.
export type BubbleSoundId = 'pop' | 'chime' | 'ding' | 'marimba' | 'none';

export interface BubbleConfig {
  size: BubbleSize;
  stackPosition: BubbleStackPosition;
  sound: BubbleSoundId;
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

export type ToolId = 'claude-code' | 'cursor' | 'vscode-copilot' | 'openai-codex' | 'kiro' | 'antigravity-cli';
export type AgentState = 'working' | 'waiting' | 'idle' | 'idle-active' | 'error';

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

export type ToolId = 'claude-code' | 'cursor' | 'vscode-copilot' | 'openai-codex' | 'kiro' | 'gemini-cli';
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
  };
}

export interface ToolStatus {
  toolId: ToolId;
  state: AgentState;
  lastUpdated: number;
  activeAgents: number;
  currentTask?: string;
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

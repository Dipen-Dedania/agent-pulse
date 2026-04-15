export type ToolId = 'claude-code' | 'cursor' | 'vscode-copilot' | 'openai-codex';
export type AgentState = 'working' | 'idle' | 'error';

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

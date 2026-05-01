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

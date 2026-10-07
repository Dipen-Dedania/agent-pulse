// The per-agent seam of the backlog runner. The engine and runner.ts never
// know which CLI they are driving: they ask the card's adapter for the binary,
// the argv, and how to read the output. Claude (`claude -p`) and Codex
// (`codex exec`) each implement this; see codex-backlog-plan.md §2.3.
//
// Safety contract every adapter must keep:
//  - the prompt goes over STDIN (never argv) unless `resuming` is true, in
//    which case the continuation prompt on argv is a fixed constant;
//  - every argv entry is a fixed constant, an engine-controlled path, or a
//    strict-charset-gated value (isSafeModelId / isSafeSessionId) — on
//    Windows argv may pass through `cmd.exe /c`, which has no safe escape.

import { BacklogAgent, BacklogTaskType } from '../../../common/backlog-types';

export interface AgentRunSpec {
  taskType: BacklogTaskType;
  /** Card's model override; null = the agent's own default. */
  model: string | null | undefined;
  /** Continue a paused run's session in place (execution cards keep their worktree). */
  resumeSessionId: string | null | undefined;
  cwd: string;
  /** Claude QA cards: `--mcp-config` path written by the engine. */
  mcpConfigPath?: string | null;
  /** Codex QA cards: name of the `$CODEX_HOME/<name>.config.toml` profile the engine wrote. */
  qaProfile?: string | null;
  /** Codex: engine-controlled path for `-o` (the agent's last message). */
  outputFile?: string | null;
}

export type AgentArgs =
  | { ok: true; args: string[]; resuming: boolean }
  | { ok: false; reason: string };

export interface AgentParsedOutput {
  ok: boolean;
  report?: string;
  reason?: string;
  /** Claude: CLI-reported; Codex: estimated from tokens (null when unpriced). */
  costUsd: number | null;
  numTurns: number | null;
  sessionId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AgentAdapter {
  id: BacklogAgent;
  displayName: string;
  /** Absolute path of the CLI, or null when it isn't installed. */
  resolveBin(): string | null;
  /** Drop the cached path after an ENOENT so a later install is picked up. */
  resetBinCache(): void;
  /**
   * Whether `bin` must be launched through `cmd.exe /s /c` (Windows npm
   * `.cmd` shims). A real `.exe` spawns directly.
   */
  needsCmdShim(bin: string): boolean;
  buildArgs(spec: AgentRunSpec): AgentArgs;
  /** Parse a clean exit's stdout (plus any side file named in `spec`). */
  parseOutput(stdout: string, spec: AgentRunSpec): AgentParsedOutput;
  /** Does this failure text describe an exhausted usage window / rate limit? */
  isUsageLimitError(text: string | null | undefined): boolean;
  /** Classify a non-zero exit whose stdout held no usable result. */
  classifyNonZeroExit(code: number | null, stdout: string, stderr: string): { reason: string; usageLimit: boolean };
}

/** Last up-to-3 non-empty lines of a stream, capped, for a compact failure detail. */
export function tailDetail(text: string): string {
  return text.trim().split(/\r?\n/).slice(-3).join(' ').slice(0, 500);
}

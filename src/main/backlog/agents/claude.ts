// Claude Code adapter: `claude -p` headless runs. This is the original runner
// behaviour, unchanged, behind the AgentAdapter seam.
//
// Safety posture:
//  - research: never passes --dangerously-skip-permissions — headless mode
//    denies permission-gated tools (Write/Edit/Bash) by default, so runs are
//    read-only by construction; --disallowedTools is belt-and-braces.
//  - execution: --permission-mode acceptEdits auto-approves Write/Edit INSIDE
//    the cwd only (outside prompts → dies headlessly), and Bash stays
//    disallowed — with no Bash the agent structurally cannot run `git commit`
//    / `git push`. --setting-sources user stops the target repo's own
//    .claude/settings.json from granting more than we intend. The worktree is
//    the blast-radius limiter; QA commands are run by the ENGINE, not the agent.
//  - qa: research's read-only posture + ONLY the chrome-devtools-mcp tools
//    auto-approved; --strict-mcp-config ignores every other configured MCP
//    server, so the run gets browser eyes and nothing else.
//
// Verified against the installed CLI (2.1.170): --disallowedTools takes a
// comma-separated list; --permission-mode acceptEdits, --setting-sources and
// -r/--resume exist; --output-format json emits one result object with
// result/is_error/total_cost_usd/num_turns/session_id. NO --max-turns in this
// version — the runner's time budget kill is the hard cap.

import { logger } from '../../../common/logger';
import { isSafeModelId } from '../../../common/backlog-types';
import { resolveClaudeBin, resetClaudeBinCache } from '../../scheduler/opener';
import { AgentAdapter, AgentArgs, AgentParsedOutput, AgentRunSpec, tailDetail } from './types';
import { isSafeSessionId, RESUME_PROMPT } from './shared';

const RESEARCH_DISALLOWED_TOOLS = 'Write,Edit,NotebookEdit,Bash';
const EXECUTION_DISALLOWED_TOOLS = 'Bash,NotebookEdit';
const QA_ALLOWED_TOOLS = 'mcp__chrome-devtools__*';

// A run that died because the subscription's usage window is exhausted is not
// the card's fault — the engine pauses the card and latches until reset
// instead of blocking it. Pattern-based; unmatched wordings fall back to the
// generic failure path (one card blocked, no cascade thanks to the engine's
// proactive gate).
const USAGE_LIMIT_RE = /usage limit|rate.?limit|session limit|limit (?:reached|exceeded)|out of (?:credits?|quota)|exceeded.*quota|hit.*limit/i;
export function isUsageLimitError(text: string | null | undefined): boolean {
  return !!text && USAGE_LIMIT_RE.test(text);
}

/**
 * Classify a non-zero `claude -p` exit whose stdout held no parseable JSON
 * result. Usage/session-limit notices are printed to STDOUT and the process
 * exits 1 BEFORE emitting the result object, so stderr is typically empty —
 * the detail (and the usage-limit verdict) must consider stdout too. Missing
 * this is why a limit exhaustion is misfiled as a generic blocked failure and
 * cascades into the next card instead of latching until reset. Pure + tested.
 */
export function classifyNonZeroExit(
  code: number | null,
  stdout: string,
  stderr: string,
): { reason: string; usageLimit: boolean } {
  const detail = tailDetail(stderr) || tailDetail(stdout);
  return {
    reason: `claude exited with code ${code}${detail ? `: ${detail}` : ''}`,
    usageLimit: isUsageLimitError(detail),
  };
}

export interface ParsedClaudeOutput {
  ok: boolean;
  report?: string;
  reason?: string;
  costUsd: number | null;
  numTurns: number | null;
  sessionId: string | null;
}

/**
 * Parse `claude -p --output-format json` stdout: a single JSON object, though
 * warnings may precede it — scan lines from the end for the result object.
 * Pure function, unit-tested.
 */
export function parseClaudeJsonOutput(stdout: string): ParsedClaudeOutput {
  const fail = (reason: string): ParsedClaudeOutput =>
    ({ ok: false, reason, costUsd: null, numTurns: null, sessionId: null });

  const lines = stdout.trim().split(/\r?\n/);
  let parsed: any = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      const candidate = JSON.parse(line);
      if (candidate && typeof candidate === 'object' && 'result' in candidate) {
        parsed = candidate;
        break;
      }
    } catch {
      // keep scanning
    }
  }
  if (!parsed) return fail('no JSON result object found in claude output');

  const costUsd = typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null;
  const numTurns = typeof parsed.num_turns === 'number' ? parsed.num_turns : null;
  const sessionId = typeof parsed.session_id === 'string' ? parsed.session_id : null;

  if (parsed.is_error) {
    return { ok: false, reason: typeof parsed.result === 'string' && parsed.result ? parsed.result : 'claude reported an error', costUsd, numTurns, sessionId };
  }
  const report = typeof parsed.result === 'string' ? parsed.result.trim() : '';
  if (!report) {
    return { ok: false, reason: 'claude returned an empty result', costUsd, numTurns, sessionId };
  }
  return { ok: true, report, costUsd, numTurns, sessionId };
}

/** Pure argv builder — exported for tests. */
export function buildClaudeArgs(spec: AgentRunSpec): AgentArgs {
  const { taskType, model, resumeSessionId, mcpConfigPath } = spec;
  if (taskType === 'qa' && !mcpConfigPath) {
    // The browser tools ARE the task — a QA run without them would burn a
    // turn discovering it can't see anything.
    return { ok: false, reason: 'QA run started without an MCP config path' };
  }
  const args = taskType === 'execution'
    ? ['-p', '--output-format', 'json', '--permission-mode', 'acceptEdits',
       '--disallowedTools', EXECUTION_DISALLOWED_TOOLS, '--setting-sources', 'user']
    : ['-p', '--output-format', 'json', '--disallowedTools', RESEARCH_DISALLOWED_TOOLS];
  if (taskType === 'qa') {
    // The config path is engine-controlled (fixed file under userData), not
    // user text; buildCmdShimArgs quotes it if the path contains spaces.
    args.push('--mcp-config', mcpConfigPath!, '--strict-mcp-config', '--allowedTools', QA_ALLOWED_TOOLS);
  }
  if (model) {
    // Store normalization should have rejected unsafe values already —
    // re-check here since this string reaches cmd.exe argv.
    if (isSafeModelId(model)) args.push('--model', model);
    else logger.warn(`[Backlog/claude] ignoring unsafe model id ${JSON.stringify(model)} — using default`);
  }
  let resuming = false;
  if (resumeSessionId) {
    if (isSafeSessionId(resumeSessionId)) {
      // Print mode takes the continuation prompt on argv, not stdin; both
      // entries are safe (gated id + fixed constant).
      args.push('--resume', resumeSessionId, RESUME_PROMPT);
      resuming = true;
    } else {
      logger.warn('[Backlog/claude] unsafe session id — starting a fresh run instead of resuming');
    }
  }
  return { ok: true, args, resuming };
}

export const claudeAdapter: AgentAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  resolveBin: resolveClaudeBin,
  resetBinCache: resetClaudeBinCache,
  // Windows npm shims are .cmd files spawn can't launch directly — always
  // route through cmd.exe there (the bin may be .cmd, .exe, or .bat).
  needsCmdShim: () => process.platform === 'win32',
  buildArgs: buildClaudeArgs,
  parseOutput(stdout: string): AgentParsedOutput {
    const p = parseClaudeJsonOutput(stdout);
    return { ...p, inputTokens: null, outputTokens: null };
  },
  isUsageLimitError,
  classifyNonZeroExit,
};

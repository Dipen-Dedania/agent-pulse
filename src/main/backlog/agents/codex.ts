// Codex CLI adapter: `codex exec` headless runs. Verified on codex-cli 0.160.0
// (Spike 0, codex-backlog-plan.md §0):
//
//  - the prompt is read from STDIN when no prompt argument is given (`-`);
//  - `--json` prints JSONL events: thread.started{thread_id}, turn.started,
//    item.started/item.completed{item:{type:'agent_message'|'error'|…}},
//    turn.completed{usage:{input_tokens,cached_input_tokens,
//    cache_write_input_tokens,output_tokens,reasoning_output_tokens}},
//    error{message}, turn.failed{error:{message}};
//  - `-o <file>` writes the agent's last message verbatim — that file is the
//    report; the JSONL is for the thread id, tokens and failure reasons;
//  - `-s read-only` / `-s workspace-write` is the whole tool-restriction
//    story (no allow/deny tool lists). The agent ALWAYS has a shell, so the
//    "no commits" guarantee is the sandbox (a detached worktree's git dir
//    lives in the main repo, outside the writable root — `git add`/`commit`
//    were denied in the spike) plus the engine's unwindCommits guard.
//  - `-c approval_policy="never"` keeps a headless run from stalling on an
//    approval; `-C <cwd>` pins the workspace root (we also spawn with cwd).
//  - never `--ephemeral`: resume needs the persisted rollout.
//
// Codex reports tokens, not dollars: cost is ESTIMATED via src/common/pricing
// at the card's model (or the user's config.toml default) and flagged null
// when the model has no rate.

import fs from 'fs';
import { logger } from '../../../common/logger';
import { isSafeModelId } from '../../../common/backlog-types';
import { estimateCost } from '../../../common/pricing';
import { resolveCodexBin, resetCodexBinCache } from '../../scheduler/codex-opener';
import { resolveCodexDefaultModel } from '../codex-settings';
import { AgentAdapter, AgentArgs, AgentParsedOutput, AgentRunSpec, tailDetail } from './types';
import { isSafeSessionId, RESUME_PROMPT } from './shared';

// Codex's own wording isn't captured yet (Spike 0 item 5 — a window can't be
// exhausted on demand); this covers the OpenAI API's rate-limit phrasing plus
// the ChatGPT-plan notices seen in the usage poller.
const USAGE_LIMIT_RE = /usage limit|rate.?limit|limit (?:reached|exceeded)|too many requests|\b429\b|out of (?:credits?|quota)|exceeded.*quota|hit.*limit|insufficient_quota/i;
export function isCodexUsageLimitError(text: string | null | undefined): boolean {
  return !!text && USAGE_LIMIT_RE.test(text);
}

// Profile name must be a plain identifier — it lands on argv.
const PROFILE_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Pure argv builder — exported for tests. */
export function buildCodexArgs(spec: AgentRunSpec): AgentArgs {
  const { taskType, model, resumeSessionId, qaProfile, outputFile, cwd } = spec;
  if (!outputFile) return { ok: false, reason: 'codex run started without an output file path' };
  if (taskType === 'qa' && !qaProfile) {
    return { ok: false, reason: 'QA run started without a Codex MCP profile' };
  }
  if (qaProfile && !PROFILE_RE.test(qaProfile)) {
    return { ok: false, reason: 'invalid Codex profile name' };
  }

  let resuming = false;
  if (resumeSessionId) {
    if (isSafeSessionId(resumeSessionId)) resuming = true;
    else logger.warn('[Backlog/codex] unsafe thread id — starting a fresh run instead of resuming');
  }
  const sandbox = taskType === 'execution' ? 'workspace-write' : 'read-only';
  const args: string[] = resuming ? ['exec', 'resume'] : ['exec'];
  args.push('--json', '-o', outputFile, '-c', 'approval_policy="never"', '--skip-git-repo-check');
  if (resuming) {
    // `exec resume` has no -s / -C / -p flags (verified 0.160.0): the sandbox
    // goes through the config override, and the session already knows its
    // cwd (we spawn in the same worktree; resume's lookup is cwd-scoped).
    args.push('-c', `sandbox_mode="${sandbox}"`);
  } else {
    args.push('-s', sandbox, '-C', cwd);
    if (taskType === 'qa') args.push('-p', qaProfile!);
  }
  if (model) {
    if (isSafeModelId(model)) args.push('-m', model);
    else logger.warn(`[Backlog/codex] ignoring unsafe model id ${JSON.stringify(model)} — using default`);
  }
  // Positionals last. Resume: gated thread id + fixed continuation prompt on
  // argv. Fresh: `-` reads the prompt from stdin.
  if (resuming) args.push(resumeSessionId!, RESUME_PROMPT);
  else args.push('-');
  return { ok: true, args, resuming };
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
}

export interface ParsedCodexEvents {
  threadId: string | null;
  turns: number;
  lastMessage: string | null;
  /** Fatal error text (error / turn.failed), last one wins. */
  error: string | null;
  usage: { input: number; cachedInput: number; cacheWrite: number; output: number };
}

/** Pull `error.message` out of the JSON-encoded API error Codex forwards. */
function unwrapApiError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const obj = JSON.parse(trimmed);
    const inner = obj?.error?.message ?? obj?.message;
    return typeof inner === 'string' && inner ? inner : trimmed;
  } catch {
    return trimmed;
  }
}

/** Walk `codex exec --json` stdout. Tolerates non-JSON lines. Pure, tested. */
export function parseCodexEvents(stdout: string): ParsedCodexEvents {
  const out: ParsedCodexEvents = {
    threadId: null, turns: 0, lastMessage: null, error: null,
    usage: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 },
  };
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    switch (ev?.type) {
      case 'thread.started':
        if (typeof ev.thread_id === 'string') out.threadId = ev.thread_id;
        break;
      case 'turn.completed': {
        out.turns += 1;
        const u: CodexUsage = ev.usage ?? {};
        out.usage.input += u.input_tokens ?? 0;
        out.usage.cachedInput += u.cached_input_tokens ?? 0;
        out.usage.cacheWrite += u.cache_write_input_tokens ?? 0;
        out.usage.output += u.output_tokens ?? 0;
        break;
      }
      case 'item.completed':
        if (ev.item?.type === 'agent_message' && typeof ev.item.text === 'string') out.lastMessage = ev.item.text;
        break;
      case 'error':
        if (typeof ev.message === 'string') out.error = unwrapApiError(ev.message);
        break;
      case 'turn.failed':
        if (typeof ev.error?.message === 'string') out.error = unwrapApiError(ev.error.message);
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Turn the JSONL + last-message file into the runner's result. `readFile` is
 * injectable so the parse is testable without touching disk.
 */
export function parseCodexOutput(
  stdout: string,
  spec: Pick<AgentRunSpec, 'model' | 'outputFile'>,
  readFile: (p: string) => string | null = readFileOrNull,
  defaultModel: () => string | null = () => resolveCodexDefaultModel().model,
): AgentParsedOutput {
  const ev = parseCodexEvents(stdout);
  const inputTokens = ev.usage.input > 0 || ev.usage.output > 0 ? ev.usage.input : null;
  const outputTokens = inputTokens === null ? null : ev.usage.output;
  let costUsd: number | null = null;
  if (inputTokens !== null) {
    const model = spec.model || defaultModel();
    // Codex's input_tokens is the TOTAL prompt (cached included); split it so
    // cache reads price at the cheaper rate.
    const est = estimateCost(model, {
      tokensIn: Math.max(0, ev.usage.input - ev.usage.cachedInput),
      cacheRead: ev.usage.cachedInput,
      cacheWrite: ev.usage.cacheWrite,
      tokensOut: ev.usage.output,
    });
    costUsd = est.priced ? est.costUsd : null;
  }
  const base = { costUsd, numTurns: ev.turns > 0 ? ev.turns : null, sessionId: ev.threadId, inputTokens, outputTokens };

  if (ev.error) return { ok: false, reason: ev.error, ...base };

  // A blank side file (run died before the final message) falls back to the
  // last agent_message seen in the JSONL.
  const fromFile = spec.outputFile ? readFile(spec.outputFile)?.trim() || null : null;
  const report = (fromFile ?? ev.lastMessage ?? '').trim();
  if (!report) {
    return { ok: false, reason: ev.threadId ? 'codex returned an empty result' : 'no JSONL events found in codex output', ...base };
  }
  return { ok: true, report, ...base };
}

function readFileOrNull(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

export function classifyCodexNonZeroExit(
  code: number | null,
  stdout: string,
  stderr: string,
): { reason: string; usageLimit: boolean } {
  // A failed turn still emits its error as JSONL on stdout; prefer that over
  // the raw stream tail.
  const ev = parseCodexEvents(stdout);
  const detail = ev.error ?? (tailDetail(stderr) || tailDetail(stdout));
  return {
    reason: `codex exited with code ${code}${detail ? `: ${detail}` : ''}`,
    usageLimit: isCodexUsageLimitError(detail),
  };
}

export const codexAdapter: AgentAdapter = {
  id: 'codex',
  displayName: 'Codex',
  resolveBin: resolveCodexBin,
  resetBinCache: resetCodexBinCache,
  // The installer / standalone builds are a real codex.exe (spawn directly);
  // only the npm global install leaves a .cmd shim that needs cmd.exe.
  needsCmdShim: (bin) => process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin),
  buildArgs: buildCodexArgs,
  parseOutput: (stdout, spec) => parseCodexOutput(stdout, spec),
  isUsageLimitError: isCodexUsageLimitError,
  classifyNonZeroExit: classifyCodexNonZeroExit,
};

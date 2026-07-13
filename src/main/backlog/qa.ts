import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { logger } from '../../common/logger';
import { BacklogCard } from '../../common/backlog-types';

// Engine-driven QA for Phase 2 execution cards: after a successful run, the
// configured provider's command runs IN THE WORKTREE (uncommitted changes are
// fine — tests/lint/tsc don't care) and its exit code is the verdict. The
// executor agent has no Bash, so this is the only place QA commands execute.
//
// Trust model: 'tests'/'lint'/'typecheck' resolve to the project's own npm
// scripts (the same thing `npm test` in the user's terminal runs); 'custom'
// is a command line the user typed into the card. All of it runs with user
// privileges by design — the same trust level as the user's own shell — so
// 'custom' goes through the platform shell to honor quoting/pipes the user
// wrote. Card title/description (untrusted free text) never reach a command.

const QA_TIMEOUT_MS = 10 * 60_000;
const QA_OUTPUT_MAX_CHARS = 256 * 1024;

export interface QaRunResult {
  /** 'skipped' = provider none. */
  verdict: 'passed' | 'failed' | 'skipped';
  /** Human-readable header: what actually ran (or why nothing could). */
  command: string;
  exitCode: number | null;
  output: string;   // combined stdout+stderr, tail-capped
}

function hasScript(worktreePath: string, name: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(worktreePath, 'package.json'), 'utf8'));
    return typeof pkg?.scripts?.[name] === 'string' && pkg.scripts[name].trim().length > 0;
  } catch {
    return false;
  }
}

/** Resolve provider → shell command line to run, or a reason it can't run. */
function resolveCommand(
  card: Pick<BacklogCard, 'qaProvider' | 'qaCommand'>,
  worktreePath: string,
): { command: string } | { unrunnable: string } {
  switch (card.qaProvider) {
    case 'tests':
      if (!hasScript(worktreePath, 'test')) return { unrunnable: 'package.json has no "test" script' };
      return { command: 'npm test' };
    case 'lint':
      if (!hasScript(worktreePath, 'lint')) return { unrunnable: 'package.json has no "lint" script' };
      return { command: 'npm run lint' };
    case 'typecheck':
      if (hasScript(worktreePath, 'typecheck')) return { command: 'npm run typecheck' };
      if (fs.existsSync(path.join(worktreePath, 'tsconfig.json'))) return { command: 'npx tsc --noEmit' };
      return { unrunnable: 'no "typecheck" script and no tsconfig.json' };
    case 'custom': {
      const cmd = card.qaCommand?.trim();
      if (!cmd) return { unrunnable: "provider is 'custom' but the card has no QA command" };
      return { command: cmd };
    }
    default:
      return { unrunnable: `provider '${card.qaProvider}' cannot run` };
  }
}

/**
 * Run the card's QA in its worktree. Never throws; an unrunnable provider is
 * a FAILED verdict (a misconfigured gate must not silently pass work to Done).
 */
export function runQa(
  card: Pick<BacklogCard, 'qaProvider' | 'qaCommand'>,
  worktreePath: string,
): Promise<QaRunResult> {
  if (card.qaProvider === 'none' || card.qaProvider === 'browser') {
    return Promise.resolve({ verdict: 'skipped', command: 'none', exitCode: null, output: '' });
  }

  const resolved = resolveCommand(card, worktreePath);
  if ('unrunnable' in resolved) {
    return Promise.resolve({
      verdict: 'failed',
      command: `(${card.qaProvider})`,
      exitCode: null,
      output: `QA could not run: ${resolved.unrunnable}`,
    });
  }

  logger.info(`[Backlog/qa] running "${resolved.command}" in ${worktreePath}`);
  return new Promise((resolve) => {
    // exec (not execFile): the command is a shell line by design — npm/npx are
    // .cmd shims on Windows, and custom commands may use the quoting/pipes the
    // user wrote. exec drives the platform shell (cmd /c, /bin/sh -c) with the
    // correct quoting semantics, which hand-rolled cmd.exe argv does not.
    exec(
      resolved.command,
      { cwd: worktreePath, timeout: QA_TIMEOUT_MS, windowsHide: true, maxBuffer: 10 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        const combined = `${stdout ?? ''}${stderr ? `\n--- stderr ---\n${stderr}` : ''}`.trim();
        const output = combined.length > QA_OUTPUT_MAX_CHARS
          ? `…(head truncated)\n${combined.slice(-QA_OUTPUT_MAX_CHARS)}`
          : combined;
        if (!err) {
          resolve({ verdict: 'passed', command: resolved.command, exitCode: 0, output });
          return;
        }
        const timedOut = (err as any).killed === true && (err as any).signal != null;
        const exitCode = typeof (err as any).code === 'number' ? (err as any).code : null;
        resolve({
          verdict: 'failed',
          command: resolved.command,
          exitCode,
          output: timedOut ? `QA timed out after ${QA_TIMEOUT_MS / 60_000} min\n${output}` : output,
        });
      },
    );
  });
}

// Codex counterpart of ./opener.ts: one trivial `codex exec` turn that anchors
// a fresh 5-hour ChatGPT window and refreshes the Codex login in the same call.
//
// Unlike `claude -p` (whose headless runs bill to a separate pool), a ChatGPT-
// authenticated `codex exec` spends the subscription window itself — that is
// precisely what makes the ping anchor it. One verified ping (0.160.0) cost
// ~16k input tokens (half cached) and 5 output tokens; the Settings copy says
// so, and the daily cap bounds it.

import { existsSync, readFileSync, readdirSync } from 'fs';
import os from 'os';
import path from 'path';
import { resetAugmentedPathCache } from '../shell-path';
import { lookupOnPathAsync } from '../installer/which';
import { OpenerResult, lookupOnPath, spawnPing } from './opener';

const PROMPT = 'ok';
// Codex's cold start (plugin discovery, sandbox setup) is heavier than Claude's.
const OPENER_TIMEOUT_MS = 90_000;

let cachedBin: string | null = null;

function isWin(): boolean {
  return process.platform === 'win32';
}

function binName(): string {
  return isWin() ? 'codex.exe' : 'codex';
}

/**
 * The standalone installer keeps releases under
 * ~/.codex/packages/standalone/releases/<name>/bin and writes the active
 * release name to ~/.codex/packages/standalone/current (a plain text file).
 */
function standaloneCandidates(): string[] {
  const root = path.join(os.homedir(), '.codex', 'packages', 'standalone');
  const releases = path.join(root, 'releases');
  const out: string[] = [];
  try {
    const current = readFileSync(path.join(root, 'current'), 'utf8').trim();
    if (current) out.push(path.join(releases, current, 'bin', binName()));
  } catch {
    // no `current` marker — fall through to the newest release dir
  }
  try {
    const names = readdirSync(releases, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
    for (const name of names) out.push(path.join(releases, name, 'bin', binName()));
  } catch {
    // no releases dir
  }
  return out;
}

/** Absolute locations to probe when PATH lookup misses, in preference order. */
function wellKnownCandidates(): string[] {
  const home = os.homedir();
  if (isWin()) {
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const roaming = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
    return [
      path.join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'), // installer launcher
      ...standaloneCandidates(),
      path.join(roaming, 'npm', 'codex.cmd'),                               // npm -g
    ];
  }
  const dirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    path.join(home, '.npm-global', 'bin'),
  ];
  return [...standaloneCandidates(), ...dirs.map((d) => path.join(d, 'codex'))];
}

/**
 * Resolve the `codex` executable. PATH first (Windows prefers `.exe` over the
 * npm `.cmd` shim over `.bat`), then the installer / standalone / npm
 * locations. Positive-cache only, like resolveClaudeBin.
 */
export function resolveCodexBin(): string | null {
  if (cachedBin) return cachedBin;
  return resolveFromHits(lookupOnPath('codex'));
}

/**
 * Non-blocking twin of `resolveCodexBin` for the launch path (the Settings
 * Codex status-line card asks for it at mount). Same selection rules and the
 * same positive-only cache; only the PATH lookup differs.
 */
export async function resolveCodexBinAsync(): Promise<string | null> {
  if (cachedBin) return cachedBin;
  return resolveFromHits(await lookupOnPathAsync('codex'));
}

function resolveFromHits(hits: string[]): string | null {
  if (hits.length > 0) {
    if (isWin()) {
      const byExt = (ext: string) => hits.find((p) => p.toLowerCase().endsWith(ext));
      cachedBin = byExt('.exe') ?? byExt('.cmd') ?? byExt('.bat') ?? hits[0];
    } else {
      cachedBin = hits[0];
    }
    return cachedBin;
  }
  for (const candidate of wellKnownCandidates()) {
    if (existsSync(candidate)) {
      cachedBin = candidate;
      return cachedBin;
    }
  }
  return null;
}

export function resetCodexBinCache(): void {
  cachedBin = null;
  resetAugmentedPathCache();
}

/**
 * Fixed argv for the ping. `--ephemeral` keeps it out of the session history,
 * `--skip-git-repo-check` lets it run from the home dir, and the read-only
 * sandbox guarantees it can't touch anything. No `-m`: the user's default
 * model is the one whose window we want to anchor.
 */
export function buildCodexOpenerArgs(): string[] {
  return ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', PROMPT];
}

/** Fire one Codex opener ping. Never throws. */
export function fireCodexOpener(): Promise<OpenerResult> {
  const bin = resolveCodexBin();
  if (!bin) {
    return Promise.resolve({ ok: false, reason: 'codex CLI not found on PATH' });
  }
  return spawnPing({
    bin,
    args: buildCodexOpenerArgs(),
    timeoutMs: OPENER_TIMEOUT_MS,
    cwd: os.homedir(),
    logTag: '[scheduler/codex-opener]',
    onEnoent: resetCodexBinCache,
  });
}

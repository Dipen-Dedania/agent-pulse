// Non-blocking `where` / `which` against the augmented login-shell PATH.
//
// The synchronous twin (`lookupOnPath` in scheduler/opener.ts) is fine for the
// scheduler, which fires hours apart. Tool detection at launch is different:
// up to nine lookups ran back to back on the main thread and froze window
// paint + IPC for their whole duration. Everything on the launch path goes
// through this module instead. Kept separate so tests can mock it.

import { execFile } from 'child_process';
import { resolveAugmentedPathAsync } from '../shell-path';

const WHICH_TIMEOUT_MS = 3_000;

/**
 * Every PATH hit for `name`, in PATH order, trimmed. Empty on a miss, on a
 * timeout, or when the lookup tool itself fails. Never throws.
 */
export async function lookupOnPathAsync(name: string): Promise<string[]> {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const env = { ...process.env, PATH: await resolveAugmentedPathAsync() };
  return new Promise((resolve) => {
    try {
      execFile(
        lookup,
        [name],
        { env, timeout: WHICH_TIMEOUT_MS, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve([]);
          resolve(
            String(stdout)
              .trim()
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean),
          );
        },
      );
    } catch {
      resolve([]);
    }
  });
}

/** First PATH hit for `name`, or undefined. Never throws. */
export async function whichAsync(name: string): Promise<string | undefined> {
  const hits = await lookupOnPathAsync(name);
  return hits[0];
}

// Bits both adapters share. Kept apart from types.ts so that file stays
// interface-only.

// Fixed constant (argv-safe: no cmd.exe metacharacters, no quotes) used when
// resuming — both CLIs take the continuation prompt on argv, not stdin.
export const RESUME_PROMPT =
  'Continue the task from where you left off. Re-read the current state of the working directory, finish the remaining work, and follow the same output contract as before.';

// Claude session ids and Codex thread ids are both uuid-shaped; anything else
// never reaches argv.
const SESSION_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export function isSafeSessionId(value: string): boolean {
  return SESSION_ID_RE.test(value);
}

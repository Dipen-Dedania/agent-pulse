// Human labels for Codex rate-limit windows. Codex reports the window length
// (18000 s = 5-hour, 604800 s = weekly on paid plans) rather than naming it, so
// both the main-process notification copy and the renderer derive the label
// from `windowSeconds` here — one rule, no drift. Falls back to the key name
// when the length is unknown (older CLI / endpoint drift).

export type CodexWindowKey = 'primary' | 'secondary' | 'review';

const HOUR = 3600;
const DAY = 86400;

const KEY_FALLBACK: Record<CodexWindowKey, string> = {
  primary: 'Primary',
  secondary: 'Secondary',
  review: 'Code review',
};

const KEY_SHORT_FALLBACK: Record<CodexWindowKey, string> = {
  primary: 'P1',
  secondary: 'P2',
  review: 'Rev',
};

/** Long form for Settings and notifications: "5-hour", "Weekly", "3-day", "12-hour". */
export function codexWindowLabel(windowSeconds: number | undefined, key: CodexWindowKey): string {
  if (key === 'review') return KEY_FALLBACK.review;
  if (!windowSeconds || windowSeconds <= 0 || !Number.isFinite(windowSeconds)) return KEY_FALLBACK[key];
  if (Math.abs(windowSeconds - 5 * HOUR) < HOUR / 2) return '5-hour';
  if (Math.abs(windowSeconds - 7 * DAY) < DAY / 2) return 'Weekly';
  if (windowSeconds >= 2 * DAY) return `${Math.round(windowSeconds / DAY)}-day`;
  return `${Math.max(1, Math.round(windowSeconds / HOUR))}-hour`;
}

/** Short form for the bubble tooltip: "5h", "7d", "3d", "12h". */
export function codexWindowShortLabel(windowSeconds: number | undefined, key: CodexWindowKey): string {
  if (key === 'review') return KEY_SHORT_FALLBACK.review;
  if (!windowSeconds || windowSeconds <= 0 || !Number.isFinite(windowSeconds)) return KEY_SHORT_FALLBACK[key];
  if (windowSeconds >= 2 * DAY) return `${Math.round(windowSeconds / DAY)}d`;
  return `${Math.max(1, Math.round(windowSeconds / HOUR))}h`;
}

/** Lower-case form for mid-sentence use ("your 5-hour window", "your weekly window"). */
export function codexWindowPhrase(windowSeconds: number | undefined, key: CodexWindowKey): string {
  const label = codexWindowLabel(windowSeconds, key);
  return label === 'Weekly' || label === 'Primary' || label === 'Secondary' || label === 'Code review'
    ? label.toLowerCase()
    : label;
}

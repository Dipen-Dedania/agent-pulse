// Decides when the hidden settings window is shown and the floating splash is
// closed. Exactly once, driven by two inputs:
//
//   settings side  first paint reported by the renderer, a load failure, a
//                  user request (tray click, second launch), or a fallback
//                  timer so a renderer that never reports still gets a window.
//   splash side    the splash page has painted. The splash then stays up for
//                  at least `minSplashMs` so the logo is actually seen — on a
//                  fast machine the whole boot takes well under a second and
//                  the splash would otherwise be closed before its first frame.
//
// Urgent settings-side reasons (user request, load failure) skip the hold.
// If the splash never reports a paint within `splashGraceMs` of arming, the
// hold is waived so a broken splash can't delay the app.
//
// Pure (no Electron import) so the once-only, hold and fallback semantics are
// testable.

export interface RevealGateOptions {
  reveal: () => void;
  closeSplash: () => void;
  /** Settings-side fallback: reveal even if the renderer never reports. */
  fallbackMs: number;
  /** Minimum time the splash stays visible after it painted. 0 disables the hold. */
  minSplashMs: number;
  /** How long to wait for the splash to report a paint before waiving the hold. */
  splashGraceMs: number;
  log: (message: string) => void;
  now: () => number;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export type RevealReason = 'first-paint' | 'load-failed' | 'user-request' | 'fallback';

export interface RevealGate {
  /** Start the settings-side fallback and the splash grace timers. Idempotent. */
  arm(): void;
  /** The splash page has painted; the minimum hold starts now. */
  onSplashPainted(): void;
  onFirstPaint(): void;
  onLoadFailed(): void;
  onUserRequest(): void;
  readonly revealed: boolean;
  readonly reason: RevealReason | null;
}

const URGENT: ReadonlySet<RevealReason> = new Set<RevealReason>(['user-request', 'load-failed']);

export function createRevealGate(opts: RevealGateOptions): RevealGate {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  let revealed = false;
  let reason: RevealReason | null = null;
  let settingsReady: RevealReason | null = null;
  let splashPaintedAt: number | null = null;
  let graceExpired = false;
  let armed = false;

  let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  const clearAll = () => {
    for (const t of [fallbackTimer, graceTimer, holdTimer]) if (t !== null) clearTimer(t);
    fallbackTimer = graceTimer = holdTimer = null;
  };

  const doReveal = (why: RevealReason) => {
    if (revealed) return;
    revealed = true;
    reason = why;
    clearAll();
    opts.log(`[Boot] reveal settings (${why})`);
    try {
      opts.reveal();
    } catch (e) {
      opts.log(`[Boot] reveal failed: ${String(e)}`);
    }
    try {
      opts.closeSplash();
    } catch (e) {
      opts.log(`[Boot] closing splash failed: ${String(e)}`);
    }
  };

  // Settings is ready; reveal now unless the splash still owes screen time.
  const maybeReveal = () => {
    if (revealed || settingsReady === null) return;
    const why = settingsReady;
    if (URGENT.has(why) || opts.minSplashMs <= 0) { doReveal(why); return; }
    if (splashPaintedAt === null) {
      // Splash hasn't painted (yet). Wait for it, unless the grace period has
      // already expired — then it's not coming and must not hold the app.
      if (graceExpired) doReveal(why);
      return;
    }
    const remaining = opts.minSplashMs - (opts.now() - splashPaintedAt);
    if (remaining <= 0) { doReveal(why); return; }
    if (holdTimer === null) {
      opts.log(`[Boot] holding splash ${Math.round(remaining)}ms more`);
      holdTimer = setTimer(() => { holdTimer = null; maybeReveal(); }, remaining);
    }
  };

  const settingsSide = (why: RevealReason) => {
    if (revealed) return;
    // Urgent reasons override a pending non-urgent one; otherwise first wins.
    if (settingsReady === null || (URGENT.has(why) && !URGENT.has(settingsReady))) settingsReady = why;
    maybeReveal();
  };

  return {
    arm() {
      if (revealed || armed) return;
      armed = true;
      fallbackTimer = setTimer(() => { fallbackTimer = null; settingsSide('fallback'); }, opts.fallbackMs);
      graceTimer = setTimer(() => {
        graceTimer = null;
        if (splashPaintedAt === null) {
          graceExpired = true;
          opts.log('[Boot] splash never reported a paint; waiving its minimum hold');
          maybeReveal();
        }
      }, opts.splashGraceMs);
    },
    onSplashPainted() {
      if (revealed || splashPaintedAt !== null) return;
      splashPaintedAt = opts.now();
      if (graceTimer !== null) { clearTimer(graceTimer); graceTimer = null; }
      maybeReveal();
    },
    onFirstPaint: () => settingsSide('first-paint'),
    onLoadFailed: () => settingsSide('load-failed'),
    onUserRequest: () => settingsSide('user-request'),
    get revealed() { return revealed; },
    get reason() { return reason; },
  };
}

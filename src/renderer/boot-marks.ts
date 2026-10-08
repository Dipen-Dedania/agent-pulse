// Launch instrumentation + the first-paint handshake for the framed (Settings)
// window.
//
// `bootMark` sends a named timestamp to the main process, which logs it on the
// same clock as its own `[Boot]` lines so the whole launch — process start →
// splash → window → Landing → Settings — reads as one timeline in the log file.
// Overlay windows (bubbles, tooltip, tour, screen edge) load the same bundle
// but are not part of that story, so their marks are dropped here.

function isFramedWindow(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('toolId')) return false;
    const view = params.get('view');
    return view === null || view === 'settings';
  } catch {
    return false;
  }
}

export function bootMark(name: string): void {
  if (!isFramedWindow()) return;
  try {
    window.electron?.send('boot:mark', { name, at: Date.now() });
  } catch {
    // Preload absent (tests) — marks are best-effort.
  }
}

/**
 * Tell the main process the real UI is on screen. The settings window is
 * created hidden behind a floating logo splash; main shows it and closes the
 * splash on this signal (or on its own fallback timer). Safe to call more
 * than once — the main side is once-only.
 */
export function signalFirstPaint(): void {
  if (!isFramedWindow()) return;
  bootMark('first-paint');
  try {
    window.electron?.send('splash:done');
  } catch {
    // Preload absent (tests).
  }
}

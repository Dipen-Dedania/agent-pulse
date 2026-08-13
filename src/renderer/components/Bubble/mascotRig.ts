// ── Mascot rig reset ─────────────────────────────────────────────────────────
// Every mascot drives its poses through a `gsap.context` that is reverted when
// the state changes. `revert()` reliably restores inline styles (the opacity
// swaps behind the face/prop changes), but it does NOT reliably unwind the SVG
// transform ATTRIBUTE. The poses mix `svgOrigin`-anchored tweens with
// origin-less ones on the same node — e.g. Antigravity's `playRun` scales
// `#gigi` about '100 210', then `playHelp` hops the same node with a bare
// `y: -8`. GSAP re-derives the transform origin from the element's CURRENT —
// already transformed — geometry, rewrites `data-svg-origin`, and bakes the
// difference into the matrix. That residual survives the revert, the next pose
// starts from it, and the character creeps DOWNWARD a few user units on every
// state change until it ends up sitting on the usage bars.
//
// The fix is to put the rig back on its authored coordinates before each pose.
// We can't just strip every `transform` attribute — some artwork carries one by
// hand (Kiro's ghost paths are placed with `translate(...) scale(...)`) — so we
// snapshot the authored attributes once, on mount, and restore exactly those.
// Only transform state is touched: opacity and the rest revert correctly, and
// clearing them here would wipe the pose currently being set up.

export type MascotRigSnapshot = Map<SVGElement, string | null>;

// Record every descendant's authored `transform`. Call once per mount, BEFORE
// the first pose runs — after that the attributes are GSAP's, not the artwork's.
export function snapshotMascotRig(root: SVGSVGElement | null): MascotRigSnapshot {
  const snap: MascotRigSnapshot = new Map();
  if (!root) return snap;
  for (const el of root.querySelectorAll<SVGElement>('*')) {
    snap.set(el, el.getAttribute('transform'));
  }
  return snap;
}

// Restore the authored transforms and drop GSAP's transform bookkeeping, so the
// next pose parses an identity (or authored) matrix instead of the previous
// pose's leftovers. Safe to call only when no tween is live on the rig — i.e.
// after `ctx.revert()` and before the next `gsap.context(...)`.
export function resetMascotRig(snap: MascotRigSnapshot): void {
  for (const [el, authored] of snap) {
    if (authored === null) el.removeAttribute('transform');
    else el.setAttribute('transform', authored);
    el.removeAttribute('data-svg-origin');
    el.style.removeProperty('transform');
    el.style.removeProperty('transform-origin');
    // GSAP caches the parsed transform on the element itself; drop it or the
    // next tween reads the stale matrix straight back out of the cache.
    delete (el as unknown as { _gsap?: unknown })._gsap;
  }
}

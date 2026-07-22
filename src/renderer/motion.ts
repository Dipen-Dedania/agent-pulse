import type { Transition, Variants } from 'framer-motion';

/**
 * Shared motion vocabulary — one set of Apple-style physics for the whole
 * renderer. Import these instead of hand-writing `transition={{ duration: … }}`
 * so every surface springs with the same feel.
 *
 * Apple motion is spring-based (not duration-based), interruptible, and low on
 * overshoot. Pick by surface weight: `snappy` for small chips/toggles, `smooth`
 * for panels/cards, `gentle` for large surfaces and modals.
 *
 * Everything here is gated by `<MotionConfig reducedMotion="user">` at the app
 * root, so transforms/layout collapse to instant when the OS asks for it.
 */

/** Snappy, low-overshoot — pills, tab indicator, toggle knob. */
export const snappy: Transition = { type: 'spring', stiffness: 500, damping: 36, mass: 0.9 };

/** Smooth medium — section cards, panel content, tab cross-fades. */
export const smooth: Transition = { type: 'spring', stiffness: 320, damping: 32, mass: 0.9 };

/** Gentle — large surfaces / modals (a touch of settle). */
export const gentle: Transition = { type: 'spring', stiffness: 220, damping: 26, mass: 1 };

/** Named bundle, for `transition={spring.smooth}` call sites that prefer it. */
export const spring = { snappy, smooth, gentle } as const;

/** Press "give" — a small scale-down on tap, spring back on release. */
export const press = {
  whileTap: { scale: 0.97 },
  transition: snappy,
} as const;

/** Subtle hover lift for interactive glass tiles. */
export const hoverLift = {
  whileHover: { scale: 1.01 },
  whileTap: { scale: 0.99 },
  transition: smooth,
} as const;

/**
 * Tab / panel content cross-fade. Pair with `AnimatePresence mode="wait"` and a
 * `key` that changes when the active view changes. Small upward drift on enter,
 * slight downward on exit reads as content "settling" into place.
 */
export const tabContent: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

/** Transition to use with {@link tabContent}. */
export const tabContentTransition: Transition = { ...smooth, opacity: { duration: 0.18 } };

/**
 * Staggered list container — children using {@link listItem} enter in sequence.
 * Apply as the parent's variants with `initial="initial" animate="animate"`.
 */
export const listContainer: Variants = {
  initial: {},
  animate: { transition: { staggerChildren: 0.035 } },
};

/** List item that eases in from slightly below; use inside {@link listContainer}. */
export const listItem: Variants = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0, transition: smooth },
  exit: { opacity: 0, y: -6, transition: { duration: 0.15 } },
};

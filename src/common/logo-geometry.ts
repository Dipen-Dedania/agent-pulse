// Path data for the Agent Pulse logo's pulse bar, shared by every copy of the
// mark: `public/assets/logo.svg`, the floating launch splash `public/splash.html`,
// and the renderer's `AnimatedLogo` component. A unit test asserts the three
// stay in sync, so change the geometry here and mirror it into the two static
// copies.
//
// ViewBox is 0 0 940 940. The bar is a thick STROKED outline and the ECG line
// is part of it: the left capsule's bottom edge rises into the spike and lands
// as the right capsule's bottom edge. Both capsules are open at the top where
// they meet the spike.

/** Capsule outline with a flat bottom; the run under the spike is hidden by a dash gap. */
export const LOGO_OUTLINE_D =
  'M360 662 H165 A43 43 0 0 0 165 748 H400 H548 H790 A43 43 0 0 0 790 662 H572';

/** The ECG spike alone, so it can flatten / jitter independently. */
export const LOGO_SPIKE_D = 'M400 748 L442 642 L485 812 L530 692 L548 748';

/** The whole continuous stroke — what the heartbeat comet travels along. */
export const LOGO_FULL_PATH_D =
  'M360 662 H165 A43 43 0 0 0 165 748 H400 L442 642 L485 812 L530 692 L548 748 H790 A43 43 0 0 0 790 662 H572';

/**
 * Dash pattern (with pathLength=1000) that hides the outline's straight run
 * under the spike. Closing the gap (`432 0 568`) turns the bar into a flat line.
 */
export const LOGO_OUTLINE_DASH = '432 113 455';
export const LOGO_OUTLINE_DASH_FLAT = '432 0 568';

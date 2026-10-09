/**
 * The one door from the landing site into the desktop app's source.
 * Everything re-exported here renders with plain React + GSAP (no Electron,
 * no IPC, no Tailwind), so the site shows the exact characters the app ships.
 * Loaded lazily — GSAP and sixteen rigs stay out of the first paint.
 */
export type { AgentState, MascotId } from '@app/common/types';
export {
  MASCOT_COMPONENTS,
  MASCOT_PREVIEW_WIDTH,
} from '@app/renderer/components/Bubble/mascotRegistry';
export { ParticleOrb } from '@app/renderer/components/Bubble/ParticleOrb';

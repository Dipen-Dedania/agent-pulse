/**
 * Lazy chunk: renders the real app mascot (or particle orb) for a state.
 * Kept separate so GSAP and the rigs load after first paint.
 */
import { useEffect } from 'react';
import gsap from 'gsap';
import { MASCOT_COMPONENTS, MASCOT_PREVIEW_WIDTH, ParticleOrb } from './appMascots';
import type { AgentState, Character } from './stateMeta';
import { prefersReducedMotion } from './stateMeta';
import { tools } from '../../data/tools';

interface Props {
  character: Character;
  state: AgentState;
  /** Box the character is fitted into, in px. */
  size: number;
}

// Reduced motion: freeze every GSAP timeline, so mascots hold their rest pose.
let motionChecked = false;
function applyReducedMotion() {
  if (motionChecked) return;
  motionChecked = true;
  if (prefersReducedMotion()) gsap.globalTimeline.pause();
}

export default function CharacterView({ character, state, size }: Props) {
  useEffect(applyReducedMotion, []);

  if (character === 'orb') {
    const d = Math.round(size * 0.82);
    // ParticleOrb paints an absolutely-positioned canvas over its parent.
    return (
      <div
        className="relative flex items-center justify-center rounded-full border border-mist-border"
        style={{ width: d, height: d }}
      >
        <ParticleOrb state={state} iconSrc={tools[0].logo} iconAlt="" size={d} isDark={false} />
      </div>
    );
  }

  const Mascot = MASCOT_COMPONENTS[character];
  // Preview widths are tuned so every rig lands at a similar height at ~78px.
  const width = Math.round((MASCOT_PREVIEW_WIDTH[character] / 78) * size);
  return <Mascot key={character} state={state} width={width} />;
}

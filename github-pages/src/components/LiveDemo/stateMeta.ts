import { colorsFor } from '@app/common/stateColors';
import type { AgentState, MascotId } from '@app/common/types';

export type { AgentState };

/** What sits inside a demo bubble: one of the app's mascots, or the particle orb. */
export type Character = Exclude<MascotId, 'none'> | 'orb';

export const STATES: AgentState[] = ['working', 'waiting', 'idle-active', 'idle', 'error'];

/** Labels match the app's States reference; dots use the light palette. */
export const STATE_META: Record<AgentState, { label: string; dot: string }> = {
  working: { label: 'Working', dot: '#16a34a' },
  waiting: { label: 'Waiting', dot: '#2563eb' },
  'idle-active': { label: 'Idle (active)', dot: '#d97706' },
  idle: { label: 'Idle', dot: '#a6bbd1' },
  error: { label: 'Error', dot: '#dc2626' },
};

/** The app's own light-theme orb fill, so the CSS fallback matches the real orb. */
export function orbFill(state: AgentState): string {
  return `radial-gradient(circle, ${colorsFor(state, false).fill} 0%, rgba(128,128,128,0.06) 100%)`;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

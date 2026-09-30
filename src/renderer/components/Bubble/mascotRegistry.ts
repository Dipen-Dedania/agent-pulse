import React from 'react';
import { AgentState, MascotId } from '../../../common/types';
import { ClawdMascot } from './ClawdMascot';
import { CodexMascot } from './CodexMascot';
import { AntigravityMascot } from './AntigravityMascot';
import { KiroMascot } from './KiroMascot';
import { MicoMascot } from './MicoMascot';
import { MercMascot } from './MercMascot';
import { JollyMascot } from './JollyMascot';
import { ByteMascot } from './ByteMascot';
import { RustyMascot } from './RustyMascot';
import { KnightMascot } from './KnightMascot';
import { SenseiMascot } from './SenseiMascot';
import { SproutMascot } from './SproutMascot';
import { DroidMascot } from './DroidMascot';

// ─── Mascot registry: the component half ─────────────────────────────────────
// Every animated character that can replace a bubble's orb, keyed by MascotId.
// The sizes that go with each (rendered width, window footprint) live in
// src/common/mascotGeometry.ts so the main process can read them too. Bubble,
// Settings and the States tab all look mascots up here; adding one is a new
// entry in both tables and nothing else.

export type MascotComponent = React.ComponentType<{ state: AgentState; width: number }>;

export const MASCOT_COMPONENTS: Record<Exclude<MascotId, 'none'>, MascotComponent> = {
  clawd: ClawdMascot,
  frog: CodexMascot,
  gigi: AntigravityMascot,
  ghost: KiroMascot,
  mico: MicoMascot,
  merc: MercMascot,
  jolly: JollyMascot,
  byte: ByteMascot,
  rusty: RustyMascot,
  knight: KnightMascot,
  sensei: SenseiMascot,
  sprout: SproutMascot,
  droid: DroidMascot,
};

// Width used by the Settings "Mascot States" preview cards, chosen per mascot so
// the differing viewBox aspect ratios land at a similar rendered height.
export const MASCOT_PREVIEW_WIDTH: Record<Exclude<MascotId, 'none'>, number> = {
  clawd: 78,
  frog: 64,
  gigi: 58,
  ghost: 78,
  mico: 78,
  merc: 78,
  jolly: 78,
  byte: 78,
  rusty: 78,
  knight: 78,
  sensei: 78,
  sprout: 78,
  droid: 78,
};

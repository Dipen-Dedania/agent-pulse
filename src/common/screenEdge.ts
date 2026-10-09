import type { ScreenEdgeColor, ScreenEdgeSpeed, ScreenEdgeStyle } from './types';

// Shared vocabulary for the ambient screen border: the option lists the
// Settings UI offers, the palettes and timings the overlay renders with, and
// the payload main sends each overlay window. Lives in common/ so main (preview
// length, migration whitelists) and the renderer never drift apart.

export const SCREEN_EDGE_STYLES: ScreenEdgeStyle[] = ['glow', 'comet'];
export const SCREEN_EDGE_COLORS: ScreenEdgeColor[] = ['blue', 'green', 'purple', 'orange', 'pink', 'silver'];
export const SCREEN_EDGE_SPEEDS: ScreenEdgeSpeed[] = ['slow', 'normal', 'fast'];

export interface EdgePalette {
  bright: string; // comet head / landing rim
  brand: string;  // halo + glow body
  deep: string;   // tail end
  glow: string;   // rgba used by the breathing glow style
}

// `blue` is the status (waiting) colour — the glow keeps the exact rgba it has
// always used (stateColors `waiting.glow.dark`) so the default look is unchanged.
export const EDGE_PALETTES: Record<ScreenEdgeColor, EdgePalette> = {
  blue:   { bright: '#a8d1ff', brand: '#3b82f6', deep: '#1d4ed8', glow: 'rgba(59,130,246,0.5)' },
  green:  { bright: '#9ff5c4', brand: '#22c55e', deep: '#15803d', glow: 'rgba(34,197,94,0.5)' },
  purple: { bright: '#d9bbff', brand: '#9b5cf6', deep: '#6d28d9', glow: 'rgba(155,92,246,0.5)' },
  orange: { bright: '#ffd88a', brand: '#f59e0b', deep: '#ea580c', glow: 'rgba(245,158,11,0.5)' },
  pink:   { bright: '#ffbfe3', brand: '#ec4899', deep: '#be185d', glow: 'rgba(236,72,153,0.5)' },
  silver: { bright: '#ffffff', brand: '#cbd5e1', deep: '#7c8ba3', glow: 'rgba(203,213,225,0.45)' },
};

export interface EdgeTiming {
  glowBreath: number; // s — one full breath of the glow style
  lap: number;        // s — comet travel time for one lap of the screen
  land: number;       // s — landing flash + rim
  rest: number;       // s — dark gap before the next lap (animation loop idles)
}

export const EDGE_TIMINGS: Record<ScreenEdgeSpeed, EdgeTiming> = {
  slow:   { glowBreath: 4.0, lap: 4.6, land: 1.0, rest: 2.4 },
  normal: { glowBreath: 2.6, lap: 3.2, land: 0.9, rest: 1.7 },
  fast:   { glowBreath: 1.8, lap: 2.3, land: 0.8, rest: 1.2 },
};

// How long the Settings "Preview" keeps the border lit: one full comet cycle
// (lap + landing + a beat), or a couple of breaths of the glow.
export function previewMs(style: ScreenEdgeStyle, speed: ScreenEdgeSpeed): number {
  const t = EDGE_TIMINGS[speed];
  const seconds = style === 'comet' ? t.lap + t.land + 0.4 : Math.max(4, t.glowBreath * 1.6);
  return Math.round(seconds * 1000);
}

// Per-window geometry main measures for the display the overlay covers.
export interface EdgeNotch {
  width: number;  // DIP
  height: number; // DIP, measured from the window's top edge
}

// A corner of the overlay window: top-left, top-right, bottom-right, bottom-left.
export type EdgeCorner = 'tl' | 'tr' | 'br' | 'bl';

export interface EdgeGeometry {
  notch: EdgeNotch | null; // a real camera notch inside this window, if any
  cornerRadius: number;    // DIP — the display's own rounded corners (0 = square)
  trayCorner: EdgeCorner;  // where the comet lands when there's no notch: next to the tray / menu bar icons
}

export interface ScreenEdgePayload {
  active: boolean;
  paused: boolean; // screen locked / system asleep — stop animating, keep state
  style: ScreenEdgeStyle;
  color: ScreenEdgeColor;
  speed: ScreenEdgeSpeed;
  geometry: EdgeGeometry;
}

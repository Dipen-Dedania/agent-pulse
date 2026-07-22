import { AgentState } from './types';

// Single source of truth for the visual palette of every AgentState.
// Each block keeps fill / glow / ring / label colors together so they can't
// drift. Adding a new state = adding one block here.

export interface StateColors {
  fill: { dark: string; light: string };
  glow: { dark: string; light: string };
  // Orbiting/static ring shown for active states. null = no ring.
  ring: { dark: string; light: string } | null;
  // Tailwind class for the legend label. Includes a `light:` override so the
  // label stays legible on the light-theme's pale card background.
  textClass: string;
}

export const STATE_COLORS: Record<AgentState, StateColors> = {
  idle: {
    fill: { dark: 'rgba(255,255,255,0.12)', light: 'rgba(0,0,0,0.08)' },
    glow: { dark: 'rgba(255,255,255,0.08)', light: 'rgba(0,0,0,0.06)' },
    ring: null,
    textClass: 'text-white light:text-gray-600',
  },
  'idle-active': {
    fill: { dark: 'rgba(245,158,11,0.5)', light: 'rgba(217,119,6,0.4)' },
    glow: { dark: 'rgba(245,158,11,0.4)', light: 'rgba(217,119,6,0.35)' },
    ring: null,
    textClass: 'text-amber-300 light:text-amber-600',
  },
  waiting: {
    fill: { dark: 'rgba(59,130,246,0.55)', light: 'rgba(37,99,235,0.45)' },
    glow: { dark: 'rgba(59,130,246,0.5)', light: 'rgba(37,99,235,0.4)' },
    ring: { dark: 'rgba(59,130,246,0.55)', light: 'rgba(37,99,235,0.5)' },
    textClass: 'text-blue-300 light:text-blue-600',
  },
  working: {
    fill: { dark: 'rgba(34,197,94,0.55)', light: 'rgba(22,163,74,0.45)' },
    glow: { dark: 'rgba(34,197,94,0.5)', light: 'rgba(22,163,74,0.4)' },
    ring: { dark: 'rgba(34,197,94,0.45)', light: 'rgba(22,163,74,0.4)' },
    textClass: 'text-emerald-300 light:text-emerald-600',
  },
  error: {
    fill: { dark: 'rgba(239,68,68,0.55)', light: 'rgba(220,38,38,0.45)' },
    glow: { dark: 'rgba(239,68,68,0.5)', light: 'rgba(220,38,38,0.4)' },
    ring: null,
    textClass: 'text-red-400 light:text-red-600',
  },
};

export function colorsFor(state: AgentState, isDark: boolean) {
  const c = STATE_COLORS[state];
  return {
    fill: isDark ? c.fill.dark : c.fill.light,
    glow: isDark ? c.glow.dark : c.glow.light,
    ring: c.ring ? (isDark ? c.ring.dark : c.ring.light) : null,
    textClass: c.textClass,
  };
}

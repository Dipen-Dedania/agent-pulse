import { BubbleSize, MascotId, ToolId } from './types';

// ─── Mascot registry: the data half ──────────────────────────────────────────
// Everything about a mascot that BOTH processes need lives here: the main
// process sizes bubble windows from `window`, the renderer scales the SVG from
// `width`. The React components themselves are renderer-only and are looked up
// in `src/renderer/components/Bubble/mascotRegistry.ts` by the same ids.
//
// Adding a mascot = one entry here + one entry in the renderer registry. The
// settings picker, the States tab, the bubble render branch and the window
// footprint all iterate these tables instead of naming mascots by hand.

// Every pickable mascot, in the order the settings picker lists them.
export const MASCOT_IDS: Exclude<MascotId, 'none'>[] = [
  'clawd', 'frog', 'gigi', 'ghost', 'mico', 'merc', 'jolly', 'byte', 'rusty', 'knight', 'sensei', 'sprout', 'droid', 'frost', 'scorch', 'smooth',
];

export const MASCOT_LABELS: Record<MascotId, string> = {
  none: 'None',
  clawd: 'Clawd',
  frog: 'Frog',
  gigi: 'GIGI',
  ghost: 'Ghost',
  mico: 'Mico',
  merc: 'Merc',
  jolly: 'Jolly',
  byte: 'Byte',
  rusty: 'Rusty',
  knight: 'Knight',
  sensei: 'Sensei',
  sprout: 'Sprout',
  droid: 'Droid',
  frost: 'Frost',
  scorch: 'Scorch',
  smooth: 'Smooth',
};

// One-line hint shown under the picker, so a user knows which character a
// name refers to before enabling it.
export const MASCOT_HINTS: Record<Exclude<MascotId, 'none'>, string> = {
  clawd: 'Orange crab — Claude Code',
  frog: 'Green frog — OpenAI Codex',
  gigi: 'Blue droplet — Antigravity',
  ghost: 'White ghost — Kiro',
  mico: 'Purple blob — VS Code Copilot',
  merc: 'Red-masked mercenary with twin swords',
  jolly: 'Fluffy cream plush in shades — Muse Code',
  byte: 'Yellow chomper that eats dots',
  rusty: 'Tan compactor robot with binocular eyes',
  knight: 'Caped dark vigilante with a gold emblem',
  sensei: 'Black-and-white panda with kung fu moves',
  sprout: 'Bark-skinned sapling that dances',
  droid: 'Chrome dome droid with a tool arm',
  frost: 'Ice-blue hooded ninja that freezes and shatters',
  scorch: 'Gold hooded ninja with a rope spear',
  smooth: 'Black-suited dancer in a fedora and one white glove',
};

// The agent each vendor character "belongs" to. Used by the master switch in
// Settings (turn everything on → each tool gets its home mascot) and by the
// States tab picker to show a tool logo beside the mascot name. A mascot with
// no home tool (e.g. Rusty, Sensei) is still assignable to any agent.
export const MASCOT_HOME: Partial<Record<ToolId, Exclude<MascotId, 'none'>>> = {
  'claude-code': 'clawd',
  'openai-codex': 'frog',
  'antigravity-cli': 'gigi',
  kiro: 'ghost',
  'vscode-copilot': 'mico',
  grok: 'merc',
  'muse-code': 'jolly',
  opencode: 'byte',
  cursor: 'knight',
};

export interface MascotGeometry {
  // Rendered SVG width in px per bubble size; height follows the viewBox.
  width: Record<BubbleSize, number>;
  // Bubble window footprint per size while this mascot is shown. Width matches
  // the orb window where possible so the right-edge-aligned stack keeps one
  // vertical centerline; height adds the usage-bar strip plus breathing room.
  window: Record<BubbleSize, { width: number; height: number }>;
}

export const MASCOT_GEOMETRY: Record<Exclude<MascotId, 'none'>, MascotGeometry> = {
  // Clawd's tuned widths scaled to 80%; square viewBox.
  clawd: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  // The frog is taller than Clawd (held sign + splayed hind legs) at 60% width.
  frog: {
    width: { small: 42, medium: 52, large: 62 },
    window: { small: { width: 58, height: 74 }, medium: { width: 70, height: 90 }, large: { width: 86, height: 104 } },
  },
  // GIGI is a tall teardrop at 60% width, so it gets more vertical room.
  gigi: {
    width: { small: 40, medium: 50, large: 61 },
    window: { small: { width: 58, height: 80 }, medium: { width: 70, height: 97 }, large: { width: 86, height: 114 } },
  },
  // Square viewBox at Clawd's widths → identical footprint to Clawd.
  ghost: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  // Clawd's widths at 120%; the window hugs the enlarged mascot, so the Copilot
  // bubble sits slightly off the shared centerline.
  mico: {
    width: { small: 65, medium: 79, large: 98 },
    window: { small: { width: 69, height: 92 }, medium: { width: 83, height: 107 }, large: { width: 102, height: 128 } },
  },
  // Merc shares Ghost's square viewBox and prop geometry, so it starts on
  // Ghost's numbers.
  merc: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  // Jolly also shares Ghost's square viewBox and prop geometry (the keyboard
  // stays inside the body's footprint), so it takes Ghost's numbers too.
  jolly: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  // The character pack (Byte, Rusty, Knight, Sensei) is drawn in the same
  // square box with the same prop geometry as Merc, so all four take Ghost's
  // numbers as well.
  byte: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  rusty: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  knight: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  sensei: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  sprout: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  droid: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  frost: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  scorch: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
  smooth: {
    width: { small: 54, medium: 66, large: 82 },
    window: { small: { width: 58, height: 81 }, medium: { width: 70, height: 94 }, large: { width: 86, height: 112 } },
  },
};

// Resolve a tool's mascot from the config map. `'none'` and missing both mean
// "show the orb".
export function mascotFor(
  mascots: Partial<Record<ToolId, MascotId>> | undefined,
  toolId: ToolId,
): Exclude<MascotId, 'none'> | null {
  const id = mascots?.[toolId];
  return id && id !== 'none' ? id : null;
}

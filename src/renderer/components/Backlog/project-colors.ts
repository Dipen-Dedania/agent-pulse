// Deterministic per-project accent colors so cards from different projects
// are distinguishable at a glance. Complete class strings only — Tailwind's
// scanner can't see interpolated names. Two projects can share a hue once the
// palette wraps; the label text still disambiguates.

export interface ProjectColor {
  /** Label chip on card tiles. */
  chip: string;
  /** Filter-bar chip, inactive. */
  filter: string;
  /** Filter-bar chip, active. */
  filterActive: string;
}

// Each string carries its dark value plus a `light:` override (see the
// `light` custom variant in index.css). On the near-white light surfaces the
// pale `-100/-200/-300` tints vanish, so light theme drops to `-700/-800`; the
// three hues with semantic tokens (blue→info, emerald→ok, amber→warn) flip
// automatically and only their bright hover/active tints need an override.
const PALETTE: ProjectColor[] = [
  {
    chip: 'bg-blue-500/15 text-info',
    filter: 'bg-blue-500/10 text-info/80 hover:bg-blue-500/20 hover:text-blue-200 light:hover:text-blue-800',
    filterActive: 'bg-blue-500/30 text-blue-100 light:text-blue-800 shadow-inner',
  },
  {
    chip: 'bg-violet-500/15 text-violet-300 light:text-violet-700',
    filter: 'bg-violet-500/10 text-violet-300/80 light:text-violet-700/90 hover:bg-violet-500/20 hover:text-violet-200 light:hover:text-violet-800',
    filterActive: 'bg-violet-500/30 text-violet-100 light:text-violet-800 shadow-inner',
  },
  {
    chip: 'bg-emerald-500/15 text-ok',
    filter: 'bg-emerald-500/10 text-ok/80 hover:bg-emerald-500/20 hover:text-emerald-200 light:hover:text-emerald-800',
    filterActive: 'bg-emerald-500/30 text-emerald-100 light:text-emerald-800 shadow-inner',
  },
  {
    chip: 'bg-amber-500/15 text-warn',
    filter: 'bg-amber-500/10 text-warn/80 hover:bg-amber-500/20 hover:text-amber-200 light:hover:text-amber-800',
    filterActive: 'bg-amber-500/30 text-amber-100 light:text-amber-800 shadow-inner',
  },
  {
    chip: 'bg-rose-500/15 text-rose-300 light:text-rose-700',
    filter: 'bg-rose-500/10 text-rose-300/80 light:text-rose-700/90 hover:bg-rose-500/20 hover:text-rose-200 light:hover:text-rose-800',
    filterActive: 'bg-rose-500/30 text-rose-100 light:text-rose-800 shadow-inner',
  },
  {
    chip: 'bg-cyan-500/15 text-cyan-300 light:text-cyan-700',
    filter: 'bg-cyan-500/10 text-cyan-300/80 light:text-cyan-700/90 hover:bg-cyan-500/20 hover:text-cyan-200 light:hover:text-cyan-800',
    filterActive: 'bg-cyan-500/30 text-cyan-100 light:text-cyan-800 shadow-inner',
  },
  {
    chip: 'bg-fuchsia-500/15 text-fuchsia-300 light:text-fuchsia-700',
    filter: 'bg-fuchsia-500/10 text-fuchsia-300/80 light:text-fuchsia-700/90 hover:bg-fuchsia-500/20 hover:text-fuchsia-200 light:hover:text-fuchsia-800',
    filterActive: 'bg-fuchsia-500/30 text-fuchsia-100 light:text-fuchsia-800 shadow-inner',
  },
  {
    chip: 'bg-lime-500/15 text-lime-300 light:text-lime-700',
    filter: 'bg-lime-500/10 text-lime-300/80 light:text-lime-700/90 hover:bg-lime-500/20 hover:text-lime-200 light:hover:text-lime-800',
    filterActive: 'bg-lime-500/30 text-lime-100 light:text-lime-800 shadow-inner',
  },
];

export function projectColor(projectId: string): ProjectColor {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

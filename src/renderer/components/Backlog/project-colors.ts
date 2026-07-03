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

const PALETTE: ProjectColor[] = [
  {
    chip: 'bg-blue-500/15 text-blue-300',
    filter: 'bg-blue-500/10 text-blue-300/80 hover:bg-blue-500/20 hover:text-blue-200',
    filterActive: 'bg-blue-500/30 text-blue-100 shadow-inner',
  },
  {
    chip: 'bg-violet-500/15 text-violet-300',
    filter: 'bg-violet-500/10 text-violet-300/80 hover:bg-violet-500/20 hover:text-violet-200',
    filterActive: 'bg-violet-500/30 text-violet-100 shadow-inner',
  },
  {
    chip: 'bg-emerald-500/15 text-emerald-300',
    filter: 'bg-emerald-500/10 text-emerald-300/80 hover:bg-emerald-500/20 hover:text-emerald-200',
    filterActive: 'bg-emerald-500/30 text-emerald-100 shadow-inner',
  },
  {
    chip: 'bg-amber-500/15 text-amber-300',
    filter: 'bg-amber-500/10 text-amber-300/80 hover:bg-amber-500/20 hover:text-amber-200',
    filterActive: 'bg-amber-500/30 text-amber-100 shadow-inner',
  },
  {
    chip: 'bg-rose-500/15 text-rose-300',
    filter: 'bg-rose-500/10 text-rose-300/80 hover:bg-rose-500/20 hover:text-rose-200',
    filterActive: 'bg-rose-500/30 text-rose-100 shadow-inner',
  },
  {
    chip: 'bg-cyan-500/15 text-cyan-300',
    filter: 'bg-cyan-500/10 text-cyan-300/80 hover:bg-cyan-500/20 hover:text-cyan-200',
    filterActive: 'bg-cyan-500/30 text-cyan-100 shadow-inner',
  },
  {
    chip: 'bg-fuchsia-500/15 text-fuchsia-300',
    filter: 'bg-fuchsia-500/10 text-fuchsia-300/80 hover:bg-fuchsia-500/20 hover:text-fuchsia-200',
    filterActive: 'bg-fuchsia-500/30 text-fuchsia-100 shadow-inner',
  },
  {
    chip: 'bg-lime-500/15 text-lime-300',
    filter: 'bg-lime-500/10 text-lime-300/80 hover:bg-lime-500/20 hover:text-lime-200',
    filterActive: 'bg-lime-500/30 text-lime-100 shadow-inner',
  },
];

export function projectColor(projectId: string): ProjectColor {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) hash = (hash * 31 + projectId.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

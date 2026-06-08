import {
  StatusLineConfig,
  StatusLineSegment,
  StatusLineColor,
  StatusLineThreshold,
} from './types';

// ─── Status-line reference renderer ──────────────────────────────────────────
// The single source of truth for how a StatusLineConfig turns into rendered
// segments. The React live preview consumes this directly (mapping the named
// colors to CSS). The deployed Node renderer script (built in config-writer)
// is a close port of this same logic that emits ANSI escapes instead. Keeping
// the spec here means preview == actual output for the Node runtime; the Python
// and PowerShell renderers are hand-ported from the same rules.

// A rendered piece of text plus its resolved (non-`auto`) color.
export interface RenderedSegment {
  text: string;
  color: Exclude<StatusLineColor, 'auto'>;
}

export interface RenderedLine {
  segments: RenderedSegment[];
  separator: string;   // the separator that joins this row's segments
}

export interface RenderedStatusLine {
  lines: RenderedLine[];
  // Convenience: each line's segment texts joined by its separator.
  text: string;
}

// Default value→color stops shared by contextBar and rateLimit when a segment
// doesn't specify its own. Lower usage = calmer color.
const DEFAULT_THRESHOLDS: StatusLineThreshold[] = [
  { at: 0, color: 'green' },
  { at: 50, color: 'yellow' },
  { at: 80, color: 'red' },
];

// Suggested emoji per segment type. Not applied automatically — only when a
// segment opts in via `seg.icon`. The editor offers these as one-click defaults
// and the shipped DEFAULTS use them, so fresh installs look like the docs.
export const DEFAULT_SEGMENT_ICON: Record<string, string> = {
  model: '🧠',
  contextBar: '',
  cwd: '📁',
  projectDir: '📂',
  gitBranch: '🌿',
  repo: '📦',
  cost: '💰',
  duration: '⏰',
  linesChanged: '±',
  rateLimit: '📊',
  outputStyle: '🎨',
  effort: '⚡',
  vimMode: '⌨',
  pr: '🔀',
};

// Base color used when a segment has none set (and isn't value-colored).
const DEFAULT_SEGMENT_COLOR: Record<string, Exclude<StatusLineColor, 'auto'>> = {
  model: 'white',
  cwd: 'cyan',
  projectDir: 'cyan',
  gitBranch: 'magenta',
  repo: 'blue',
  cost: 'gray',
  duration: 'gray',
  linesChanged: 'gray',
  outputStyle: 'gray',
  effort: 'gray',
  vimMode: 'gray',
  pr: 'blue',
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// Pick the color for a percentage value: the color of the highest threshold
// whose `at` is ≤ value. Thresholds are sorted ascending defensively.
function colorForValue(pct: number, thresholds?: StatusLineThreshold[]): Exclude<StatusLineColor, 'auto'> {
  const stops = (thresholds && thresholds.length ? thresholds : DEFAULT_THRESHOLDS)
    .slice()
    .sort((a, b) => a.at - b.at);
  let color: StatusLineColor = stops[0]?.color ?? 'green';
  for (const stop of stops) {
    if (pct >= stop.at) color = stop.color;
  }
  return color === 'auto' ? 'white' : color;
}

// Safe nested getter so a missing/null branch never throws.
function get(obj: any, ...keys: string[]): any {
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

// Render a single segment against the session JSON. Returns null when the
// underlying field is absent — the segment is then skipped entirely so the
// line doesn't show empty labels or stray separators.
function renderSegment(seg: StatusLineSegment, session: any): RenderedSegment | null {
  const base = (seg.color && seg.color !== 'auto')
    ? seg.color
    : (DEFAULT_SEGMENT_COLOR[seg.type] ?? 'white');

  switch (seg.type) {
    case 'model': {
      const name = get(session, 'model', 'display_name');
      return name ? { text: String(name), color: base } : null;
    }
    case 'contextBar': {
      const pct = get(session, 'context_window', 'used_percentage');
      if (pct == null) return null;
      const value = clamp(Math.round(Number(pct)), 0, 100);
      const width = clamp(Math.floor(seg.width ?? 20), 4, 40);
      const fillChar = seg.fillChar || '█';
      const emptyChar = seg.emptyChar || '░';
      const filled = clamp(Math.round((value / 100) * width), 0, width);
      const bar = `[${fillChar.repeat(filled)}${emptyChar.repeat(width - filled)}]`;
      const text = seg.showPercent === false ? bar : `${bar} ${value}%`;
      const color = (seg.color && seg.color !== 'auto') ? seg.color : colorForValue(value, seg.thresholds);
      return { text, color };
    }
    case 'cwd':
    case 'projectDir': {
      const dir = seg.type === 'cwd'
        ? (get(session, 'workspace', 'current_dir') ?? get(session, 'cwd'))
        : get(session, 'workspace', 'project_dir');
      if (!dir) return null;
      const text = seg.basenameOnly === false ? String(dir) : basename(String(dir));
      return { text, color: base };
    }
    case 'gitBranch': {
      const branch = get(session, 'workspace', 'git_worktree') ?? get(session, 'worktree', 'branch');
      return branch ? { text: String(branch), color: base } : null;
    }
    case 'repo': {
      const owner = get(session, 'workspace', 'repo', 'owner');
      const name = get(session, 'workspace', 'repo', 'name');
      if (!name) return null;
      return { text: owner ? `${owner}/${name}` : String(name), color: base };
    }
    case 'cost': {
      const usd = get(session, 'cost', 'total_cost_usd');
      if (usd == null) return null;
      return { text: `$${Number(usd).toFixed(4)}`, color: base };
    }
    case 'duration': {
      const ms = get(session, 'cost', 'total_duration_ms');
      if (ms == null) return null;
      return { text: formatDuration(Number(ms)), color: base };
    }
    case 'linesChanged': {
      const added = get(session, 'cost', 'total_lines_added');
      const removed = get(session, 'cost', 'total_lines_removed');
      if (added == null && removed == null) return null;
      return { text: `+${added ?? 0} -${removed ?? 0}`, color: base };
    }
    case 'rateLimit': {
      const window = seg.window ?? 'five_hour';
      const pct = get(session, 'rate_limits', window, 'used_percentage');
      if (pct == null) return null;
      const value = clamp(Math.round(Number(pct)), 0, 100);
      const label = window === 'five_hour' ? '5h' : '7d';
      const color = (seg.color && seg.color !== 'auto') ? seg.color : colorForValue(value, seg.thresholds);
      return { text: `${label} ${value}%`, color };
    }
    case 'outputStyle': {
      const name = get(session, 'output_style', 'name');
      return name ? { text: String(name), color: base } : null;
    }
    case 'effort': {
      const level = get(session, 'effort', 'level');
      return level ? { text: `effort:${level}`, color: base } : null;
    }
    case 'vimMode': {
      const mode = get(session, 'vim', 'mode');
      return mode ? { text: String(mode), color: base } : null;
    }
    case 'pr': {
      const number = get(session, 'pr', 'number');
      if (number == null) return null;
      const reviewState = get(session, 'pr', 'review_state');
      return { text: reviewState ? `PR #${number} (${reviewState})` : `PR #${number}`, color: base };
    }
    default:
      return null;
  }
}

export function renderStatusLine(cfg: StatusLineConfig, session: any): RenderedStatusLine {
  const wrapAt = typeof cfg.maxItemsPerLine === 'number' && cfg.maxItemsPerLine > 0
    ? Math.floor(cfg.maxItemsPerLine)
    : 0;

  const lines: RenderedLine[] = (cfg.lines ?? []).flatMap((row) => {
    const sep = typeof row.separator === 'string' ? row.separator : cfg.separator;
    const segments = (row.segments ?? [])
      .filter((s) => s.enabled)
      .map((s) => {
        const rendered = renderSegment(s, session);
        if (!rendered) return null;
        // Prefix the opted-in icon, sharing the segment's resolved color.
        if (typeof s.icon === 'string' && s.icon.trim()) {
          return { ...rendered, text: `${s.icon} ${rendered.text}` };
        }
        return rendered;
      })
      .filter((s): s is RenderedSegment => s != null);

    // Auto-wrap a crowded line into chunks so it spans multiple terminal rows.
    if (wrapAt > 0 && segments.length > wrapAt) {
      const rows: RenderedLine[] = [];
      for (let i = 0; i < segments.length; i += wrapAt) {
        rows.push({ segments: segments.slice(i, i + wrapAt), separator: sep });
      }
      return rows;
    }
    return [{ segments, separator: sep }];
  });

  const text = lines
    .map((line) => line.segments.map((s) => s.text).join(line.separator))
    .filter((l) => l.length > 0)
    .join('\n');

  return { lines, text };
}

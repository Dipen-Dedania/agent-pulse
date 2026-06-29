import React from 'react';
import {
  StatusLineConfig,
  StatusLineRow,
  StatusLineSegment,
  StatusLineSegmentType,
  StatusLineColor,
  StatusLineDetectInfo,
} from '../../../common/types';
import { renderStatusLine, DEFAULT_SEGMENT_ICON } from '../../../common/statusline-render';
import { Select } from '../Shared/Select';

interface Props {
  config: StatusLineConfig;
  detect: StatusLineDetectInfo;
  onChange: (partial: Partial<StatusLineConfig>) => void;
  onInstall: (replace?: boolean) => void;
  onRemove: () => void;
  onReset: () => void;
}

// Human labels for each segment type, shown in the editor rows.
const SEGMENT_LABEL: Record<StatusLineSegmentType, string> = {
  model: 'Model name',
  contextBar: 'Context bar',
  cwd: 'Directory',
  projectDir: 'Project directory',
  gitBranch: 'Git branch',
  repo: 'Repository',
  cost: 'Session cost',
  duration: 'Session duration',
  linesChanged: 'Lines changed',
  rateLimit: 'Rate limit',
  outputStyle: 'Output style',
  effort: 'Effort level',
  vimMode: 'Vim mode',
  pr: 'Pull request',
};

const COLOR_OPTIONS: StatusLineColor[] = [
  'auto', 'white', 'gray', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan',
];

// Named colors → CSS so the live preview matches the terminal ANSI palette.
const COLOR_CSS: Record<string, string> = {
  white: '#e2e8f0', gray: '#94a3b8', red: '#f87171', green: '#4ade80',
  yellow: '#facc15', blue: '#60a5fa', magenta: '#e879f9', cyan: '#22d3ee', auto: '#e2e8f0',
};

// Representative session JSON for the preview — mirrors the documented stdin
// schema so every segment renders something.
const MOCK_SESSION = {
  model: { display_name: 'Opus 4.8' },
  context_window: { used_percentage: 38 },
  cwd: 'E:/DDrive/Github/agent-pulse',
  workspace: {
    current_dir: 'E:/DDrive/Github/agent-pulse',
    project_dir: 'E:/DDrive/Github/agent-pulse',
    git_worktree: 'main',
    repo: { owner: 'zuru', name: 'agent-pulse' },
  },
  cost: { total_cost_usd: 0.1234, total_duration_ms: 425000, total_lines_added: 156, total_lines_removed: 23 },
  rate_limits: { five_hour: { used_percentage: 23 }, seven_day: { used_percentage: 41 } },
  output_style: { name: 'default' },
  effort: { level: 'high' },
  vim: { mode: 'NORMAL' },
  pr: { number: 1234, review_state: 'pending' },
};

const RUNTIME_LABEL: Record<string, string> = {
  node: 'Node.js', python: 'Python', powershell: 'PowerShell',
};

// ── Small controls (match the toggle/select idioms used elsewhere) ────────────

const Toggle: React.FC<{ checked: boolean; onChange: () => void; label?: string }> = ({ checked, onChange, label }) => (
  <button
    onClick={onChange}
    aria-label={label ?? 'Toggle'}
    className={`relative w-10 h-5 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
      checked ? 'bg-blue-500' : 'bg-slate-600'
    }`}
  >
    <span
      className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);

const ColorSelect: React.FC<{ value: StatusLineColor; onChange: (c: StatusLineColor) => void }> = ({ value, onChange }) => (
  <Select<StatusLineColor>
    value={value}
    onChange={onChange}
    ariaLabel='Segment color'
    className='px-2 py-1 text-xs w-28'
    options={COLOR_OPTIONS.map((c) => ({
      value: c,
      label: c,
      // 'auto' colors itself by value, so it has no fixed swatch.
      swatch: c === 'auto' ? undefined : COLOR_CSS[c],
    }))}
  />
);

export const StatusLineSection: React.FC<Props> = ({ config, detect, onChange, onInstall, onRemove, onReset }) => {
  // Each entry in config.lines is one rendered row. The editor manages all of
  // them; guard against an empty config so there's always one row to edit.
  const lines = config.lines.length ? config.lines : [{ segments: [] }];
  const lastLine = lines.length - 1;

  const commitLines = (next: StatusLineRow[]) => onChange({ lines: next });

  // Deep-ish copy of the rows so per-line segment splices never mutate state.
  const cloneLines = (): StatusLineRow[] => lines.map((r) => ({ ...r, segments: r.segments.slice() }));

  const patchSegment = (li: number, si: number, patch: Partial<StatusLineSegment>) => {
    const next = lines.map((row, r) =>
      r !== li ? row : { ...row, segments: row.segments.map((s, i) => (i === si ? { ...s, ...patch } : s)) },
    );
    commitLines(next);
  };

  // Up/down reorder within a line, and across the boundary into the adjacent
  // line — so a segment "flows" between rows as you press past the edge.
  const moveSegmentUp = (li: number, si: number) => {
    const next = cloneLines();
    if (si > 0) {
      [next[li].segments[si - 1], next[li].segments[si]] = [next[li].segments[si], next[li].segments[si - 1]];
    } else if (li > 0) {
      const [seg] = next[li].segments.splice(si, 1);
      next[li - 1].segments.push(seg);
    } else return;
    commitLines(next);
  };

  const moveSegmentDown = (li: number, si: number) => {
    const next = cloneLines();
    if (si < next[li].segments.length - 1) {
      [next[li].segments[si + 1], next[li].segments[si]] = [next[li].segments[si], next[li].segments[si + 1]];
    } else if (li < next.length - 1) {
      const [seg] = next[li].segments.splice(si, 1);
      next[li + 1].segments.unshift(seg);
    } else return;
    commitLines(next);
  };

  const addLine = () => commitLines([...lines, { segments: [] }]);

  // Removing a line never drops its segments — they merge into the neighbouring
  // row so configuration is preserved. Keep at least one line.
  const removeLine = (li: number) => {
    if (lines.length <= 1) return;
    const next = cloneLines();
    const [removed] = next.splice(li, 1);
    if (li > 0) next[li - 1].segments.push(...removed.segments);
    else next[0].segments.unshift(...removed.segments);
    commitLines(next);
  };

  // Bulk icon helpers: fill every segment with its docs-style default emoji, or
  // strip them all back to plain text.
  const applyDefaultIcons = () =>
    commitLines(lines.map((r) => ({ ...r, segments: r.segments.map((s) => ({ ...s, icon: DEFAULT_SEGMENT_ICON[s.type] || '' })) })));
  const clearIcons = () =>
    commitLines(lines.map((r) => ({ ...r, segments: r.segments.map((s) => ({ ...s, icon: '' })) })));

  const preview = renderStatusLine(config, MOCK_SESSION);

  // Header chips ───────────────────────────────────────────────────────────
  const runtimeBadge = detect.runtime
    ? <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs font-medium'>{RUNTIME_LABEL[detect.runtime]} ✓</span>
    : <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-medium'>No runtime — install Node</span>;

  const stateBadge =
    detect.state === 'ours'
      ? <span className='px-2.5 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-medium'>Installed</span>
      : detect.state === 'foreign'
        ? <span className='px-2.5 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/50 text-slate-300 text-xs font-medium'>Another status line set</span>
        : <span className='px-2.5 py-0.5 rounded-full bg-slate-700/60 border border-slate-600/50 text-slate-400 text-xs font-medium'>Not installed</span>;

  return (
    <section className='mt-6 bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-6 shadow-xl'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-semibold text-white leading-tight'>Status Line</p>
          <p className='text-xs text-slate-400 mt-0.5'>Show context, cost & more in Claude Code&apos;s terminal bar.</p>
        </div>
        <div className='flex items-center gap-2 flex-wrap justify-end'>
          {runtimeBadge}
          {stateBadge}
        </div>
      </div>

      <div className='mt-5 flex flex-col gap-5'>
          {/* Live preview — each config line on its own row; long rows scroll
              horizontally so they never break the panel layout. */}
          <div className='bg-slate-900/70 border border-slate-700/60 rounded-xl px-4 py-3'>
            <p className='text-[10px] uppercase tracking-widest text-slate-500 mb-2'>Preview</p>
            <div className='font-mono text-sm leading-relaxed overflow-x-auto'>
              {preview.lines.map((pl, i) => (
                <div key={i} className='whitespace-pre w-max'>
                  {pl.segments.length === 0 ? (
                    <span className='text-slate-600 italic'>—</span>
                  ) : (
                    pl.segments.map((seg, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <span className='text-slate-500'>{pl.separator}</span>}
                        <span style={{ color: COLOR_CSS[seg.color] ?? COLOR_CSS.white }}>{seg.text}</span>
                      </React.Fragment>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Install / remove controls */}
          <div className='bg-slate-900/40 border border-slate-700/50 rounded-xl p-4 flex flex-wrap items-center gap-3'>
            {detect.state === 'ours' ? (
              <>
                <p className='text-sm text-slate-300 flex-1 min-w-0'>
                  Installed via {detect.runtime ? RUNTIME_LABEL[detect.runtime] : 'a script'}. Edits below apply live.
                </p>
                <button
                  onClick={() => onInstall(true)}
                  className='px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors cursor-pointer'
                >
                  Re-apply
                </button>
                <button
                  onClick={onRemove}
                  className='px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors cursor-pointer'
                >
                  Remove
                </button>
              </>
            ) : detect.state === 'foreign' ? (
              <>
                <p className='text-sm text-amber-300/90 flex-1 min-w-0'>
                  A different status line is already configured. Replacing it backs up your <span className='font-mono'>settings.json</span> first.
                </p>
                <button
                  onClick={() => onInstall(true)}
                  disabled={!detect.runtime}
                  className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700/40 disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors cursor-pointer'
                >
                  Back up &amp; replace
                </button>
              </>
            ) : (
              <>
                <p className='text-sm text-slate-300 flex-1 min-w-0'>
                  {detect.runtime
                    ? 'Install the status line into Claude Code.'
                    : 'No script runtime (Node, Python, or PowerShell) was found on PATH.'}
                </p>
                <button
                  onClick={() => onInstall(false)}
                  disabled={!detect.runtime}
                  className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700/40 disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors cursor-pointer'
                >
                  Install
                </button>
              </>
            )}
          </div>

          {/* Segment editor */}
          <div>
            <div className='flex items-center justify-between gap-3 mb-2'>
              <p className='text-[10px] uppercase tracking-widest text-slate-500'>Segments</p>
              <div className='flex items-center gap-2'>
                <button
                  onClick={applyDefaultIcons}
                  className='text-xs px-2.5 py-1 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer'
                >
                  Add emoji icons
                </button>
                <button
                  onClick={clearIcons}
                  className='text-xs px-2.5 py-1 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer'
                >
                  Clear icons
                </button>
              </div>
            </div>

            <div className='flex flex-col gap-4'>
              {lines.map((row, li) => (
                <div key={li} className='rounded-xl border border-slate-700/50 bg-slate-900/30 p-3'>
                  <div className='flex items-center justify-between mb-2'>
                    <span className='text-[10px] uppercase tracking-widest text-slate-500'>Line {li + 1}</span>
                    {lines.length > 1 && (
                      <button
                        onClick={() => removeLine(li)}
                        className='text-xs text-slate-500 hover:text-red-400 transition-colors cursor-pointer'
                      >
                        Remove line
                      </button>
                    )}
                  </div>

                  <div className='flex flex-col gap-2'>
                    {row.segments.length === 0 ? (
                      <p className='text-xs text-slate-600 italic px-1 py-2'>
                        Empty line — move a segment here with the ↑ / ↓ arrows.
                      </p>
                    ) : (
                      row.segments.map((seg, si) => (
                        <div
                          key={`${seg.type}-${si}`}
                          className='bg-slate-900/40 border border-slate-700/50 rounded-xl p-3 flex flex-wrap items-center gap-3'
                        >
                          <Toggle checked={seg.enabled} onChange={() => patchSegment(li, si, { enabled: !seg.enabled })} label={`Toggle ${SEGMENT_LABEL[seg.type]}`} />

                          {/* Icon / emoji prefix */}
                          <input
                            type='text'
                            value={seg.icon ?? ''}
                            placeholder={DEFAULT_SEGMENT_ICON[seg.type] || '—'}
                            maxLength={4}
                            onChange={(e) => patchSegment(li, si, { icon: e.target.value })}
                            aria-label={`Icon for ${SEGMENT_LABEL[seg.type]}`}
                            title='Optional emoji or glyph shown before this segment'
                            className='w-11 text-center bg-slate-900/60 border border-slate-700/70 rounded-lg px-1 py-1 text-sm text-white focus:outline-none focus:border-blue-500/60'
                          />

                          <span className={`text-sm font-medium w-32 ${seg.enabled ? 'text-white' : 'text-slate-500'}`}>
                            {SEGMENT_LABEL[seg.type]}
                          </span>

                          <ColorSelect value={seg.color ?? 'auto'} onChange={(c) => patchSegment(li, si, { color: c })} />

                          {/* Type-specific controls */}
                          {seg.type === 'contextBar' && (
                            <>
                              <label className='flex items-center gap-1.5 text-xs text-slate-400'>
                                Width
                                <input
                                  type='number'
                                  min={4}
                                  max={40}
                                  value={seg.width ?? 20}
                                  onChange={(e) => patchSegment(li, si, { width: Math.max(4, Math.min(40, Number(e.target.value) || 20)) })}
                                  className='w-16 bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500/60'
                                />
                              </label>
                              <label className='flex items-center gap-1.5 text-xs text-slate-400'>
                                <Toggle checked={seg.showPercent !== false} onChange={() => patchSegment(li, si, { showPercent: !(seg.showPercent !== false) })} label='Toggle percent' />
                                %
                              </label>
                            </>
                          )}
                          {seg.type === 'rateLimit' && (
                            <Select<'five_hour' | 'seven_day'>
                              value={seg.window ?? 'five_hour'}
                              onChange={(w) => patchSegment(li, si, { window: w })}
                              ariaLabel='Rate limit window'
                              className='px-2 py-1 text-xs w-24'
                              options={[
                                { value: 'five_hour', label: '5-hour' },
                                { value: 'seven_day', label: '7-day' },
                              ]}
                            />
                          )}
                          {(seg.type === 'cwd' || seg.type === 'projectDir') && (
                            <label className='flex items-center gap-1.5 text-xs text-slate-400'>
                              <Toggle checked={seg.basenameOnly !== false} onChange={() => patchSegment(li, si, { basenameOnly: !(seg.basenameOnly !== false) })} label='Toggle basename only' />
                              Folder only
                            </label>
                          )}

                          {/* Reorder (crosses line boundaries at the edges) */}
                          <div className='ml-auto flex items-center gap-1'>
                            <button
                              onClick={() => moveSegmentUp(li, si)}
                              disabled={li === 0 && si === 0}
                              className='w-7 h-7 rounded-md text-slate-400 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors flex items-center justify-center'
                              aria-label='Move up'
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveSegmentDown(li, si)}
                              disabled={li === lastLine && si === row.segments.length - 1}
                              className='w-7 h-7 rounded-md text-slate-400 bg-slate-700/50 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors flex items-center justify-center'
                              aria-label='Move down'
                            >
                              ↓
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={addLine}
              className='mt-3 text-xs px-3 py-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer'
            >
              + Add line
            </button>

            {/* Separator + wrap + open settings */}
            <div className='mt-4 flex flex-wrap items-center gap-3'>
              <label className='flex items-center gap-2 text-xs text-slate-400'>
                Separator
                <input
                  type='text'
                  value={config.separator}
                  onChange={(e) => onChange({ separator: e.target.value })}
                  className='w-24 bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500/60'
                />
              </label>
              <label
                className='flex items-center gap-2 text-xs text-slate-400'
                title='When a line has more than this many indicators, it wraps onto extra terminal rows. 0 = never wrap.'
              >
                Wrap after
                <input
                  type='number'
                  min={0}
                  max={20}
                  value={config.maxItemsPerLine ?? 0}
                  onChange={(e) => onChange({ maxItemsPerLine: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
                  className='w-16 bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500/60'
                />
                items
              </label>
              <button
                onClick={() => window.electron.invoke('open-path', detect.settingsPath)}
                className='text-xs text-slate-500 hover:text-blue-400 transition-colors cursor-pointer font-mono'
                title={detect.settingsPath}
              >
                Open settings.json
              </button>
              <button
                onClick={onReset}
                className='ml-auto text-xs text-slate-500 hover:text-red-400 transition-colors cursor-pointer'
                title='Replace the current layout with the default two-line layout with icons'
              >
                Reset to default
              </button>
            </div>
          </div>
        </div>
    </section>
  );
};

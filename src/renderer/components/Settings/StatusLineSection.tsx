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
import { Select, GlassToggle, Tooltip, Button } from '../Shared';

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
  <GlassToggle
    checked={checked}
    onChange={() => onChange()}
    size='md'
    label={label ?? 'Toggle'}
  />
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
    ? <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-info text-xs font-medium'>{RUNTIME_LABEL[detect.runtime]} ✓</span>
    : <span className='inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-warn text-xs font-medium'>No runtime — install Node</span>;

  const stateBadge =
    detect.state === 'ours'
      ? <span className='px-2.5 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400 text-xs font-medium'>Installed</span>
      : detect.state === 'foreign'
        ? <span className='px-2.5 py-0.5 rounded-full bg-control/60 border border-edge-strong/50 text-body text-xs font-medium'>Another status line set</span>
        : <span className='px-2.5 py-0.5 rounded-full bg-control/60 border border-edge-strong/50 text-muted text-xs font-medium'>Not installed</span>;

  return (
    <section className='mt-6 glass-primary p-6'>
      {/* Header */}
      <div className='flex items-center gap-3'>
        <div className='flex-1 min-w-0'>
          <p className='font-semibold text-strong leading-tight'>Status Line</p>
          <p className='text-xs text-muted mt-0.5'>Show context, cost & more in Claude Code&apos;s terminal bar.</p>
        </div>
        <div className='flex items-center gap-2 flex-wrap justify-end'>
          {runtimeBadge}
          {stateBadge}
        </div>
      </div>

      <div className='mt-5 flex flex-col gap-5'>
          {/* Live preview — each config line on its own row; long rows scroll
              horizontally so they never break the panel layout. */}
          <div className='glass-secondary px-4 py-3'>
            <p className='text-[10px] uppercase tracking-widest text-faint mb-2'>Preview</p>
            <div className='font-mono text-sm leading-relaxed overflow-x-auto'>
              {preview.lines.map((pl, i) => (
                <div key={i} className='whitespace-pre w-max'>
                  {pl.segments.length === 0 ? (
                    <span className='text-ghost italic'>—</span>
                  ) : (
                    pl.segments.map((seg, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && <span className='text-faint'>{pl.separator}</span>}
                        <span style={{ color: COLOR_CSS[seg.color] ?? COLOR_CSS.white }}>{seg.text}</span>
                      </React.Fragment>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Install / remove controls */}
          <div className='glass-secondary p-4 flex flex-wrap items-center gap-3'>
            {detect.state === 'ours' ? (
              <>
                <p className='text-sm text-body flex-1 min-w-0'>
                  Installed via {detect.runtime ? RUNTIME_LABEL[detect.runtime] : 'a script'}. Edits below apply live.
                </p>
                <Button
                  variant='secondary'
                  onClick={() => onInstall(true)}
                  className='text-primary'
                >
                  Re-apply
                </Button>
                <Button
                  variant='secondary'
                  onClick={onRemove}
                  className='text-primary'
                >
                  Remove
                </Button>
              </>
            ) : detect.state === 'foreign' ? (
              <>
                <p className='text-sm text-warn/90 flex-1 min-w-0'>
                  A different status line is already configured. Replacing it backs up your <span className='font-mono'>settings.json</span> first.
                </p>
                <Button
                  onClick={() => onInstall(true)}
                  disabled={!detect.runtime}
                >
                  Back up &amp; replace
                </Button>
              </>
            ) : (
              <>
                <p className='text-sm text-body flex-1 min-w-0'>
                  {detect.runtime
                    ? 'Install the status line into Claude Code.'
                    : 'No script runtime (Node, Python, or PowerShell) was found on PATH.'}
                </p>
                <Button
                  onClick={() => onInstall(false)}
                  disabled={!detect.runtime}
                >
                  Install
                </Button>
              </>
            )}
          </div>

          {/* Segment editor */}
          <div>
            <div className='flex items-center justify-between gap-3 mb-2'>
              <p className='text-[10px] uppercase tracking-widest text-faint'>Segments</p>
              <div className='flex items-center gap-2'>
                <button
                  onClick={applyDefaultIcons}
                  className='text-xs px-2.5 py-1 rounded-lg bg-control/50 hover:bg-control text-body transition-colors cursor-pointer'
                >
                  Add emoji icons
                </button>
                <button
                  onClick={clearIcons}
                  className='text-xs px-2.5 py-1 rounded-lg bg-control/50 hover:bg-control text-body transition-colors cursor-pointer'
                >
                  Clear icons
                </button>
              </div>
            </div>

            <div className='flex flex-col gap-4'>
              {lines.map((row, li) => (
                <div key={li} className='glass-secondary p-3'>
                  <div className='flex items-center justify-between mb-2'>
                    <span className='text-[10px] uppercase tracking-widest text-faint'>Line {li + 1}</span>
                    {lines.length > 1 && (
                      <button
                        onClick={() => removeLine(li)}
                        className='text-xs text-faint hover:text-danger transition-colors cursor-pointer'
                      >
                        Remove line
                      </button>
                    )}
                  </div>

                  <div className='flex flex-col gap-2'>
                    {row.segments.length === 0 ? (
                      <p className='text-xs text-ghost italic px-1 py-2'>
                        Empty line — move a segment here with the ↑ / ↓ arrows.
                      </p>
                    ) : (
                      row.segments.map((seg, si) => (
                        <div
                          key={`${seg.type}-${si}`}
                          className='glass-secondary p-3 flex flex-wrap items-center gap-3'
                        >
                          <Toggle checked={seg.enabled} onChange={() => patchSegment(li, si, { enabled: !seg.enabled })} label={`Toggle ${SEGMENT_LABEL[seg.type]}`} />

                          {/* Icon / emoji prefix */}
                          <Tooltip content='Optional emoji or glyph shown before this segment'>
                            <input
                              type='text'
                              value={seg.icon ?? ''}
                              placeholder={DEFAULT_SEGMENT_ICON[seg.type] || '—'}
                              maxLength={4}
                              onChange={(e) => patchSegment(li, si, { icon: e.target.value })}
                              aria-label={`Icon for ${SEGMENT_LABEL[seg.type]}`}
                              className='w-11 text-center bg-glass/60 border border-edge/70 rounded-lg px-1 py-1 text-sm text-strong focus:outline-none focus:border-blue-500/60'
                            />
                          </Tooltip>

                          <span className={`text-sm font-medium w-32 ${seg.enabled ? 'text-strong' : 'text-faint'}`}>
                            {SEGMENT_LABEL[seg.type]}
                          </span>

                          <ColorSelect value={seg.color ?? 'auto'} onChange={(c) => patchSegment(li, si, { color: c })} />

                          {/* Type-specific controls */}
                          {seg.type === 'contextBar' && (
                            <>
                              <label className='flex items-center gap-1.5 text-xs text-muted'>
                                Width
                                <input
                                  type='number'
                                  min={4}
                                  max={40}
                                  value={seg.width ?? 20}
                                  onChange={(e) => patchSegment(li, si, { width: Math.max(4, Math.min(40, Number(e.target.value) || 20)) })}
                                  className='w-16 bg-glass/60 border border-edge/70 rounded-lg px-2 py-1 text-xs text-strong focus:outline-none focus:border-blue-500/60'
                                />
                              </label>
                              <label className='flex items-center gap-1.5 text-xs text-muted'>
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
                            <label className='flex items-center gap-1.5 text-xs text-muted'>
                              <Toggle checked={seg.basenameOnly !== false} onChange={() => patchSegment(li, si, { basenameOnly: !(seg.basenameOnly !== false) })} label='Toggle basename only' />
                              Folder only
                            </label>
                          )}

                          {/* Reorder (crosses line boundaries at the edges) */}
                          <div className='ml-auto flex items-center gap-1'>
                            <button
                              onClick={() => moveSegmentUp(li, si)}
                              disabled={li === 0 && si === 0}
                              className='w-7 h-7 rounded-md text-muted bg-control/50 hover:bg-control disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors flex items-center justify-center'
                              aria-label='Move up'
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveSegmentDown(li, si)}
                              disabled={li === lastLine && si === row.segments.length - 1}
                              className='w-7 h-7 rounded-md text-muted bg-control/50 hover:bg-control disabled:opacity-30 disabled:cursor-default cursor-pointer transition-colors flex items-center justify-center'
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
              className='mt-3 text-xs px-3 py-1.5 rounded-lg bg-control/50 hover:bg-control text-body transition-colors cursor-pointer'
            >
              + Add line
            </button>

            {/* Separator + wrap + open settings */}
            <div className='mt-4 flex flex-wrap items-center gap-3'>
              <label className='flex items-center gap-2 text-xs text-muted'>
                Separator
                <input
                  type='text'
                  value={config.separator}
                  onChange={(e) => onChange({ separator: e.target.value })}
                  className='w-24 bg-glass/60 border border-edge/70 rounded-lg px-2 py-1 text-xs text-strong font-mono focus:outline-none focus:border-blue-500/60'
                />
              </label>
              <Tooltip content='When a line has more than this many indicators, it wraps onto extra terminal rows. 0 = never wrap.'>
                <label
                  className='flex items-center gap-2 text-xs text-muted'
                >
                  Wrap after
                  <input
                    type='number'
                    min={0}
                    max={20}
                    value={config.maxItemsPerLine ?? 0}
                    onChange={(e) => onChange({ maxItemsPerLine: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
                    className='w-16 bg-glass/60 border border-edge/70 rounded-lg px-2 py-1 text-xs text-strong focus:outline-none focus:border-blue-500/60'
                  />
                  items
                </label>
              </Tooltip>
              <Tooltip content={detect.settingsPath}>
                <button
                  onClick={() => window.electron.invoke('open-path', detect.settingsPath)}
                  className='text-xs text-faint hover:text-info transition-colors cursor-pointer font-mono'
                >
                  Open settings.json
                </button>
              </Tooltip>
              <Tooltip content='Replace the current layout with the default two-line layout with icons'>
                <button
                  onClick={onReset}
                  className='ml-auto text-xs text-faint hover:text-danger transition-colors cursor-pointer'
                >
                  Reset to default
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
    </section>
  );
};

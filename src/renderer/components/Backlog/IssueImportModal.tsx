import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { IssueCandidate } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { appAlert, Button, Checkbox, Tooltip } from '../Shared';
import { projectColor } from './project-colors';
import { SOURCE_META, issueRefLabel } from './source-meta';

// Review & Import picker (Phase 3), source-neutral. The candidate list a scan
// produced (GitLab or Linear). The user ticks issues to import as Refinement
// cards, or dismisses the rest (tombstoned so they don't re-surface). A scan
// creates NO cards on its own.

interface Props {
  projectFilter: string; // 'all' or a project id — scopes the list + the Rescan
  onClose: () => void;
}

export const IssueImportModal: React.FC<Props> = ({ projectFilter, onClose }) => {
  const store = useBacklogStore();
  const candidates: IssueCandidate[] = store.population.candidates.filter(
    (c) => projectFilter === 'all' || c.projectId === projectFilter,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const scanning = store.population.scanning;
  const needsAuth = store.population.connector === 'needs-auth';

  const project = (id: string) => store.projects.find((p) => p.id === id);
  const projectName = (id: string) => project(id)?.name ?? 'unknown';
  const toggle = (fp: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp); else next.add(fp);
      return next;
    });
  const allSelected = candidates.length > 0 && candidates.every((c) => selected.has(c.fingerprint));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.fingerprint)));
  const selectedFps = () => candidates.filter((c) => selected.has(c.fingerprint)).map((c) => c.fingerprint);
  const count = selectedFps().length;

  const doImport = async () => {
    const fps = selectedFps();
    if (fps.length === 0) return;
    setBusy(true);
    const res = await store.importCandidates(fps);
    setBusy(false);
    setSelected(new Set());
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  const doDismiss = async () => {
    const fps = selectedFps();
    if (fps.length === 0) return;
    setBusy(true);
    const res = await store.dismissCandidates(fps);
    setBusy(false);
    setSelected(new Set());
    if (!res.ok && res.reason) void appAlert(res.reason, 'Backlog');
  };

  const doRefresh = async () => {
    setBusy(true);
    const res = await store.scan(projectFilter === 'all' ? undefined : projectFilter);
    setBusy(false);
    if (res && res.ok === false && res.reason) void appAlert(res.reason, 'Backlog');
  };

  return createPortal(
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm' onClick={onClose}>
      <div
        className='apple-scroll relative w-full mx-4 max-w-2xl max-h-[85vh] bg-overlay/95 border border-edge/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 overflow-hidden'
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-control/60 hover:bg-control-strong text-muted hover:text-strong transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>

        <div>
          <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-1'>Issues</p>
          <h2 className='text-lg font-bold text-strong leading-tight pr-8'>Review &amp; import</h2>
          <p className='text-sm text-muted mt-1'>
            Tick the issues to add as Refinement cards. Dismissed issues won’t come back on the next scan.
          </p>
        </div>

        {needsAuth && (
          <div className='glass-secondary p-3 text-xs text-warn'>
            The issue connector needs re-authentication — reconnect it in Claude Code (<span className='font-mono'>claude</span> →
            <span className='font-mono'> /mcp</span>), then Rescan.
          </div>
        )}

        <div className='flex items-center gap-3 flex-wrap'>
          <Checkbox
            checked={allSelected}
            indeterminate={count > 0 && !allSelected}
            onChange={toggleAll}
            disabled={candidates.length === 0}
            label={candidates.length > 0 ? `${count} of ${candidates.length} selected` : 'No issues'}
          />
          <div className='ml-auto flex items-center gap-2'>
            {scanning && (
              <span className='flex items-center gap-1.5 text-xs text-muted'>
                <span className='w-3 h-3 border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin' />
                Scanning…
              </span>
            )}
            <Button variant='secondary' size='sm' onClick={() => void doRefresh()} disabled={busy || scanning}>
              ↻ Rescan
            </Button>
          </div>
        </div>

        <div className='apple-scroll flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -mx-1 px-1'>
          {candidates.length === 0 ? (
            <div className='glass-secondary p-6 text-center text-sm text-muted'>
              No new issues. Rescan to check again.
            </div>
          ) : (
            candidates.map((c) => {
              const p = project(c.projectId);
              const meta = SOURCE_META[c.sourceKind];
              const ref = issueRefLabel(c.sourceKind, c.ref);
              const displayTitle = c.title.trim().length > 0 ? c.title : `Issue ${ref}`;
              const sourceTip = p?.source
                ? c.sourceKind === 'gitlab'
                  ? `🦊 ${p.source.slug}${p.source.ref ? ` (id ${p.source.ref})` : ''}`
                  : `▲ ${p.source.name} (${p.source.slug})`
                : undefined;
              return (
              <label
                key={c.fingerprint}
                className='glass-secondary shrink-0 p-3 flex items-start gap-3 cursor-pointer'
              >
                <Checkbox
                  className='mt-0.5'
                  checked={selected.has(c.fingerprint)}
                  onChange={() => toggle(c.fingerprint)}
                  ariaLabel={`Select ${displayTitle}`}
                />
                <div className='flex-1 min-w-0'>
                  <p className='text-sm font-medium text-strong leading-snug break-words'>{displayTitle}</p>
                  <div className='flex items-center gap-2 flex-wrap mt-1.5'>
                    <Tooltip content={sourceTip}>
                      <span className={`px-1.5 py-0.5 rounded text-[11px] ${projectColor(c.projectId).chip}`}>
                        {projectName(c.projectId)}
                      </span>
                    </Tooltip>
                    <Tooltip content={c.webUrl ? `Open ${c.webUrl}` : undefined}>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (c.webUrl) void window.electron.invoke('open-external', c.webUrl); }}
                        className='px-1.5 py-0.5 rounded text-[11px] bg-orange-500/15 text-orange-300 light:text-orange-700 hover:bg-orange-500/25 cursor-pointer transition-colors font-mono'
                      >
                        {meta.icon} {ref}
                      </button>
                    </Tooltip>
                    {c.labels.slice(0, 6).map((l) => (
                      <span key={l} className='px-1.5 py-0.5 rounded text-[10px] bg-control/40 text-faint'>{l}</span>
                    ))}
                  </div>
                </div>
              </label>
              );
            })
          )}
        </div>

        <div className='flex items-center gap-2 pt-1'>
          <Button variant='primary' size='sm' onClick={() => void doImport()} disabled={busy || count === 0}>
            Import selected{count > 0 ? ` (${count})` : ''}
          </Button>
          <Button variant='ghost' size='sm' onClick={() => void doDismiss()} disabled={busy || count === 0}>
            Dismiss selected{count > 0 ? ` (${count})` : ''}
          </Button>
          <Button variant='ghost' size='sm' onClick={onClose} className='ml-auto'>Close</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

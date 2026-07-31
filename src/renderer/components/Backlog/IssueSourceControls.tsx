import React, { useState } from 'react';
import { IssueFilterMode } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { appAlert, appConfirm, Button, Select, Tooltip } from '../Shared';
import { SOURCE_META } from './source-meta';
import { LinearLinkModal } from './LinearLinkModal';

// Issue population controls (Phase 3), source-neutral (GitLab + Linear). Two pieces:
//  - IssueSourceHeaderActions: Scan + "Review issues (N)" in the board header.
//  - IssueSourceProjectStrip: per-project Link / filter / Unlink, shown under
//    the project-filter pills when a single project is selected.
// See backlog-phase3-gitlab-population-plan.md (WS5, item B).

export const IssueSourceHeaderActions: React.FC<{ projectFilter: string; onReview: () => void }> = ({ projectFilter, onReview }) => {
  const store = useBacklogStore();
  const linkedCount = store.projects.filter((p) => p.source != null).length;
  if (linkedCount === 0) return null;

  const candidates = store.population.candidates.filter((c) => projectFilter === 'all' || c.projectId === projectFilter);
  const n = candidates.length;
  const scanning = store.population.scanning;
  const needsAuth = store.population.connector === 'needs-auth';

  const doScan = async () => {
    const res = await store.scan(projectFilter === 'all' ? undefined : projectFilter);
    if (res && res.ok === false && res.reason) void appAlert(res.reason, 'Backlog');
  };

  return (
    <>
      {needsAuth && (
        <Tooltip content='The issue connector needs re-authentication in Claude Code — reconnect it, then Scan.'>
          <span className='px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/15 text-warn'>Connector: re-auth</span>
        </Tooltip>
      )}
      <Button variant='secondary' size='sm' onClick={() => void doScan()} disabled={scanning}>
        {scanning ? 'Scanning…' : '↻ Scan'}
      </Button>
      <Button variant='secondary' size='sm' onClick={onReview}>
        📥 Review issues{n > 0 ? ` (${n})` : ''}
      </Button>
    </>
  );
};

const LabelInput: React.FC<{ projectId: string; labels: string[] }> = ({ projectId, labels }) => {
  const store = useBacklogStore();
  const [text, setText] = useState(labels.join(', '));
  const commit = () => {
    const next = text.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    void store.setIssueFilter(projectId, { mode: 'label', labels: next });
  };
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder='label-a, label-b'
      aria-label='Issue labels'
      className='px-2 py-1 rounded-lg text-xs bg-control/50 text-body placeholder:text-ghost outline-none focus:bg-control-strong w-48'
    />
  );
};

export const IssueSourceProjectStrip: React.FC<{ projectId: string }> = ({ projectId }) => {
  const store = useBacklogStore();
  const project = store.projects.find((p) => p.id === projectId);
  const [busy, setBusy] = useState(false);
  const [linearOpen, setLinearOpen] = useState(false);
  if (!project) return null;
  const source = project.source;

  const doLinkGitlab = async () => {
    setBusy(true);
    const res = await store.linkGitlab(projectId);
    setBusy(false);
    if (!res.ok) void appAlert(res.reason ?? 'Could not link this project to GitLab.', 'Backlog');
    else void appAlert(`Linked to ${res.projectPath} (GitLab id ${res.id}).`, 'Backlog');
  };

  const doUnlink = async () => {
    const ok = await appConfirm({
      title: 'Unlink issue source?',
      message: 'Clears the link and any pending candidates / dismissals for this project. Imported cards are untouched.',
      confirmLabel: 'Unlink',
    });
    if (ok) await store.unlinkSource(projectId);
  };

  if (!source) {
    return (
      <div className='flex items-center gap-2 text-xs text-muted flex-wrap'>
        <span className='text-faint'>Issues</span>
        <Button variant='secondary' size='xs' onClick={() => void doLinkGitlab()} disabled={busy}>
          {busy ? 'Linking…' : '🦊 Link GitLab'}
        </Button>
        <Button variant='secondary' size='xs' onClick={() => setLinearOpen(true)}>▲ Link Linear</Button>
        <span className='text-faint'>
          GitLab reads the repo’s <span className='font-mono'>origin</span> remote; Linear links to a team you pick.
        </span>
        {linearOpen && <LinearLinkModal projectId={projectId} onClose={() => setLinearOpen(false)} />}
      </div>
    );
  }

  const meta = SOURCE_META[source.kind];
  const tooltip = source.kind === 'gitlab'
    ? `Linked to GitLab id ${source.ref}`
    : source.scopeName
      ? `Linked to Linear team ${source.slug}, scoped to project “${source.scopeName}”`
      : `Linked to Linear team ${source.slug}`;
  return (
    <div className='flex items-center gap-2 text-xs text-muted flex-wrap'>
      <Tooltip content={tooltip}>
        <span className='text-body'>
          {meta.icon} {source.name}
          {source.scopeName && <span className='text-faint'> › {source.scopeName}</span>}
        </span>
      </Tooltip>
      <span className='text-faint'>·</span>
      <span className='text-faint'>Issues</span>
      <Select
        value={project.issueFilter.mode}
        ariaLabel='Issue filter'
        options={[
          { value: 'assigned', label: 'Assigned to me' },
          { value: 'all', label: 'All open' },
          { value: 'label', label: 'By label' },
        ]}
        onChange={(v) => void store.setIssueFilter(projectId, { mode: v as IssueFilterMode, labels: project.issueFilter.labels })}
        className='px-2 py-1 text-xs w-40'
      />
      {project.issueFilter.mode === 'label' && <LabelInput projectId={projectId} labels={project.issueFilter.labels} />}
      <Button variant='ghost' size='xs' onClick={() => void doUnlink()}>Unlink</Button>
    </div>
  );
};

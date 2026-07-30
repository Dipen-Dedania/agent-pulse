import React, { useState } from 'react';
import { GitlabIssueFilterMode } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { appAlert, appConfirm, Button, Select, Tooltip } from '../Shared';

// GitLab population controls (Phase 3). Two pieces:
//  - GitlabHeaderActions: Scan + "Review issues (N)" in the board header.
//  - GitlabProjectStrip: per-project Link / filter / Unlink, shown under the
//    project-filter pills when a single project is selected.
// See backlog-phase3-gitlab-population-plan.md (WS5, item B).

export const GitlabHeaderActions: React.FC<{ projectFilter: string; onReview: () => void }> = ({ projectFilter, onReview }) => {
  const store = useBacklogStore();
  const linkedCount = store.projects.filter((p) => p.gitlabProjectId != null).length;
  if (linkedCount === 0) return null;

  const candidates = store.gitlab.candidates.filter((c) => projectFilter === 'all' || c.projectId === projectFilter);
  const n = candidates.length;
  const scanning = store.gitlab.scanning;
  const needsAuth = store.gitlab.connector === 'needs-auth';

  const doScan = async () => {
    const res = await store.scanGitlab(projectFilter === 'all' ? undefined : projectFilter);
    if (res && res.ok === false && res.reason) void appAlert(res.reason, 'Backlog');
  };

  return (
    <>
      {needsAuth && (
        <Tooltip content='The GitLab connector needs re-authentication in Claude Code — reconnect it, then Scan.'>
          <span className='px-2 py-1 rounded-lg text-xs font-medium bg-amber-500/15 text-warn'>GitLab: re-auth</span>
        </Tooltip>
      )}
      <Button variant='secondary' size='sm' onClick={() => void doScan()} disabled={scanning}>
        {scanning ? 'Scanning…' : '↻ Scan GitLab'}
      </Button>
      <Button variant='secondary' size='sm' onClick={onReview}>
        🦊 Review issues{n > 0 ? ` (${n})` : ''}
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
      aria-label='GitLab issue labels'
      className='px-2 py-1 rounded-lg text-xs bg-control/50 text-body placeholder:text-ghost outline-none focus:bg-control-strong w-48'
    />
  );
};

export const GitlabProjectStrip: React.FC<{ projectId: string }> = ({ projectId }) => {
  const store = useBacklogStore();
  const project = store.projects.find((p) => p.id === projectId);
  const [busy, setBusy] = useState(false);
  if (!project) return null;
  const linked = project.gitlabProjectId != null;

  const doLink = async () => {
    setBusy(true);
    const res = await store.linkGitlab(projectId);
    setBusy(false);
    if (!res.ok) void appAlert(res.reason ?? 'Could not link this project to GitLab.', 'Backlog');
    else void appAlert(`Linked to ${res.projectPath} (GitLab id ${res.id}).`, 'Backlog');
  };

  const doUnlink = async () => {
    const ok = await appConfirm({
      title: 'Unlink GitLab?',
      message: 'Clears the link and any pending candidates / dismissals for this project. Imported cards are untouched.',
      confirmLabel: 'Unlink',
    });
    if (ok) await store.unlinkGitlab(projectId);
  };

  if (!linked) {
    return (
      <div className='flex items-center gap-2 text-xs text-muted flex-wrap'>
        <span className='text-faint'>GitLab</span>
        <Button variant='secondary' size='xs' onClick={() => void doLink()} disabled={busy}>
          {busy ? 'Linking…' : '🦊 Link GitLab'}
        </Button>
        <span className='text-faint'>reads the repo’s <span className='font-mono'>origin</span> remote and resolves its project id</span>
      </div>
    );
  }

  return (
    <div className='flex items-center gap-2 text-xs text-muted flex-wrap'>
      <Tooltip content={`Linked to GitLab id ${project.gitlabProjectId}`}>
        <span className='text-body'>🦊 {project.gitlabProjectPath}</span>
      </Tooltip>
      <span className='text-faint'>·</span>
      <span className='text-faint'>Issues</span>
      <Select
        value={project.issueFilter.mode}
        ariaLabel='GitLab issue filter'
        options={[
          { value: 'assigned', label: 'Assigned to me' },
          { value: 'all', label: 'All open' },
          { value: 'label', label: 'By label' },
        ]}
        onChange={(v) => void store.setIssueFilter(projectId, { mode: v as GitlabIssueFilterMode, labels: project.issueFilter.labels })}
        className='w-40'
      />
      {project.issueFilter.mode === 'label' && <LabelInput projectId={projectId} labels={project.issueFilter.labels} />}
      <Button variant='ghost' size='xs' onClick={() => void doUnlink()}>Unlink</Button>
    </div>
  );
};

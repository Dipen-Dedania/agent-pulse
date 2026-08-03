import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { JiraProject, JiraSite } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { appAlert, Button, Radio } from '../Shared';
import { SourceIcon } from './SourceIcon';

// JIRA link picker (Phase 3.5). JIRA has no git remote to resolve, so the user
// picks an Atlassian site (Step 1 resolves the cloudId), then a Jira project
// (Step 2). Unlike Linear, BOTH steps are mandatory — the project key scopes
// every scan's JQL, so there is no "all projects" choice.

type Step = 'site' | 'project';

interface Props {
  projectId: string;
  onClose: () => void;
}

export const JiraLinkModal: React.FC<Props> = ({ projectId, onClose }) => {
  const store = useBacklogStore();
  const [step, setStep] = useState<Step>('site');

  // Site step
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<JiraSite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedSite, setSelectedSite] = useState<string | null>(null);

  // Project step
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);

  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const res = await store.listJiraSites();
      if (cancelled) return;
      if (res.ok) {
        setSites(res.sites);
        if (res.sites.length === 1) setSelectedSite(res.sites[0].cloudId);
      } else {
        setError(res.reason ?? 'Could not list Atlassian sites.');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Advance to the project step, loading the chosen site's projects.
  const goToProjects = async () => {
    if (!selectedSite) return;
    setStep('project');
    setProjectsLoading(true);
    setProjectsError(null);
    setProjects([]);
    setSelectedProject(null);
    const res = await store.listJiraProjects(selectedSite);
    if (res.ok) {
      setProjects(res.projects);
      if (res.projects.length === 1) setSelectedProject(res.projects[0].key);
    } else {
      setProjectsError(res.reason ?? 'Could not list this site’s Jira projects.');
    }
    setProjectsLoading(false);
  };

  const doLink = async () => {
    const site = sites.find((s) => s.cloudId === selectedSite);
    const project = projects.find((p) => p.key === selectedProject);
    if (!site || !project) return;
    setLinking(true);
    const res = await store.linkJira(projectId, site, project);
    setLinking(false);
    if (!res.ok) { void appAlert(res.reason ?? 'Could not link this project to JIRA.', 'Backlog'); return; }
    onClose();
  };

  return createPortal(
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm' onClick={onClose}>
      <div
        className='apple-scroll relative w-full mx-4 max-w-md max-h-[85vh] bg-overlay/95 border border-edge/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 overflow-hidden'
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
          <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-1 inline-flex items-center gap-1.5'>
            <SourceIcon kind='jira' /> JIRA
          </p>
          {step === 'site' ? (
            <>
              <h2 className='text-lg font-bold text-strong leading-tight pr-8'>Link an Atlassian site</h2>
              <p className='text-sm text-muted mt-1'>
                Pick the Atlassian site whose Jira issues should populate this project’s board. Next you’ll
                pick a Jira project.
              </p>
            </>
          ) : (
            <>
              <h2 className='text-lg font-bold text-strong leading-tight pr-8'>Pick a Jira project</h2>
              <p className='text-sm text-muted mt-1'>
                Choose the Jira project to pull open issues from. You can change the issue filter after
                linking.
              </p>
            </>
          )}
        </div>

        {/* ── Site step ─────────────────────────────────────────────────── */}
        {step === 'site' && (
          <>
            {loading && (
              <div className='glass-secondary p-6 flex items-center justify-center gap-2 text-sm text-muted'>
                <span className='w-4 h-4 border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin' />
                Listing your Atlassian sites…
              </div>
            )}

            {!loading && error && (
              <div className='glass-secondary p-3 text-xs text-warn'>
                {error}
                <span className='block mt-1 text-muted'>
                  If Atlassian needs authentication, reconnect it in Claude Code (<span className='font-mono'>claude</span> →
                  <span className='font-mono'> /mcp</span> → Atlassian), then try again.
                </span>
              </div>
            )}

            {!loading && !error && (
              <div className='apple-scroll flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -m-1 p-1'>
                {sites.length === 0 ? (
                  <div className='glass-secondary p-6 text-center text-sm text-muted'>No Atlassian sites found.</div>
                ) : (
                  sites.map((s) => {
                    const on = selectedSite === s.cloudId;
                    return (
                      <label
                        key={s.cloudId}
                        className={`glass-secondary shrink-0 p-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${on ? 'ring-2 ring-blue-400/70' : 'hover:bg-control/40'}`}
                      >
                        <Radio
                          name='jira-site'
                          checked={on}
                          onChange={() => setSelectedSite(s.cloudId)}
                          ariaLabel={`Select ${s.name}`}
                        />
                        <span className='text-sm text-strong truncate'>{s.name}</span>
                        {s.siteUrl && <span className='text-[11px] text-faint truncate'>{s.siteUrl}</span>}
                      </label>
                    );
                  })
                )}
              </div>
            )}

            <div className='flex items-center gap-2 pt-1'>
              <Button variant='primary' size='sm' onClick={() => void goToProjects()} disabled={!selectedSite}>
                Next
              </Button>
              <Button variant='ghost' size='sm' onClick={onClose} className='ml-auto'>Cancel</Button>
            </div>
          </>
        )}

        {/* ── Project step ──────────────────────────────────────────────── */}
        {step === 'project' && (
          <>
            {projectsLoading && (
              <div className='glass-secondary p-6 flex items-center justify-center gap-2 text-sm text-muted'>
                <span className='w-4 h-4 border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin' />
                Listing this site’s Jira projects…
              </div>
            )}

            {!projectsLoading && projectsError && (
              <div className='glass-secondary p-3 text-xs text-warn'>{projectsError}</div>
            )}

            {!projectsLoading && !projectsError && (
              <div className='apple-scroll flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -m-1 p-1'>
                {projects.length === 0 ? (
                  <div className='glass-secondary p-4 text-center text-xs text-muted'>
                    No Jira projects you can browse on this site.
                  </div>
                ) : (
                  projects.map((p) => {
                    const on = selectedProject === p.key;
                    return (
                      <label
                        key={p.key}
                        className={`glass-secondary shrink-0 p-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${on ? 'ring-2 ring-blue-400/70' : 'hover:bg-control/40'}`}
                      >
                        <Radio
                          name='jira-project'
                          checked={on}
                          onChange={() => setSelectedProject(p.key)}
                          ariaLabel={`Select ${p.name}`}
                        />
                        <span className='px-1.5 py-0.5 rounded text-[11px] bg-control/50 text-body font-mono'>{p.key}</span>
                        <span className='text-sm text-strong truncate'>{p.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}

            <div className='flex items-center gap-2 pt-1'>
              <Button variant='ghost' size='sm' onClick={() => setStep('site')} disabled={linking}>Back</Button>
              <Button variant='primary' size='sm' onClick={() => void doLink()} disabled={linking || projectsLoading || !selectedProject}>
                {linking ? 'Linking…' : 'Link'}
              </Button>
              <Button variant='ghost' size='sm' onClick={onClose} className='ml-auto'>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
};

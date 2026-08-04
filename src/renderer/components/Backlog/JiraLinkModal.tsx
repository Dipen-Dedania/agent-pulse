import React, { useEffect, useState } from 'react';
import { JiraProject, JiraSite } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { appAlert, Button, Modal, Spinner } from '../Shared';
import { RadioCardList, RadioCardOption } from './RadioCardList';
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

  const siteOptions: RadioCardOption[] = sites.map((s) => ({ id: s.cloudId, label: s.name, sub: s.siteUrl || undefined }));
  const projectOptions: RadioCardOption[] = projects.map((p) => ({ id: p.key, label: p.name, badge: p.key }));

  const eyebrow = <span className='inline-flex items-center gap-1.5'><SourceIcon kind='jira' /> JIRA</span>;

  const footer = step === 'site' ? (
    <>
      <Button variant='ghost' size='sm' onClick={onClose}>Cancel</Button>
      <Button variant='primary' size='sm' onClick={() => void goToProjects()} disabled={!selectedSite}>Next</Button>
    </>
  ) : (
    <>
      <Button variant='ghost' size='sm' onClick={() => setStep('site')} disabled={linking}>Back</Button>
      <Button variant='ghost' size='sm' onClick={onClose}>Cancel</Button>
      <Button variant='primary' size='sm' onClick={() => void doLink()} disabled={linking || projectsLoading || !selectedProject}>
        {linking ? 'Linking…' : 'Link'}
      </Button>
    </>
  );

  return (
    <Modal
      portal
      eyebrow={eyebrow}
      title={step === 'site' ? 'Link an Atlassian site' : 'Pick a Jira project'}
      onClose={onClose}
      footer={footer}
      maxWidthClass='max-w-md'
    >
      {/* ── Site step ─────────────────────────────────────────────────── */}
      {step === 'site' && (
        <>
          <p className='text-sm text-muted -mt-2'>
            Pick the Atlassian site whose Jira issues should populate this project’s board. Next you’ll
            pick a Jira project.
          </p>

          {loading && (
            <div className='glass-secondary p-6 flex items-center justify-center gap-2 text-sm text-muted'>
              <Spinner size='md' />
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
            <RadioCardList
              name='jira-site'
              options={siteOptions}
              selected={selectedSite}
              onSelect={setSelectedSite}
              emptyText='No Atlassian sites found.'
            />
          )}
        </>
      )}

      {/* ── Project step ──────────────────────────────────────────────── */}
      {step === 'project' && (
        <>
          <p className='text-sm text-muted -mt-2'>
            Choose the Jira project to pull open issues from. You can change the issue filter after
            linking.
          </p>

          {projectsLoading && (
            <div className='glass-secondary p-6 flex items-center justify-center gap-2 text-sm text-muted'>
              <Spinner size='md' />
              Listing this site’s Jira projects…
            </div>
          )}

          {!projectsLoading && projectsError && (
            <div className='glass-secondary p-3 text-xs text-warn'>{projectsError}</div>
          )}

          {!projectsLoading && !projectsError && (
            <RadioCardList
              name='jira-project'
              options={projectOptions}
              selected={selectedProject}
              onSelect={setSelectedProject}
              emptyText='No Jira projects you can browse on this site.'
              searchPlaceholder='Filter projects…'
            />
          )}
        </>
      )}
    </Modal>
  );
};

import React, { useEffect, useState } from 'react';
import { LinearProject, LinearTeam } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { appAlert, Button, Modal } from '../Shared';
import { RadioCardList, RadioCardOption } from './RadioCardList';
import { SourceIcon } from './SourceIcon';

// Linear link picker (Phase 3). Linear has no git remote to resolve, so the
// user picks a team, then optionally narrows to a single Linear project. If the
// workspace runs one project per repo, that second step scopes the board to just
// this repo's issues instead of the whole team's backlog. Picking a project is
// optional — "All issues in this team" stays a first-class choice.

type Step = 'team' | 'project';

// Sentinel for the "All issues in this team" choice (no project scope).
const ALL_ISSUES = '__all__';

interface Props {
  projectId: string;
  onClose: () => void;
}

export const LinearLinkModal: React.FC<Props> = ({ projectId, onClose }) => {
  const store = useBacklogStore();
  const [step, setStep] = useState<Step>('team');

  // Team step
  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<LinearTeam[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedTeam, setSelectedTeam] = useState<string | null>(null);

  // Project step
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projects, setProjects] = useState<LinearProject[]>([]);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<string>(ALL_ISSUES);

  const [linking, setLinking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const res = await store.listLinearTeams();
      if (cancelled) return;
      if (res.ok) {
        setTeams(res.teams);
        if (res.teams.length === 1) setSelectedTeam(res.teams[0].id);
      } else {
        setError(res.reason ?? 'Could not list Linear teams.');
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Advance to the project step, loading the chosen team's projects.
  const goToProjects = async () => {
    if (!selectedTeam) return;
    setStep('project');
    setProjectsLoading(true);
    setProjectsError(null);
    setProjects([]);
    setSelectedProject(ALL_ISSUES);
    const res = await store.listLinearProjects(selectedTeam);
    if (res.ok) setProjects(res.projects);
    else setProjectsError(res.reason ?? 'Could not list this team’s Linear projects.');
    setProjectsLoading(false);
  };

  const doLink = async () => {
    const team = teams.find((t) => t.id === selectedTeam);
    if (!team) return;
    const project = selectedProject === ALL_ISSUES ? null : projects.find((p) => p.id === selectedProject) ?? null;
    setLinking(true);
    const res = await store.linkLinear(projectId, team, project);
    setLinking(false);
    if (!res.ok) { void appAlert(res.reason ?? 'Could not link this project to Linear.', 'Backlog'); return; }
    onClose();
  };

  const teamOptions: RadioCardOption[] = teams.map((t) => ({ id: t.id, label: t.name, badge: t.key }));
  const projectOptions: RadioCardOption[] = projects.map((p) => ({ id: p.id, label: p.name }));

  const eyebrow = <span className='inline-flex items-center gap-1.5'><SourceIcon kind='linear' /> Linear</span>;

  const footer = step === 'team' ? (
    <>
      <Button variant='ghost' size='sm' onClick={onClose}>Cancel</Button>
      <Button variant='primary' size='sm' onClick={() => void goToProjects()} disabled={!selectedTeam}>Next</Button>
    </>
  ) : (
    <>
      <Button variant='ghost' size='sm' onClick={() => setStep('team')} disabled={linking}>Back</Button>
      <Button variant='ghost' size='sm' onClick={onClose}>Cancel</Button>
      <Button variant='primary' size='sm' onClick={() => void doLink()} disabled={linking || projectsLoading}>
        {linking ? 'Linking…' : 'Link'}
      </Button>
    </>
  );

  return (
    <Modal
      portal
      eyebrow={eyebrow}
      title={step === 'team' ? 'Link a Linear team' : 'Narrow to a project'}
      onClose={onClose}
      footer={footer}
      maxWidthClass='max-w-md'
    >
      {/* ── Team step ─────────────────────────────────────────────────── */}
      {step === 'team' && (
        <>
          <p className='text-sm text-muted -mt-2'>
            Pick the team whose issues should populate this project’s board. Next you can narrow to a
            single Linear project.
          </p>

          {loading && (
            <div className='glass-secondary p-6 flex items-center justify-center gap-2 text-sm text-muted'>
              <span className='w-4 h-4 border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin' />
              Listing your Linear teams…
            </div>
          )}

          {!loading && error && (
            <div className='glass-secondary p-3 text-xs text-warn'>
              {error}
              <span className='block mt-1 text-muted'>
                If Linear needs authentication, reconnect it in Claude Code (<span className='font-mono'>claude</span> →
                <span className='font-mono'> /mcp</span> → Linear), then try again.
              </span>
            </div>
          )}

          {!loading && !error && (
            <RadioCardList
              name='linear-team'
              options={teamOptions}
              selected={selectedTeam}
              onSelect={setSelectedTeam}
              emptyText='No Linear teams found.'
            />
          )}
        </>
      )}

      {/* ── Project step ──────────────────────────────────────────────── */}
      {step === 'project' && (
        <>
          <p className='text-sm text-muted -mt-2'>
            Optionally scope the board to one Linear project (e.g. this repo). Leave it on
            <span className='font-medium text-body'> All issues</span> to pull the whole team. You can change the
            issue filter after linking.
          </p>

          {projectsLoading && (
            <div className='glass-secondary p-6 flex items-center justify-center gap-2 text-sm text-muted'>
              <span className='w-4 h-4 border-2 border-edge-strong border-t-blue-400 rounded-full animate-spin' />
              Listing this team’s Linear projects…
            </div>
          )}

          {!projectsLoading && projectsError && (
            <div className='glass-secondary p-3 text-xs text-warn'>{projectsError}</div>
          )}

          {!projectsLoading && !projectsError && (
            <>
              <RadioCardList
                name='linear-project'
                options={projectOptions}
                selected={selectedProject}
                onSelect={setSelectedProject}
                leadingOption={{ id: ALL_ISSUES, label: 'All issues in this team' }}
                emptyText=''
              />
              {projects.length === 0 && (
                <div className='glass-secondary p-4 text-center text-xs text-muted'>
                  This team has no projects — its issues will populate the board.
                </div>
              )}
            </>
          )}
        </>
      )}
    </Modal>
  );
};

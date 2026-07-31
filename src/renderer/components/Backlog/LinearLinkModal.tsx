import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LinearProject, LinearTeam } from '../../../common/backlog-types';
import { useBacklogStore } from '../../store/useBacklogStore';
import { appAlert, Button, Radio } from '../Shared';

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
          <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-1'>▲ Linear</p>
          {step === 'team' ? (
            <>
              <h2 className='text-lg font-bold text-strong leading-tight pr-8'>Link a Linear team</h2>
              <p className='text-sm text-muted mt-1'>
                Pick the team whose issues should populate this project’s board. Next you can narrow to a
                single Linear project.
              </p>
            </>
          ) : (
            <>
              <h2 className='text-lg font-bold text-strong leading-tight pr-8'>Narrow to a project</h2>
              <p className='text-sm text-muted mt-1'>
                Optionally scope the board to one Linear project (e.g. this repo). Leave it on
                <span className='font-medium text-body'> All issues</span> to pull the whole team. You can change the
                issue filter after linking.
              </p>
            </>
          )}
        </div>

        {/* ── Team step ─────────────────────────────────────────────────── */}
        {step === 'team' && (
          <>
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
              <div className='apple-scroll flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -m-1 p-1'>
                {teams.length === 0 ? (
                  <div className='glass-secondary p-6 text-center text-sm text-muted'>No Linear teams found.</div>
                ) : (
                  teams.map((t) => {
                    const on = selectedTeam === t.id;
                    return (
                      <label
                        key={t.id}
                        className={`glass-secondary shrink-0 p-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${on ? 'ring-2 ring-blue-400/70' : 'hover:bg-control/40'}`}
                      >
                        <Radio
                          name='linear-team'
                          checked={on}
                          onChange={() => setSelectedTeam(t.id)}
                          ariaLabel={`Select ${t.name}`}
                        />
                        {t.key && (
                          <span className='px-1.5 py-0.5 rounded text-[11px] bg-control/50 text-body font-mono'>{t.key}</span>
                        )}
                        <span className='text-sm text-strong truncate'>{t.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}

            <div className='flex items-center gap-2 pt-1'>
              <Button variant='primary' size='sm' onClick={() => void goToProjects()} disabled={!selectedTeam}>
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
                Listing this team’s Linear projects…
              </div>
            )}

            {!projectsLoading && projectsError && (
              <div className='glass-secondary p-3 text-xs text-warn'>{projectsError}</div>
            )}

            {!projectsLoading && !projectsError && (
              <div className='apple-scroll flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -m-1 p-1'>
                {/* Always-present "whole team" choice. */}
                <label
                  className={`glass-secondary shrink-0 p-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${selectedProject === ALL_ISSUES ? 'ring-2 ring-blue-400/70' : 'hover:bg-control/40'}`}
                >
                  <Radio
                    name='linear-project'
                    checked={selectedProject === ALL_ISSUES}
                    onChange={() => setSelectedProject(ALL_ISSUES)}
                    ariaLabel='All issues in this team'
                  />
                  <span className='text-sm text-strong'>All issues in this team</span>
                </label>

                {projects.length === 0 ? (
                  <div className='glass-secondary p-4 text-center text-xs text-muted'>
                    This team has no projects — its issues will populate the board.
                  </div>
                ) : (
                  projects.map((p) => {
                    const on = selectedProject === p.id;
                    return (
                      <label
                        key={p.id}
                        className={`glass-secondary shrink-0 p-3 flex items-center gap-3 text-left transition-colors cursor-pointer ${on ? 'ring-2 ring-blue-400/70' : 'hover:bg-control/40'}`}
                      >
                        <Radio
                          name='linear-project'
                          checked={on}
                          onChange={() => setSelectedProject(p.id)}
                          ariaLabel={`Select ${p.name}`}
                        />
                        <span className='text-sm text-strong truncate'>{p.name}</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}

            <div className='flex items-center gap-2 pt-1'>
              <Button variant='ghost' size='sm' onClick={() => setStep('team')} disabled={linking}>Back</Button>
              <Button variant='primary' size='sm' onClick={() => void doLink()} disabled={linking || projectsLoading}>
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

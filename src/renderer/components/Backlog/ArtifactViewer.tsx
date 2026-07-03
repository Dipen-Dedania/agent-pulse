import React, { useEffect, useState } from 'react';
import { BacklogArtifact, BacklogAttempt, BacklogCard } from '../../../common/backlog-types';
import { logger } from '../../../common/logger';

// Card detail: attempt history + the latest research report. Reports live as
// .md files under userData/backlog-artifacts; "Open file" reuses the existing
// open-path IPC so users can read them in their own editor.

interface Props {
  card: BacklogCard;
  onClose: () => void;
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatDuration(attempt: BacklogAttempt): string | null {
  if (!attempt.endedAt) return null;
  const mins = Math.round((attempt.endedAt - attempt.startedAt) / 60_000);
  return mins < 1 ? '<1m' : `${mins}m`;
}

const OUTCOME_COLOR: Record<string, string> = {
  success: 'text-emerald-300',
  failed: 'text-red-300',
  paused: 'text-amber-300',
  killed: 'text-amber-300',
};

export const ArtifactViewer: React.FC<Props> = ({ card, onClose }) => {
  const [attempts, setAttempts] = useState<BacklogAttempt[]>([]);
  const [artifacts, setArtifacts] = useState<BacklogArtifact[]>([]);
  const [selected, setSelected] = useState<BacklogArtifact | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.electron.invoke('backlog:get-attempts', { cardId: card.id });
        if (cancelled) return;
        setAttempts(res?.attempts ?? []);
        setArtifacts(res?.artifacts ?? []);
        if (res?.artifacts?.length) setSelected(res.artifacts[0]); // newest first
      } catch (e) {
        logger.error('[ArtifactViewer] failed to load attempts', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [card.id]);

  useEffect(() => {
    if (!selected) { setContent(null); return; }
    let cancelled = false;
    window.electron.invoke('backlog:read-artifact', { artifactId: selected.id })
      .then((res: { content: string | null }) => { if (!cancelled) setContent(res?.content ?? null); })
      .catch((e: unknown) => logger.error('[ArtifactViewer] failed to read artifact', e));
    return () => { cancelled = true; };
  }, [selected]);

  const openFile = () => {
    if (selected) void window.electron.invoke('open-path', selected.path);
  };

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm' onClick={onClose}>
      <div
        className='apple-scroll relative w-full max-w-3xl mx-4 bg-slate-900/95 border border-slate-700/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-4 max-h-[85vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>

        <div>
          <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'>Card history</p>
          <h2 className='text-lg font-bold text-white leading-tight pr-8'>{card.title}</h2>
        </div>

        {loading ? (
          <p className='text-sm text-slate-400'>Loading…</p>
        ) : (
          <>
            {/* Attempt history */}
            <div className='bg-slate-900/40 border border-slate-700/50 rounded-xl p-4'>
              <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold mb-2'>Attempts</p>
              {attempts.length === 0 ? (
                <p className='text-sm text-slate-400'>No runs yet.</p>
              ) : (
                <div className='flex flex-col gap-1.5'>
                  {attempts.map((a) => (
                    <div key={a.id} className='flex items-center gap-3 text-xs flex-wrap'>
                      <span className='text-slate-400 w-32 shrink-0'>{formatWhen(a.startedAt)}</span>
                      <span className={`font-medium ${OUTCOME_COLOR[a.outcome ?? ''] ?? 'text-slate-300'}`}>
                        {a.outcome ?? 'running…'}
                      </span>
                      {formatDuration(a) && <span className='text-slate-500'>{formatDuration(a)}</span>}
                      {a.costUsd != null && <span className='text-slate-500'>${a.costUsd.toFixed(2)}</span>}
                      {a.numTurns != null && <span className='text-slate-500'>{a.numTurns} turns</span>}
                      {a.manual && <span className='text-slate-500'>manual</span>}
                      {a.reason && <span className='text-slate-500 truncate max-w-64' title={a.reason}>{a.reason}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Report */}
            {artifacts.length > 0 && (
              <div className='bg-slate-900/40 border border-slate-700/50 rounded-xl p-4 flex flex-col gap-3'>
                <div className='flex items-center gap-2 flex-wrap'>
                  <p className='text-xs uppercase tracking-widest text-slate-500 font-semibold flex-1'>Report</p>
                  {artifacts.length > 1 && (
                    <select
                      value={selected?.id ?? ''}
                      onChange={(e) => setSelected(artifacts.find((x) => x.id === e.target.value) ?? null)}
                      className='bg-slate-900/60 border border-slate-700/70 rounded-lg px-2 py-1 text-xs text-white cursor-pointer focus:outline-none'
                    >
                      {artifacts.map((x) => (
                        <option key={x.id} value={x.id}>{formatWhen(x.createdAt)}</option>
                      ))}
                    </select>
                  )}
                  <button
                    onClick={openFile}
                    className='px-3 py-1 rounded-lg text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 cursor-pointer transition-colors'
                  >
                    Open file
                  </button>
                </div>
                <pre className='whitespace-pre-wrap text-xs text-slate-200 leading-relaxed font-mono max-h-96 overflow-y-auto apple-scroll'>
                  {content ?? 'Loading report…'}
                </pre>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

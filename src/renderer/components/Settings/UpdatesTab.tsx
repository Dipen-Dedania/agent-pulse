import React, { useEffect, useState } from 'react';
import { UpdaterState } from '../../../common/updater-types';
import { logger } from '../../../common/logger';

function formatBytes(n: number): string {
  if (!n || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log10(n) / 3));
  return `${(n / Math.pow(1000, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRelative(ts: number | null): string {
  if (!ts) return 'never';
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.round(hr / 24);
  return `${day} d ago`;
}

const STATUS_PILL: Record<UpdaterState['status'], { label: string; classes: string }> = {
  idle:            { label: 'Idle',                  classes: 'bg-slate-600/30 border-slate-500/40 text-slate-300' },
  disabled:        { label: 'Disabled (dev mode)',   classes: 'bg-slate-600/30 border-slate-500/40 text-slate-400' },
  unsupported:     { label: 'Manual install',        classes: 'bg-amber-500/15 border-amber-500/30 text-amber-300' },
  checking:        { label: 'Checking…',             classes: 'bg-blue-500/15 border-blue-500/30 text-blue-300' },
  available:       { label: 'Update available',      classes: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' },
  'not-available': { label: 'Up to date',            classes: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' },
  downloading:     { label: 'Downloading…',          classes: 'bg-blue-500/15 border-blue-500/30 text-blue-300' },
  downloaded:      { label: 'Ready to install',      classes: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' },
  error:           { label: 'Error',                 classes: 'bg-red-500/15 border-red-500/30 text-red-300' },
};

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={`mb-5 bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-5 shadow-xl ${className ?? ''}`}>
    {children}
  </div>
);

export const UpdatesTab: React.FC = () => {
  const [state, setState] = useState<UpdaterState | null>(null);

  // Load once on mount, then live-update on every IPC broadcast. The main
  // process pushes a fresh state on every transition (checking, progress,
  // downloaded) so the renderer never needs to poll.
  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('updates:get-state')
      .then((s: UpdaterState) => { if (!cancelled) setState(s); })
      .catch((e: unknown) => logger.error('[UpdatesTab] failed to load state', e));
    const handler = (_e: unknown, next: UpdaterState) => setState(next);
    window.electron.on('updates:state', handler);
    return () => {
      cancelled = true;
      window.electron.off('updates:state', handler);
    };
  }, []);

  if (!state) {
    return <p className='text-slate-400 text-sm'>Loading…</p>;
  }

  const pill = STATUS_PILL[state.status];
  const isMacUnsupported = state.status === 'unsupported' && state.platform === 'darwin';
  const isDev = state.status === 'disabled';
  const isInProgress = state.status === 'checking' || state.status === 'downloading';

  const handleCheck = async () => {
    try {
      await window.electron.invoke('updates:check-now');
    } catch (e) {
      logger.error('[UpdatesTab] check failed', e);
    }
  };

  const handleDownload = async () => {
    try {
      await window.electron.invoke('updates:download');
    } catch (e) {
      logger.error('[UpdatesTab] download failed', e);
    }
  };

  const handleInstall = async () => {
    try {
      await window.electron.invoke('updates:quit-and-install');
    } catch (e) {
      logger.error('[UpdatesTab] install failed', e);
    }
  };

  const handleAutoCheckToggle = async () => {
    try {
      const next = await window.electron.invoke('updates:set-auto-check', !state.autoCheck);
      setState(next);
    } catch (e) {
      logger.error('[UpdatesTab] toggle auto-check failed', e);
    }
  };

  return (
    <div>
      {isMacUnsupported && (
        <Card className='border-amber-500/30 bg-amber-500/10'>
          <p className='font-semibold text-amber-200'>Manual updates on macOS</p>
          <p className='text-sm text-amber-100/80 mt-1'>
            Auto-update on macOS requires a signed and notarized build, which we haven't enabled yet.
            Until then, grab the latest installer from the Releases page.
          </p>
        </Card>
      )}
      {isDev && (
        <Card>
          <p className='font-semibold text-white'>Auto-update is off in dev mode</p>
          <p className='text-sm text-slate-400 mt-1'>
            electron-updater only operates on packaged builds. Ship a build via the
            "Build Distribution" workflow to test the real flow.
          </p>
        </Card>
      )}

      {/* Status card */}
      <Card>
        <div className='flex items-center justify-between gap-4 mb-3'>
          <div>
            <p className='text-xs font-semibold uppercase tracking-widest text-slate-500'>Current version</p>
            <p className='text-2xl font-bold text-white mt-1 font-mono'>{state.currentVersion}</p>
          </div>
          <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${pill.classes}`}>
            <span className='w-1.5 h-1.5 rounded-full bg-current' />
            {pill.label}
          </span>
        </div>
        <div className='flex items-center justify-between gap-4'>
          <p className='text-xs text-slate-500'>
            Last checked {formatRelative(state.lastCheckedAt)}
          </p>
          <button
            onClick={handleCheck}
            disabled={isInProgress || isDev || isMacUnsupported}
            className='px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700/60 disabled:text-slate-500 disabled:cursor-not-allowed text-white transition-colors cursor-pointer'
          >
            {state.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
        </div>
        {state.errorMessage && (
          <p className='mt-3 text-xs text-red-300 font-mono bg-red-500/10 border border-red-500/30 rounded-lg p-2'>
            {state.errorMessage}
          </p>
        )}
      </Card>

      {/* Available / downloading / ready */}
      {state.info && (state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded') && (
        <Card>
          <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2'>
            New version
          </p>
          <div className='flex items-baseline justify-between gap-4 mb-3'>
            <p className='text-xl font-bold text-white font-mono'>{state.info.version}</p>
            {state.info.releaseDate && (
              <p className='text-xs text-slate-500'>
                Released {new Date(state.info.releaseDate).toLocaleDateString()}
              </p>
            )}
          </div>

          {state.info.releaseNotes && (
            <div className='mb-4 bg-slate-900/40 border border-slate-700/40 rounded-xl p-3 max-h-48 overflow-y-auto apple-scroll'>
              <pre className='text-xs text-slate-300 whitespace-pre-wrap leading-relaxed font-sans'>
                {state.info.releaseNotes}
              </pre>
            </div>
          )}

          {state.status === 'downloading' && state.progress && (
            <div className='mb-4'>
              <div className='flex items-center justify-between text-xs text-slate-400 mb-1.5'>
                <span>{state.progress.percent}%</span>
                <span>
                  {formatBytes(state.progress.transferred)} / {formatBytes(state.progress.total)}
                  {state.progress.bytesPerSecond > 0 && (
                    <> · {formatBytes(state.progress.bytesPerSecond)}/s</>
                  )}
                </span>
              </div>
              <div className='w-full h-2 bg-slate-700/50 rounded-full overflow-hidden'>
                <div
                  className='h-full bg-blue-500 transition-all duration-300'
                  style={{ width: `${state.progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {state.status === 'available' && (
            <button
              onClick={handleDownload}
              className='w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer'
            >
              Download update
            </button>
          )}
          {state.status === 'downloaded' && (
            <button
              onClick={handleInstall}
              className='w-full px-4 py-2.5 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer'
            >
              Restart and install
            </button>
          )}
        </Card>
      )}

      {/* Preferences */}
      <Card>
        <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3'>Preferences</p>
        <div className='flex items-center gap-4'>
          <div className='flex-1'>
            <p className='font-semibold text-white leading-tight'>Check for updates automatically</p>
            <p className='text-xs text-slate-400 mt-1'>
              Runs a background check shortly after launch and every six hours after that.
            </p>
          </div>
          <button
            onClick={handleAutoCheckToggle}
            disabled={isDev || isMacUnsupported}
            className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${
              state.autoCheck ? 'bg-blue-500' : 'bg-slate-600'
            } ${(isDev || isMacUnsupported) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            aria-label='Toggle automatic update checks'
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                state.autoCheck ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </Card>
    </div>
  );
};

import React from 'react';
import { UpdaterState } from '../../../common/updater-types';
import { logger } from '../../../common/logger';
import { useUpdaterState } from '../../hooks/useUpdaterState';
import { Badge, GlassToggle, Button, Meter, type BadgeTone } from '../Shared';

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

const STATUS_PILL: Record<UpdaterState['status'], { label: string; tone: BadgeTone }> = {
  idle:            { label: 'Idle',                  tone: 'neutral' },
  disabled:        { label: 'Disabled (dev mode)',   tone: 'neutral' },
  unsupported:     { label: 'Manual install',        tone: 'warn'    },
  checking:        { label: 'Checking…',             tone: 'info'    },
  available:       { label: 'Update available',      tone: 'ok'      },
  'not-available': { label: 'Up to date',            tone: 'ok'      },
  downloading:     { label: 'Downloading…',          tone: 'info'    },
  downloaded:      { label: 'Ready to install',      tone: 'ok'      },
  error:           { label: 'Error',                 tone: 'danger'  },
};

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={`mb-5 glass-primary p-5 ${className ?? ''}`}>
    {children}
  </div>
);

export const UpdatesTab: React.FC = () => {
  // Live state from main (shared with the Settings panel's tab badge).
  const [state, setState] = useUpdaterState();

  if (!state) {
    return <p className='text-muted text-sm'>Loading…</p>;
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
          <p className='font-semibold text-warn'>Manual updates on macOS</p>
          <p className='text-sm text-warn/90 mt-1'>
            Auto-update on macOS requires a signed and notarized build, which we haven't enabled yet.
            Until then, grab the latest installer from the Releases page.
          </p>
        </Card>
      )}
      {isDev && (
        <Card>
          <p className='font-semibold text-strong'>Auto-update is off in dev mode</p>
          <p className='text-sm text-muted mt-1'>
            electron-updater only operates on packaged builds. Ship a build via the
            "Build Distribution" workflow to test the real flow.
          </p>
        </Card>
      )}

      {/* Status card */}
      <Card>
        <div className='flex items-center justify-between gap-4 mb-3'>
          <div>
            <p className='text-xs font-semibold uppercase tracking-widest text-faint'>Current version</p>
            <p className='text-2xl font-bold text-strong mt-1 font-mono'>{state.currentVersion}</p>
          </div>
          <Badge tone={pill.tone} variant='pill' size='md' weight='semibold' dot>
            {pill.label}
          </Badge>
        </div>
        <div className='flex items-center justify-between gap-4'>
          <p className='text-xs text-faint'>
            Last checked {formatRelative(state.lastCheckedAt)}
          </p>
          <Button
            onClick={handleCheck}
            disabled={isInProgress || isDev || isMacUnsupported}
          >
            {state.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </Button>
        </div>
        {state.errorMessage && (
          <p className='mt-3 text-xs text-danger font-mono bg-red-500/10 border border-red-500/30 rounded-lg p-2'>
            {state.errorMessage}
          </p>
        )}
      </Card>

      {/* Available / downloading / ready */}
      {state.info && (state.status === 'available' || state.status === 'downloading' || state.status === 'downloaded') && (
        <Card>
          <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-2'>
            New version
          </p>
          <div className='flex items-baseline justify-between gap-4 mb-3'>
            <p className='text-xl font-bold text-strong font-mono'>{state.info.version}</p>
            {state.info.releaseDate && (
              <p className='text-xs text-faint'>
                Released {new Date(state.info.releaseDate).toLocaleDateString()}
              </p>
            )}
          </div>

          {state.info.releaseNotes && (
            <div className='mb-4 bg-glass/40 border border-edge/40 rounded-xl p-3 max-h-48 overflow-y-auto apple-scroll'>
              <pre className='text-xs text-body whitespace-pre-wrap leading-relaxed font-sans'>
                {state.info.releaseNotes}
              </pre>
            </div>
          )}

          {state.status === 'downloading' && state.progress && (
            <div className='mb-4'>
              <div className='flex items-center justify-between text-xs text-muted mb-1.5'>
                <span>{state.progress.percent}%</span>
                <span>
                  {formatBytes(state.progress.transferred)} / {formatBytes(state.progress.total)}
                  {state.progress.bytesPerSecond > 0 && (
                    <> · {formatBytes(state.progress.bytesPerSecond)}/s</>
                  )}
                </span>
              </div>
              <Meter
                value={state.progress.percent}
                size='md'
                trackClass='bg-control/50'
                fillClass='bg-blue-500'
                ariaLabel='Download progress'
              />
            </div>
          )}

          {state.status === 'available' && (
            <Button
              onClick={handleDownload}
              className='w-full'
            >
              Download update
            </Button>
          )}
          {state.status === 'downloaded' && (
            <Button variant='success' onClick={handleInstall} className='w-full'>
              Restart and install
            </Button>
          )}
        </Card>
      )}

      {/* Preferences */}
      <Card>
        <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-3'>Preferences</p>
        <div className='flex items-center gap-4'>
          <div className='flex-1'>
            <p className='font-semibold text-strong leading-tight'>Check for updates automatically</p>
            <p className='text-xs text-muted mt-1'>
              Runs a background check shortly after launch and every six hours after that.
            </p>
          </div>
          <GlassToggle
            checked={state.autoCheck}
            onChange={handleAutoCheckToggle}
            size="lg"
            label="Toggle automatic update checks"
            disabled={isDev || isMacUnsupported}
          />
        </div>
      </Card>
    </div>
  );
};

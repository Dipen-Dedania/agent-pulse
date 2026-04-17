import React, { useState, useEffect } from 'react';
import { ToolId } from '../../../common/types';
import { TOOL_META, HookInfo } from '../../../common/toolMeta';
import { StatesReference } from './StatesReference';

interface ToolConfig {
  enabled: boolean;
  installed: boolean;
  location?: string;
}

// ── Hook Info Modal ──────────────────────────────────────────────────────────

const HookInfoModal: React.FC<{
  info: HookInfo;
  label: string;
  onClose: () => void;
}> = ({ info, label, onClose }) => {
  const [tab, setTab] = useState<'install' | 'troubleshoot'>('install');
  return (
    <div
      className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'
      onClick={onClose}
    >
      <div
        className='apple-scroll relative w-full max-w-lg mx-4 bg-slate-900/95 border border-slate-700/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-5 max-h-[85vh] overflow-y-auto'
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={onClose}
          className='absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors text-sm cursor-pointer'
          aria-label='Close'
        >
          ✕
        </button>

        {/* Title */}
        <div>
          <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1'>
            Hook Installation
          </p>
          <h2 className='text-lg font-bold text-white leading-tight'>{label}</h2>
        </div>

        {/* Tabs */}
        <div className='flex gap-1 p-1 bg-slate-800/60 border border-slate-700/60 rounded-xl w-fit'>
          <button
            onClick={() => setTab('install')}
            className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              tab === 'install'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Install
          </button>
          <button
            onClick={() => setTab('troubleshoot')}
            className={`px-3 py-1 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
              tab === 'troubleshoot'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Troubleshoot
          </button>
        </div>

        {tab === 'install' ? (
          <>
            {/* Badges */}
            <div className='flex flex-wrap gap-2'>
              <span className='inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs font-medium'>
                <span className='w-1.5 h-1.5 rounded-full bg-blue-400 inline-block' />
                {info.mechanism}
              </span>
              <span className='inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-700/60 border border-slate-600/50 text-slate-300 text-xs font-mono'>
                {info.configFile}
              </span>
            </div>

            {/* Description */}
            <p className='text-sm text-slate-300 leading-relaxed'>
              {info.description}
            </p>

            {/* Snippet */}
            <div>
              <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2'>
                Config snippet
              </p>
              <pre className='bg-slate-800/80 border border-slate-700/60 rounded-xl p-4 text-xs text-green-300 font-mono overflow-x-auto whitespace-pre leading-relaxed'>
                {info.snippet}
              </pre>
            </div>
          </>
        ) : (
          <div>
            <p className='text-xs font-semibold uppercase tracking-widest text-slate-500 mb-3'>
              If status events aren't arriving
            </p>
            <ol className='flex flex-col gap-2.5 list-decimal list-inside text-sm text-slate-300 leading-relaxed'>
              {info.troubleshooting.map((step, i) => (
                <li key={i} className='pl-1'>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Settings Panel ────────────────────────────────────────────────────────────

export const SettingsPanel: React.FC = () => {
  const [tools, setTools] = useState<Record<ToolId, ToolConfig>>(
    {} as Record<ToolId, ToolConfig>,
  );
  const [loading, setLoading] = useState(false);
  const [activeInfo, setActiveInfo] = useState<ToolId | null>(null);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const [detected, config] = await Promise.all([
        window.electron.invoke('detect-tools'),
        window.electron.invoke('get-config'),
      ]);
      const toolList = Object.keys(TOOL_META) as ToolId[];
      const initialTools = {} as Record<ToolId, ToolConfig>;
      toolList.forEach((id) => {
        const det = detected[id];
        // Back-compat: detector may return boolean or { installed, location }
        const isObj = det && typeof det === 'object';
        initialTools[id] = {
          enabled: config?.enabledBubbles?.[id] ?? false,
          installed: isObj ? !!det.installed : !!det,
          location: isObj ? det.location : undefined,
        };
      });
      setTools(initialTools);
      setLoading(false);
    }
    init();
  }, []);

  const handleToggleBubble = (toolId: ToolId, enabled: boolean) => {
    window.electron.send('toggle-bubble', { toolId, enabled });
    setTools((prev) => ({ ...prev, [toolId]: { ...prev[toolId], enabled } }));
  };

  const handleInstallHook = async (toolId: ToolId) => {
    try {
      const result = await window.electron.invoke('install-hook', { toolId });
      if (result.success) {
        setTools((prev) => ({
          ...prev,
          [toolId]: { ...prev[toolId], installed: true },
        }));
      }
    } catch (e) {
      alert('Failed to install hook: ' + e);
    }
  };

  const handleUninstallHook = async (toolId: ToolId) => {
    try {
      const result = await window.electron.invoke('uninstall-hook', { toolId });
      if (result.success) {
        setTools((prev) => ({
          ...prev,
          [toolId]: { ...prev[toolId], installed: false },
        }));
      }
    } catch (e) {
      alert('Failed to uninstall hook: ' + e);
    }
  };

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = window.location.pathname;
    }
  };

  return (
    <div className='h-screen overflow-y-auto apple-scroll bg-slate-900 text-white p-8 font-sans'>
      {/* Header */}
      <div className='mb-10 flex items-start gap-3'>
        <button
          onClick={handleBack}
          className='mt-1 w-9 h-9 flex items-center justify-center rounded-full bg-slate-800/70 hover:bg-slate-700 border border-slate-700/70 text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0'
          aria-label='Back'
        >
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 20 20'
            fill='currentColor'
            className='w-4 h-4'
          >
            <path
              fillRule='evenodd'
              d='M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.24a.75.75 0 010-1.06l4.25-4.24a.75.75 0 011.06 0z'
              clipRule='evenodd'
            />
          </svg>
        </button>
        <img
          src='./assets/logo-transparent.png'
          alt='Agent Pulse'
          className='w-10 h-10 object-contain shrink-0'
        />
        <div>
          <h1 className='text-3xl font-bold tracking-tight'>Agent Pulse</h1>
          <p className='text-slate-400 mt-1 text-sm'>
            Manage which AI tools show a status bubble.
          </p>
        </div>
      </div>

      {loading ? (
        <div className='flex items-center gap-3 text-slate-400'>
          <div className='w-4 h-4 border-2 border-slate-500 border-t-blue-400 rounded-full animate-spin' />
          Detecting tools…
        </div>
      ) : (
        <div className='grid grid-cols-1 md:grid-cols-2 gap-5'>
          {(Object.keys(TOOL_META) as ToolId[]).map((toolId) => {
            const meta = TOOL_META[toolId];
            const config = tools[toolId];
            if (!config) return null;

            const toolDetected = !!config.location || config.installed;

            return (
              <div
                key={toolId}
                className={`bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-5 shadow-xl flex flex-col gap-4 ${
                  !toolDetected ? 'opacity-60' : ''
                }`}
              >
                {/* Tool header */}
                <div className='flex items-center gap-4'>
                  <div className='w-11 h-11 rounded-xl bg-slate-700/60 flex items-center justify-center shrink-0'>
                    <img
                      src={meta.icon}
                      alt={meta.label}
                      className='w-7 h-7 object-contain'
                    />
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-1.5'>
                      <p className='font-semibold text-white leading-tight'>
                        {meta.label}
                      </p>
                      <button
                        onClick={() => setActiveInfo(toolId)}
                        className='flex-shrink-0 w-4 h-4 rounded-full bg-slate-600/70 hover:bg-blue-500/60 border border-slate-500/50 hover:border-blue-400/50 text-slate-400 hover:text-blue-300 text-[9px] font-bold flex items-center justify-center cursor-pointer transition-colors'
                        aria-label={`How ${meta.label} hook is installed`}
                      >
                        i
                      </button>
                    </div>
                    {toolDetected ? (
                      <>
                        <p className='text-xs text-slate-400 mt-0.5'>
                          {config.installed
                            ? '✓ Hook installed'
                            : 'Hook not installed'}
                        </p>
                        {config.location && (
                          <p
                            className='text-[10px] text-slate-500 mt-0.5 font-mono truncate'
                            title={config.location}
                          >
                            {config.location}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className='text-xs text-slate-500 mt-0.5 italic'>
                        Not installed on this machine
                      </p>
                    )}
                  </div>
                  {/* Bubble toggle */}
                  <button
                    onClick={() =>
                      toolDetected &&
                      handleToggleBubble(toolId, !config.enabled)
                    }
                    disabled={!toolDetected}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${
                      config.enabled ? 'bg-blue-500' : 'bg-slate-600'
                    } ${
                      toolDetected
                        ? 'cursor-pointer'
                        : 'cursor-not-allowed opacity-50'
                    }`}
                    aria-label='Toggle bubble'
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                        config.enabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Actions */}
                <div className='flex gap-2'>
                  <button
                    onClick={() => handleInstallHook(toolId)}
                    disabled={config.installed || !toolDetected}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      config.installed
                        ? 'bg-green-500/15 text-green-400 border border-green-500/30 cursor-default'
                        : !toolDetected
                          ? 'bg-slate-700/40 text-slate-500 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                    }`}
                  >
                    {config.installed ? 'Hook Active' : 'Install Hook'}
                  </button>
                  <button
                    onClick={() => handleUninstallHook(toolId)}
                    disabled={!config.installed}
                    className='flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-default text-slate-300 transition-all enabled:cursor-pointer'
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <StatesReference />

      {activeInfo && (
        <HookInfoModal
          info={TOOL_META[activeInfo].hookInfo}
          label={TOOL_META[activeInfo].label}
          onClose={() => setActiveInfo(null)}
        />
      )}
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { ToolId } from '../../../common/types';
import { TOOL_META, HookInfo } from '../../../common/toolMeta';

interface ToolConfig {
  enabled: boolean;
  installed: boolean;
}

// ── Hook Info Modal ──────────────────────────────────────────────────────────

const HookInfoModal: React.FC<{ info: HookInfo; label: string; onClose: () => void }> = ({
  info,
  label,
  onClose,
}) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className="apple-scroll relative w-full max-w-lg mx-4 bg-slate-900/95 border border-slate-700/70 rounded-2xl shadow-2xl p-6 flex flex-col gap-5 max-h-[85vh] overflow-y-auto"
      onClick={e => e.stopPropagation()}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-7 h-7 flex items-center justify-center rounded-full bg-slate-700/60 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors text-sm"
        aria-label="Close"
      >
        ✕
      </button>

      {/* Title */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-1">Hook Installation</p>
        <h2 className="text-lg font-bold text-white leading-tight">{label}</h2>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs font-medium">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
          {info.mechanism}
        </span>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-700/60 border border-slate-600/50 text-slate-300 text-xs font-mono">
          {info.configFile}
        </span>
      </div>

      {/* Description */}
      <p className="text-sm text-slate-300 leading-relaxed">{info.description}</p>

      {/* Snippet */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">Config snippet</p>
        <pre className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-4 text-xs text-green-300 font-mono overflow-x-auto whitespace-pre leading-relaxed">
          {info.snippet}
        </pre>
      </div>
    </div>
  </div>
);

// ── Settings Panel ────────────────────────────────────────────────────────────

export const SettingsPanel: React.FC = () => {
  const [tools, setTools] = useState<Record<ToolId, ToolConfig>>({} as Record<ToolId, ToolConfig>);
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
      toolList.forEach(id => {
        initialTools[id] = {
          enabled: config?.enabledBubbles?.[id] ?? false,
          installed: detected[id] || false,
        };
      });
      setTools(initialTools);
      setLoading(false);
    }
    init();
  }, []);

  const handleToggleBubble = (toolId: ToolId, enabled: boolean) => {
    window.electron.send('toggle-bubble', { toolId, enabled });
    setTools(prev => ({ ...prev, [toolId]: { ...prev[toolId], enabled } }));
  };

  const handleInstallHook = async (toolId: ToolId) => {
    try {
      const result = await window.electron.invoke('install-hook', { toolId });
      if (result.success) {
        setTools(prev => ({ ...prev, [toolId]: { ...prev[toolId], installed: true } }));
      }
    } catch (e) {
      alert('Failed to install hook: ' + e);
    }
  };

  const handleUninstallHook = async (toolId: ToolId) => {
    try {
      const result = await window.electron.invoke('uninstall-hook', { toolId });
      if (result.success) {
        setTools(prev => ({ ...prev, [toolId]: { ...prev[toolId], installed: false } }));
      }
    } catch (e) {
      alert('Failed to uninstall hook: ' + e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 font-sans">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight">Agent Pulse</h1>
        <p className="text-slate-400 mt-1 text-sm">Manage which AI tools show a status bubble.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-slate-400">
          <div className="w-4 h-4 border-2 border-slate-500 border-t-blue-400 rounded-full animate-spin" />
          Detecting tools…
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {(Object.keys(TOOL_META) as ToolId[]).map(toolId => {
            const meta = TOOL_META[toolId];
            const config = tools[toolId];
            if (!config) return null;

            return (
              <div
                key={toolId}
                className="bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-5 shadow-xl flex flex-col gap-4"
              >
                {/* Tool header */}
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-slate-700/60 flex items-center justify-center shrink-0">
                    <img
                      src={meta.icon}
                      alt={meta.label}
                      className="w-7 h-7 object-contain"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="font-semibold text-white leading-tight">{meta.label}</p>
                      <button
                        onClick={() => setActiveInfo(toolId)}
                        className="flex-shrink-0 w-4 h-4 rounded-full bg-slate-600/70 hover:bg-blue-500/60 border border-slate-500/50 hover:border-blue-400/50 text-slate-400 hover:text-blue-300 text-[9px] font-bold flex items-center justify-center transition-colors"
                        aria-label={`How ${meta.label} hook is installed`}
                      >
                        i
                      </button>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {config.installed ? '✓ Hook installed' : 'Hook not installed'}
                    </p>
                  </div>
                  {/* Bubble toggle */}
                  <button
                    onClick={() => handleToggleBubble(toolId, !config.enabled)}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${
                      config.enabled ? 'bg-blue-500' : 'bg-slate-600'
                    }`}
                    aria-label="Toggle bubble"
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                        config.enabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleInstallHook(toolId)}
                    disabled={config.installed}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      config.installed
                        ? 'bg-green-500/15 text-green-400 border border-green-500/30 cursor-default'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    {config.installed ? 'Hook Active' : 'Install Hook'}
                  </button>
                  <button
                    onClick={() => handleUninstallHook(toolId)}
                    disabled={!config.installed}
                    className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-default text-slate-300 transition-all"
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* States Reference */}
      <div className="mt-10">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Agent States</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

          {/* Idle */}
          <div className="bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="relative w-9 h-9 shrink-0">
                <div className="w-9 h-9 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.12) 0%, rgba(128,128,128,0.06) 100%)', border: '1.5px solid rgba(255,255,255,0.18)' }} />
              </div>
              <p className="font-semibold text-white text-sm">Idle</p>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">No agent activity. Slowly breathes at low opacity.</p>
          </div>

          {/* Waiting */}
          <div className="bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="relative w-9 h-9 shrink-0 flex items-center justify-center">
                <div className="w-9 h-9 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.45) 0%, rgba(128,128,128,0.06) 100%)', border: '1.5px solid rgba(255,255,255,0.18)', boxShadow: '0 0 10px 2px rgba(245,158,11,0.3)' }} />
                <div className="absolute w-[42px] h-[42px] rounded-full"
                  style={{ border: '1.5px dotted rgba(245,158,11,0.5)' }} />
              </div>
              <p className="font-semibold text-amber-300 text-sm">Waiting</p>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">Prompt submitted. Agent is thinking before its first action.</p>
          </div>

          {/* Working */}
          <div className="bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="relative w-9 h-9 shrink-0 flex items-center justify-center">
                <div className="w-9 h-9 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(59,130,246,0.5) 0%, rgba(128,128,128,0.06) 100%)', border: '1.5px solid rgba(255,255,255,0.18)', boxShadow: '0 0 14px 4px rgba(59,130,246,0.4)' }} />
                <div className="absolute w-[42px] h-[42px] rounded-full"
                  style={{ border: '1.5px dashed rgba(59,130,246,0.5)' }} />
              </div>
              <p className="font-semibold text-blue-300 text-sm">Working</p>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">Actively using tools — reading files, running commands, writing code.</p>
          </div>

          {/* Error */}
          <div className="bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="relative w-9 h-9 shrink-0 flex items-center justify-center">
                <div className="w-9 h-9 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(239,68,68,0.5) 0%, rgba(128,128,128,0.06) 100%)', border: '1.5px solid rgba(255,255,255,0.18)', boxShadow: '0 0 10px 2px rgba(239,68,68,0.35)' }} />
                <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-red-500"
                  style={{ boxShadow: '0 0 5px rgba(239,68,68,0.7)' }} />
              </div>
              <p className="font-semibold text-red-400 text-sm">Error</p>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">Agent stopped unexpectedly or a tool call failed.</p>
          </div>

        </div>
      </div>

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

import React, { useState, useEffect } from 'react';
import { ToolId } from '../common/types';
import { Bubble } from '../components/Bubble/Bubble';

interface ToolConfig {
  enabled: boolean;
  installed: boolean;
}

interface SettingsState {
  tools: Record<ToolId, ToolConfig>;
}

export const SettingsPanel: React.FC = () => {
  const [tools, setTools] = useState<Record<ToolId, ToolConfig>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function init() {
      setLoading(true);
      const detected = await window.electron.invoke('detect-tools');
      const initialTools: Record<ToolId, ToolConfig> = {};

      // Mocking the state for now as we don't have a persisted config
      const toolList: ToolId[] = ['claude-code', 'cursor', 'vscode-copilot', 'openai-codex'];
      toolList.forEach(id => {
        initialTools[id] = {
          enabled: false,
          installed: detected[id] || false,
        };
      });
      setTools(initialTools);
      setLoading(false);
    }
    init();
  }, []);

  const handleToggleBubble = async (toolId: ToolId, enabled: boolean) => {
        await window.electron.send('toggle-bubble', { toolId, enabled });
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

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 font-sans">
      <h1 className="text-3xl font-bold mb-8">Agent Pulse Settings</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(tools).map(([toolId, config]) => (
          <div key={toolId} className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold capitalize">{toolId.replace('-', ' ')}</h2>
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => handleToggleBubble(toolId as ToolId, e.target.checked)}
                className="w-6 h-6 rounded-full accent-blue-500"
              />
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => handleInstallHook(toolId as ToolId)}
                disabled={config.installed}
                className={`px-4 py-2 rounded-lg font-medium transition-all ${
                  config.installed
                    ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {config.installed ? 'Hook Installed' : 'Install Hook'}
              </button>

              <button
                onClick={() => {}} // Uninstall logic
                className="px-4 py-2 rounded-lg font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all"
              >
                Uninstall
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

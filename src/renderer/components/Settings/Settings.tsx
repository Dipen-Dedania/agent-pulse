import React, { useState, useEffect } from 'react';
import { ToolId } from '../common/types';

export const Settings: React.FC = () => {
  const [detectedTools, setDetectedTools] = useState<Record<string, boolean>>({});
  const [installedTools, setInstalledTools] = useState<string[]>([
    'claude-code',
    'cursor'
  ]);

  useEffect(() => {
    // Call IPC to detect tools
    window.electron.invoke('detect-tools').then(setDetectedTools)
  }, []);

  return (
    <div className="min-h-screen bg-base text-strong p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <header className="mb-12">
          <h1 className="text-4xl font-bold mb-2">Agent Pulse Settings</h1>
          <p className="text-muted">Manage your AI agent status bubbles.</p>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="bg-glass/50 border border-edge p-6 rounded-2xl backdrop-blur-md">
            <h2 className="text-xl font-semibold mb-4">Tool Integration</h2>
            <div className="space-y-4">
              {['claude-code', 'cursor', 'vscode-copilot', 'openai-codex'].map((toolId) => (
                <div key={toolId} className="flex items-center justify-between p-3 bg-inset/50 rounded-xl border border-edge">
                  <div className="flex-1">
                    <p className="font-medium capitalize">{toolId.replace('-', ' ')}</p>
                    <p className="text-xs text-faint">
                      {detectedTools[toolId] ? '✅ Installed' : '❓ Not detected'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded-md transition-colors"
                      onClick={() => {}}
                    >
                      Install Hook
                    </button>
                    <button
                      className="px-3 py-1 text-xs bg-control hover:bg-control-strong rounded-md transition-colors"
                      onClick={() => {}}
                    >
                      Toggle Bubble
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-glass/50 border border-edge p-6 rounded-2xl backdrop-blur-md">
            <h2 className="text-xl font-semibold mb-4">Visual Preferences</h2>
            <div className="space-y-6">
              <div className="flex flex-col">
                <label className="block text-sm text-muted mb-2">Animation Intensity</label>
                <input type="range" className="w-full accent-blue-500" />
              </div>
              <div className="flex flex-col">
                <label className="block text-sm text-muted mb-2">Bubble Opacity</label>
                <input type="range" className="w-full accent-blue-500" />
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="mute" className="w-4 h-4 accent-blue-500" />
                <label htmlFor="mute" className="text-sm text-muted">Mute all animations</label>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

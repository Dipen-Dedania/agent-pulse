import React, { useState, useEffect } from 'react';
import { ToolId, UsageStatus, CodexUsageStatus, AntigravityUsageStatus, SchedulerStatus, BubbleConfig } from '../../../common/types';
import { TOOL_META, HookInfo } from '../../../common/toolMeta';
import { logger } from '../../../common/logger';
import { StatesReference } from './StatesReference';
import { UsageSection, UsageConfigUI } from './UsageSection';
import { CodexUsageSection, CodexUsageConfigUI } from './CodexUsageSection';
import { AntigravityUsageSection, AntigravityUsageConfigUI } from './AntigravityUsageSection';
import { SchedulerSection, SchedulerConfigUI } from './SchedulerSection';
import { BubbleSection } from './BubbleSection';
import { GuardrailsTab } from './GuardrailsTab';
import { AnalyticsTabContainer } from './AnalyticsTab';
import { UpdatesTab } from './UpdatesTab';

interface ToolConfig {
  enabled: boolean;
  appInstalled: boolean;
  hookInstalled: boolean;
  location?: string;
}

interface AutoLaunchState {
  enabled: boolean;
  effective: boolean;
  packaged: boolean;
}

// ── General Section (app-level toggles) ─────────────────────────────────────

const GeneralSection: React.FC = () => {
  const [state, setState] = useState<AutoLaunchState | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('auto-launch:get')
      .then((s: AutoLaunchState) => { if (!cancelled) setState(s); })
      .catch((e: unknown) => logger.error('[GeneralSection] failed to load auto-launch state', e));
    return () => { cancelled = true; };
  }, []);

  const handleToggle = async () => {
    if (!state) return;
    try {
      const next = await window.electron.invoke('auto-launch:set', !state.enabled);
      setState(next);
    } catch (e) {
      logger.error('[GeneralSection] failed to set auto-launch', e);
    }
  };

  if (!state) return null;
  const checked = state.enabled;

  return (
    <div className='mb-6 bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-2xl p-5 shadow-xl flex items-center gap-4'>
      <div className='flex-1'>
        <p className='font-semibold text-white leading-tight'>Launch on startup</p>
        <p className='text-xs text-slate-400 mt-1'>
          {state.packaged
            ? 'Start Agent Pulse automatically when you sign in. Works on Windows, macOS, and Linux.'
            : 'Auto-launch is only applied to packaged installs. Toggle is remembered for the next build.'}
        </p>
      </div>
      <button
        onClick={handleToggle}
        className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
          checked ? 'bg-blue-500' : 'bg-slate-600'
        }`}
        aria-label='Toggle launch on startup'
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
};

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

type TabId = 'hooks' | 'bubble' | 'usage' | 'analytics' | 'guardrails' | 'updates';

const TABS: { id: TabId; label: string; description: string }[] = [
  { id: 'hooks',      label: 'Hooks',      description: 'Manage which AI tools show a status bubble.' },
  { id: 'bubble',     label: 'Bubble',     description: 'Size, screen position, and inactivity sound for the bubbles.' },
  { id: 'usage',      label: 'Usage',      description: 'Monitor Claude, Codex, and Antigravity plan usage.' },
  { id: 'analytics',  label: 'Analytics',  description: 'Heatmap, daily digest, model usage, and per-project time — all local.' },
  { id: 'guardrails', label: 'Guardrails', description: 'Block or warn on risky shell commands.' },
  { id: 'updates',    label: 'Updates',    description: 'Check for and install new versions of Agent Pulse.' },
];

export const SettingsPanel: React.FC = () => {
  const [tools, setTools] = useState<Record<ToolId, ToolConfig>>(
    {} as Record<ToolId, ToolConfig>,
  );
  const [loading, setLoading] = useState(false);
  const [activeInfo, setActiveInfo] = useState<ToolId | null>(null);
  const [usageConfig, setUsageConfig] = useState<UsageConfigUI | null>(null);
  const [usageStatus, setUsageStatus] = useState<UsageStatus>({ state: 'unknown' });
  const [codexUsageConfig, setCodexUsageConfig] = useState<CodexUsageConfigUI | null>(null);
  const [codexUsageStatus, setCodexUsageStatus] = useState<CodexUsageStatus>({ state: 'unknown' });
  const [antigravityUsageConfig, setAntigravityUsageConfig] = useState<AntigravityUsageConfigUI | null>(null);
  const [antigravityUsageStatus, setAntigravityUsageStatus] = useState<AntigravityUsageStatus>({ state: 'unknown' });
  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfigUI | null>(null);
  const [bubbleConfig, setBubbleConfig] = useState<BubbleConfig | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus>({
    mode: 'off', nextFireAt: null, nextEventKind: null, lastRun: null, openersToday: 0, windowResetsAt: null,
  });
  const [activeTab, setActiveTab] = useState<TabId>('hooks');
  const activeTabMeta = TABS.find((t) => t.id === activeTab)!;

  const getBubbleStates = React.useCallback(async (
    config?: { enabledBubbles?: Partial<Record<ToolId, boolean>> },
  ): Promise<Partial<Record<ToolId, boolean>>> => {
    try {
      return await window.electron.invoke('get-bubble-states');
    } catch (error) {
      logger.warn('[SettingsPanel] get-bubble-states unavailable; using saved config', error);
      return config?.enabledBubbles ?? {};
    }
  }, []);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const [detected, config] = await Promise.all([
          window.electron.invoke('detect-tools'),
          window.electron.invoke('get-config'),
        ]);
        const bubbleStates = await getBubbleStates(config);
        const toolList = Object.keys(TOOL_META) as ToolId[];
        const initialTools = {} as Record<ToolId, ToolConfig>;
        toolList.forEach((id) => {
          const det = detected[id];
          // Back-compat: detector may return boolean or { installed, location }
          const isObj = det && typeof det === 'object';
          initialTools[id] = {
            enabled: !!config?.enabledBubbles?.[id] && !!bubbleStates?.[id],
            appInstalled: isObj ? !!det.installed : !!det,
            hookInstalled: isObj ? !!det.hookInstalled : false,
            location: isObj ? det.location : undefined,
          };
        });
        setTools(initialTools);
        if (config?.usage) setUsageConfig(config.usage);
        if (config?.codexUsage) setCodexUsageConfig(config.codexUsage);
        if (config?.antigravityUsage) setAntigravityUsageConfig(config.antigravityUsage);
        if (config?.scheduler) setSchedulerConfig(config.scheduler);
        if (config?.bubble) setBubbleConfig(config.bubble);

        const initialUsage = await window.electron.invoke('usage:get-current').catch(() => null);
        if (initialUsage) setUsageStatus(initialUsage);
        const initialCodexUsage = await window.electron.invoke('codex-usage:get-current').catch(() => null);
        if (initialCodexUsage) setCodexUsageStatus(initialCodexUsage);
        const initialAntigravityUsage = await window.electron.invoke('antigravity-usage:get-current').catch(() => null);
        if (initialAntigravityUsage) setAntigravityUsageStatus(initialAntigravityUsage);
        const initialScheduler = await window.electron.invoke('scheduler:get-current').catch(() => null);
        if (initialScheduler) setSchedulerStatus(initialScheduler);
      } catch (error) {
        logger.error('[SettingsPanel] failed to initialize settings', error);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [getBubbleStates]);

  useEffect(() => {
    const handler = (_event: unknown, incoming: UsageStatus) => setUsageStatus(incoming);
    window.electron.on('usage:updated', handler);
    return () => window.electron.off('usage:updated', handler);
  }, []);

  useEffect(() => {
    const handler = (_event: unknown, incoming: CodexUsageStatus) => setCodexUsageStatus(incoming);
    window.electron.on('codex-usage:updated', handler);
    return () => window.electron.off('codex-usage:updated', handler);
  }, []);

  useEffect(() => {
    const handler = (_event: unknown, incoming: AntigravityUsageStatus) => setAntigravityUsageStatus(incoming);
    window.electron.on('antigravity-usage:updated', handler);
    return () => window.electron.off('antigravity-usage:updated', handler);
  }, []);

  useEffect(() => {
    const handler = (_event: unknown, incoming: SchedulerStatus) => setSchedulerStatus(incoming);
    window.electron.on('scheduler:updated', handler);
    return () => window.electron.off('scheduler:updated', handler);
  }, []);

  const handleUsageConfigChange = async (partial: Partial<UsageConfigUI>) => {
    try {
      const updated = await window.electron.invoke('usage:update-config', partial);
      setUsageConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update usage config', e);
    }
  };

  const handleUsageRefresh = () => {
    window.electron.send('usage:refresh-now');
  };

  const handleCodexUsageConfigChange = async (partial: Partial<CodexUsageConfigUI>) => {
    try {
      const updated = await window.electron.invoke('codex-usage:update-config', partial);
      setCodexUsageConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update Codex usage config', e);
    }
  };

  const handleCodexUsageRefresh = () => {
    window.electron.send('codex-usage:refresh-now');
  };

  const handleAntigravityUsageConfigChange = async (partial: Partial<AntigravityUsageConfigUI>) => {
    try {
      const updated = await window.electron.invoke('antigravity-usage:update-config', partial);
      setAntigravityUsageConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update Antigravity usage config', e);
    }
  };

  const handleAntigravityUsageRefresh = () => {
    window.electron.send('antigravity-usage:refresh-now');
  };

  const handleSchedulerConfigChange = async (partial: Partial<SchedulerConfigUI>) => {
    try {
      const updated = await window.electron.invoke('scheduler:update-config', partial);
      setSchedulerConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update scheduler config', e);
    }
  };

  const handleBubbleConfigChange = async (partial: Partial<BubbleConfig>) => {
    // Optimistically apply so the UI (selection highlight) feels instant, then
    // reconcile with the validated config the main process returns.
    setBubbleConfig((prev) => (prev ? { ...prev, ...partial } : prev));
    try {
      const updated = await window.electron.invoke('bubble:update-config', partial);
      setBubbleConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update bubble config', e);
    }
  };

  const handleSchedulerTestOpener = async () => {
    try {
      await window.electron.invoke('scheduler:test-opener');
    } catch (e) {
      logger.error('[SettingsPanel] test opener failed', e);
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function refreshBubbleStates() {
      const bubbleStates = await getBubbleStates();
      if (cancelled) return;
      setTools((prev) => {
        const next = { ...prev };
        (Object.keys(next) as ToolId[]).forEach((id) => {
          next[id] = { ...next[id], enabled: !!bubbleStates?.[id] };
        });
        return next;
      });
    }

    const interval = window.setInterval(() => {
      refreshBubbleStates().catch((error) => {
        logger.warn('[SettingsPanel] failed to refresh bubble states', error);
      });
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [getBubbleStates]);

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
          [toolId]: { ...prev[toolId], hookInstalled: true },
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
          [toolId]: { ...prev[toolId], hookInstalled: false },
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
          <p className='text-slate-400 mt-1 text-sm'>{activeTabMeta.description}</p>
        </div>
      </div>

      {/* Tab navigation */}
      <div
        role='tablist'
        aria-label='Settings sections'
        className='mb-8 flex gap-1 p-1 bg-slate-800/60 backdrop-blur-md border border-slate-700/70 rounded-xl w-fit shadow-lg'
      >
        {TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role='tab'
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors ${
                isActive
                  ? 'bg-slate-700 text-white shadow-inner'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/40'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'hooks' && (loading ? (
        <div className='flex items-center gap-3 text-slate-400'>
          <div className='w-4 h-4 border-2 border-slate-500 border-t-blue-400 rounded-full animate-spin' />
          Detecting tools…
        </div>
      ) : (
        <>
        <GeneralSection />
        <div className='grid grid-cols-1 md:grid-cols-2 gap-5'>
          {(Object.keys(TOOL_META) as ToolId[]).map((toolId) => {
            const meta = TOOL_META[toolId];
            const config = tools[toolId];
            if (!config) return null;

            const toolDetected = !!config.location || config.appInstalled;

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
                    <div className='flex items-center gap-1.5 flex-wrap'>
                      <p className='font-semibold text-white leading-tight'>
                        {meta.label}
                      </p>
                      {meta.badges?.map((badge) => (
                        <span
                          key={badge}
                          className='px-1.5 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[10px] font-semibold uppercase tracking-wide'
                        >
                          {badge}
                        </span>
                      ))}
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
                          {config.hookInstalled
                            ? '✓ Hook installed'
                            : 'Hook not installed'}
                        </p>
                        {config.location && (
                          <button
                            onClick={() =>
                              window.electron.invoke(
                                'open-path',
                                config.location,
                              )
                            }
                            className='flex items-center gap-1 mt-0.5 max-w-full cursor-pointer group text-left'
                            title={`Open: ${config.location}`}
                          >
                            <svg
                              xmlns='http://www.w3.org/2000/svg'
                              viewBox='0 0 16 16'
                              fill='currentColor'
                              className='w-2.5 h-2.5 text-slate-600 group-hover:text-blue-400 shrink-0 transition-colors'
                            >
                              <path d='M2 3.5A1.5 1.5 0 0 1 3.5 2h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H12.5A1.5 1.5 0 0 1 14 5.5v1H2v-3ZM2 8.5A1.5 1.5 0 0 1 3.5 7h9A1.5 1.5 0 0 1 14 8.5v4A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-4Z' />
                            </svg>
                            <span className='text-[10px] text-slate-500 group-hover:text-blue-400 font-mono truncate transition-colors'>
                              {config.location}
                            </span>
                          </button>
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
                    disabled={config.hookInstalled || !toolDetected}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      config.hookInstalled
                        ? 'bg-green-500/15 text-green-400 border border-green-500/30 cursor-default'
                        : !toolDetected
                          ? 'bg-slate-700/40 text-slate-500 cursor-not-allowed'
                          : 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                    }`}
                  >
                    {config.hookInstalled ? 'Hook Active' : 'Install Hook'}
                  </button>
                  <button
                    onClick={() => handleUninstallHook(toolId)}
                    disabled={!config.hookInstalled}
                    className='flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-default text-slate-300 transition-all enabled:cursor-pointer'
                  >
                    Uninstall
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        </>
      ))}

      {activeTab === 'hooks' && !loading && <StatesReference />}

      {activeTab === 'bubble' && (
        bubbleConfig ? (
          <BubbleSection config={bubbleConfig} onChange={handleBubbleConfigChange} />
        ) : (
          <p className='text-slate-400 text-sm'>Bubble settings are loading…</p>
        )
      )}

      {activeTab === 'usage' && (
        <>
          {usageConfig && (
            <UsageSection
              config={usageConfig}
              status={usageStatus}
              onChange={handleUsageConfigChange}
              onRefresh={handleUsageRefresh}
            />
          )}
          {codexUsageConfig && (
            <CodexUsageSection
              config={codexUsageConfig}
              status={codexUsageStatus}
              onChange={handleCodexUsageConfigChange}
              onRefresh={handleCodexUsageRefresh}
            />
          )}
          {antigravityUsageConfig && (
            <AntigravityUsageSection
              config={antigravityUsageConfig}
              status={antigravityUsageStatus}
              onChange={handleAntigravityUsageConfigChange}
              onRefresh={handleAntigravityUsageRefresh}
            />
          )}
          {schedulerConfig && (
            <SchedulerSection
              config={schedulerConfig}
              status={schedulerStatus}
              onChange={handleSchedulerConfigChange}
              onTestOpener={handleSchedulerTestOpener}
            />
          )}
          {!usageConfig && !codexUsageConfig && !antigravityUsageConfig && !schedulerConfig && (
            <p className='text-slate-400 text-sm'>Usage settings are loading…</p>
          )}
        </>
      )}

      {activeTab === 'analytics' && <AnalyticsTabContainer />}

      {activeTab === 'guardrails' && <GuardrailsTab />}

      {activeTab === 'updates' && <UpdatesTab />}

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

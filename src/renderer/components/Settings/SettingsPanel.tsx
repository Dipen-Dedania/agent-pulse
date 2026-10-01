import React, { useState, useEffect } from 'react';
import { hasPendingUpdate } from '../../../common/updater-types';
import { useUpdaterState } from '../../hooks/useUpdaterState';
import { AnimatePresence, motion } from 'framer-motion';
import { smooth, tabContent, tabContentTransition } from '../../motion';
import { ToolId, UsageStatus, CodexUsageStatus, CursorUsageStatus, CopilotUsageStatus, AntigravityUsageStatus, SchedulerStatus, BubbleConfig, AttentionConfig, StatusLineConfig, StatusLineDetectInfo, ThemeMode, AppearanceConfig, TourState } from '../../../common/types';
import { TOOL_META, HookInfo } from '../../../common/toolMeta';
import { logger } from '../../../common/logger';
import { StatesReference } from './StatesReference';
import { SetupChecklist } from './SetupChecklist';
import { UsageSection, UsageConfigUI } from './UsageSection';
import { CodexUsageSection, CodexUsageConfigUI } from './CodexUsageSection';
import { CursorUsageSection, CursorUsageConfigUI } from './CursorUsageSection';
import { CopilotUsageSection, CopilotUsageConfigUI } from './CopilotUsageSection';
import { AntigravityUsageSection, AntigravityUsageConfigUI } from './AntigravityUsageSection';
import { SchedulerSection, SchedulerConfigUI } from './SchedulerSection';
import { BubbleSection } from './BubbleSection';
import { AttentionSection } from './AttentionSection';
import { StatusLineSection } from './StatusLineSection';
import { Badge, GlassToggle, IconButton, Tooltip, Button, Spinner, Segmented, Tabs, Modal } from '../Shared';
import { GuardrailsTab } from './GuardrailsTab';
import { SecretProtectionTab } from './SecretProtectionTab';
import { AnalyticsTabContainer } from './AnalyticsTab';
import { BacklogBoardTab } from '../Backlog/BacklogBoardTab';
import { BacklogTour } from '../Backlog/BacklogTour';
import { BacklogSchedulerSection } from './BacklogSchedulerSection';
import { BacklogPopulationSection } from './BacklogPopulationSection';
import { BacklogMcpSection } from './BacklogMcpSection';
import { BacklogSchedulerConfig, BacklogPopulationConfig } from '../../../common/backlog-types';
import { useBacklogStore, useBacklogSync } from '../../store/useBacklogStore';
import { AppDialogHost, appAlert } from '../Shared';
import { UpdatesTab } from './UpdatesTab';
import { usePricingSync } from '../../pricing-sync';

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
    <motion.div
      whileHover={{ scale: 1.006 }}
      transition={smooth}
      className='glass-primary mb-6 p-5 flex items-center gap-4'
    >
      <div className='flex-1'>
        <p className='font-semibold text-strong leading-tight'>Launch on startup</p>
        <p className='text-xs text-muted mt-1'>
          {state.packaged
            ? 'Start Agent Pulse automatically when you sign in. Works on Windows, macOS, and Linux.'
            : 'Auto-launch is only applied to packaged installs. Toggle is remembered for the next build.'}
        </p>
      </div>
      <GlassToggle
        checked={checked}
        onChange={handleToggle}
        size='lg'
        label='Toggle launch on startup'
      />
    </motion.div>
  );
};

// ── Theme Icon Toggle (header) ───────────────────────────────────────────────

const SunIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor' className={className}>
    <path d='M10 2a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 2zM10 15a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 15zM10 7a3 3 0 100 6 3 3 0 000-6zM15.657 5.404a.75.75 0 10-1.06-1.06l-1.061 1.06a.75.75 0 001.06 1.06l1.06-1.06zM6.464 14.596a.75.75 0 10-1.06-1.06l-1.06 1.06a.75.75 0 001.06 1.06l1.06-1.06zM18 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 0118 10zM5 10a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5A.75.75 0 015 10zM14.596 15.657a.75.75 0 001.06-1.06l-1.06-1.061a.75.75 0 10-1.06 1.06l1.06 1.06zM5.404 6.464a.75.75 0 001.06-1.06L5.404 4.343a.75.75 0 00-1.06 1.06l1.06 1.061z' />
  </svg>
);

const MoonIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor' className={className}>
    <path fillRule='evenodd' d='M7.455 2.004a.75.75 0 01.26.77 7 7 0 009.958 7.967.75.75 0 011.067.853A8.5 8.5 0 116.647 1.921a.75.75 0 01.808.083z' clipRule='evenodd' />
  </svg>
);

const MonitorIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='currentColor' className={className}>
    <path fillRule='evenodd' d='M2 4.25A2.25 2.25 0 014.25 2h11.5A2.25 2.25 0 0118 4.25v8.5A2.25 2.25 0 0115.75 15h-3.105a3.501 3.501 0 001.1 1.677A.75.75 0 0113.26 18H6.74a.75.75 0 01-.484-1.323A3.501 3.501 0 007.355 15H4.25A2.25 2.25 0 012 12.75v-8.5zm1.5 0a.75.75 0 01.75-.75h11.5a.75.75 0 01.75.75v7.5a.75.75 0 01-.75.75H4.25a.75.75 0 01-.75-.75v-7.5z' clipRule='evenodd' />
  </svg>
);

const THEME_OPTIONS: { value: ThemeMode; Icon: React.FC<{ className?: string }>; label: string }[] = [
  { value: 'light', Icon: SunIcon,     label: 'Light' },
  { value: 'dark',  Icon: MoonIcon,    label: 'Dark'  },
  { value: 'auto',  Icon: MonitorIcon, label: 'Auto'  },
];

const ThemeIconToggle: React.FC = () => {
  const [theme, setTheme] = useState<ThemeMode>('auto');

  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('get-config')
      .then((cfg: { appearance?: AppearanceConfig }) => {
        if (!cancelled) setTheme(cfg.appearance?.theme ?? 'auto');
      })
      .catch(() => {});
    const handler = (_e: unknown, cfg: AppearanceConfig) => setTheme(cfg.theme);
    window.electron.on('appearance:config-updated', handler);
    return () => {
      cancelled = true;
      window.electron.off('appearance:config-updated', handler);
    };
  }, []);

  const handleTheme = (t: ThemeMode) => {
    setTheme(t);
    window.electron.invoke('appearance:update-config', { theme: t }).catch(() => {});
  };

  return (
    <div className='glass-secondary inline-flex gap-0.5 p-1 shrink-0'>
      {THEME_OPTIONS.map(({ value, Icon, label }) => (
        <Tooltip key={value} content={label}>
          <button
            onClick={() => handleTheme(value)}
            aria-label={`${label} theme`}
            className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${
              theme === value
                ? 'bg-blue-600 text-white shadow'
                : 'text-muted hover:text-strong hover:bg-control/40'
            }`}
          >
            <Icon className='w-4 h-4' />
          </button>
        </Tooltip>
      ))}
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
    <Modal eyebrow='Hook Installation' title={label} onClose={onClose}>
      {/* Tabs */}
      <Segmented
        options={[
          { value: 'install', label: 'Install' },
          { value: 'troubleshoot', label: 'Troubleshoot' },
        ]}
        value={tab}
        onChange={(v) => setTab(v as 'install' | 'troubleshoot')}
      />

      {tab === 'install' ? (
        <>
          {/* Badges */}
          <div className='flex flex-wrap gap-2'>
            <Badge tone='info' variant='pill' size='md' weight='medium' dot>
              {info.mechanism}
            </Badge>
            <Badge tone='neutral' variant='pill' size='md' className='font-mono'>
              {info.configFile}
            </Badge>
          </div>

          {/* Description */}
          <p className='text-sm text-body leading-relaxed'>
            {info.description}
          </p>

          {/* Snippet */}
          <div>
            <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-2'>
              Config snippet
            </p>
            <pre className='bg-glass/80 border border-edge/60 rounded-xl p-4 text-xs text-ok font-mono overflow-x-auto whitespace-pre leading-relaxed'>
              {info.snippet}
            </pre>
          </div>
        </>
      ) : (
        <div>
          <p className='text-xs font-semibold uppercase tracking-widest text-faint mb-3'>
            If status events aren't arriving
          </p>
          <ol className='flex flex-col gap-2.5 list-decimal list-inside text-sm text-body leading-relaxed'>
            {info.troubleshooting.map((step, i) => (
              <li key={i} className='pl-1'>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
};

// ── Guardrails parent (two sub-tabs) ────────────────────────────────────────────
// One "Guardrails" parent tab holding two clearly-distinct families: Command
// Guardrails (gate what an agent runs) and Secret Protection (gate what it
// reads). They share a visual language but never a merged rule list.
const GuardrailsParent: React.FC = () => {
  const [sub, setSub] = useState<'commands' | 'secrets'>('commands');
  return (
    <div className='mt-8'>
      <Tabs
        className='glass-secondary mb-6 w-fit'
        tone='blue'
        tabs={[
          { value: 'commands', label: 'Command Guardrails' },
          { value: 'secrets', label: 'Secret Protection' },
        ]}
        value={sub}
        onChange={(v) => setSub(v as 'commands' | 'secrets')}
      />
      {sub === 'commands' ? <GuardrailsTab /> : <SecretProtectionTab />}
    </div>
  );
};

// ── Settings tab icons (16px, inherit text colour) ───────────────────────────

type IconProps = { className?: string };
const tabSvg = (children: React.ReactNode, { className }: IconProps) => (
  <svg
    xmlns='http://www.w3.org/2000/svg'
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth={2}
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
  >
    {children}
  </svg>
);

// Hooks — a plug.
const HooksIcon: React.FC<IconProps> = (p) =>
  tabSvg(<><path d='M12 22v-5' /><path d='M9 8V2' /><path d='M15 8V2' /><path d='M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z' /></>, p);
// Bubble — a chat bubble.
const BubbleIcon: React.FC<IconProps> = (p) =>
  tabSvg(<path d='M7.9 20A9 9 0 1 0 4 16.1L2 22z' />, p);
// Plans & Limits — a gauge.
const PlansIcon: React.FC<IconProps> = (p) =>
  tabSvg(<><path d='m12 14 4-4' /><path d='M3.34 19a10 10 0 1 1 17.32 0' /></>, p);
// Backlog — a kanban board.
const BacklogIcon: React.FC<IconProps> = (p) =>
  tabSvg(<><path d='M6 5v11' /><path d='M12 5v6' /><path d='M18 5v14' /></>, p);
// Analytics — a bar chart.
const AnalyticsIcon: React.FC<IconProps> = (p) =>
  tabSvg(<><path d='M3 3v16a2 2 0 0 0 2 2h16' /><path d='M18 17V9' /><path d='M13 17V5' /><path d='M8 17v-3' /></>, p);
// Guardrails — a shield with a check.
const GuardrailsIcon: React.FC<IconProps> = (p) =>
  tabSvg(<><path d='M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z' /><path d='m9 12 2 2 4-4' /></>, p);
// Updates — a refresh loop with a download arrow.
const UpdatesIcon: React.FC<IconProps> = (p) =>
  tabSvg(<><path d='M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' /><path d='M21 3v5h-5' /></>, p);

// ── Settings Panel ────────────────────────────────────────────────────────────

export type TabId = 'hooks' | 'bubble' | 'usage' | 'backlog' | 'analytics' | 'guardrails' | 'updates';

const TABS: { id: TabId; label: string; Icon: React.FC<IconProps>; description: string }[] = [
  { id: 'hooks',      label: 'Hooks',      Icon: HooksIcon,      description: 'Manage which AI tools show a status bubble.' },
  { id: 'bubble',     label: 'Bubble',     Icon: BubbleIcon,     description: 'Size, screen position, and inactivity sound for the bubbles.' },
  { id: 'usage',      label: 'Plans & Limits', Icon: PlansIcon,  description: 'Monitor plan usage and configure Claude Code’s scheduler & status line.' },
  { id: 'backlog',    label: 'Backlog',    Icon: BacklogIcon,    description: 'Queue research tasks that run themselves during your idle windows.' },
  { id: 'analytics',  label: 'Analytics',  Icon: AnalyticsIcon,  description: 'Heatmap, daily digest, model usage, and per-project time — all local.' },
  { id: 'guardrails', label: 'Guardrails', Icon: GuardrailsIcon, description: 'Block risky shell commands and protect secret files from agents.' },
  { id: 'updates',    label: 'Updates',    Icon: UpdatesIcon,    description: 'Check for and install new versions of Agent Pulse.' },
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
  const [cursorUsageConfig, setCursorUsageConfig] = useState<CursorUsageConfigUI | null>(null);
  const [cursorUsageStatus, setCursorUsageStatus] = useState<CursorUsageStatus>({ state: 'unknown' });
  const [copilotUsageConfig, setCopilotUsageConfig] = useState<CopilotUsageConfigUI | null>(null);
  const [copilotUsageStatus, setCopilotUsageStatus] = useState<CopilotUsageStatus>({ state: 'unknown' });
  const [antigravityUsageConfig, setAntigravityUsageConfig] = useState<AntigravityUsageConfigUI | null>(null);
  const [antigravityUsageStatus, setAntigravityUsageStatus] = useState<AntigravityUsageStatus>({ state: 'unknown' });
  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfigUI | null>(null);
  const [backlogSchedulerConfig, setBacklogSchedulerConfig] = useState<BacklogSchedulerConfig | null>(null);
  const [backlogPopulationConfig, setBacklogPopulationConfig] = useState<BacklogPopulationConfig | null>(null);
  const [bubbleConfig, setBubbleConfig] = useState<BubbleConfig | null>(null);
  const [attentionConfig, setAttentionConfig] = useState<AttentionConfig | null>(null);
  const [statusLineConfig, setStatusLineConfig] = useState<StatusLineConfig | null>(null);
  const [statusLineDetect, setStatusLineDetect] = useState<StatusLineDetectInfo | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus>({
    mode: 'off', nextFireAt: null, nextEventKind: null, lastRun: null, openersToday: 0, windowResetsAt: null,
  });
  const [activeTab, setActiveTab] = useState<TabId>('hooks');
  // Updater state drives the attention dot on the Updates tab so a new
  // version is visible from any tab, not only once Updates is opened.
  const [updaterState] = useUpdaterState();
  const updatePending = updaterState ? hasPendingUpdate(updaterState.status) : false;
  // Which provider sub-tab is open within the Usage tab. Claude Code groups its
  // usage, scheduler, and status-line settings together since they're all
  // Claude Code features.
  const [usageSubTab, setUsageSubTab] = useState<ToolId>('claude-code');
  const activeTabMeta = TABS.find((t) => t.id === activeTab)!;

  // Install live LiteLLM rates; re-renders this panel (and its cost-showing
  // children) when fresher prices arrive from the main process.
  usePricingSync();

  // Backlog board data + engine status (shared by the Backlog tab and the
  // Backlog Scheduler section's glance). Hydrates once, then follows
  // main-process broadcasts.
  useBacklogSync();
  const backlogStatus = useBacklogStore((s) => s.status);
  const backlogProjectCount = useBacklogStore((s) => s.projects.length);

  // ── Backlog planner guided tour ───────────────────────────────────────────
  // The controller lives here (SettingsPanel level) so the spotlight overlay is
  // a sibling of the tab <AnimatePresence> and survives tab swaps — it drives
  // both activeTab and usageSubTab to walk into Usage → Claude Code.
  const [backlogTourActive, setBacklogTourActive] = useState(false);
  const [tourState, setTourState] = useState<TourState | null>(null);
  const backlogAutoRanRef = React.useRef(false);

  useEffect(() => {
    let cancelled = false;
    window.electron
      .invoke('tour:get-state')
      .then((s: TourState) => { if (!cancelled) setTourState(s); })
      .catch((e: unknown) => logger.debug('[SettingsPanel] tour:get-state failed', e));
    const handler = (_e: unknown, s: TourState) => setTourState(s);
    window.electron.on('tour:state-updated', handler);
    return () => {
      cancelled = true;
      window.electron.off('tour:state-updated', handler);
    };
  }, []);

  const startBacklogTour = React.useCallback(() => {
    backlogAutoRanRef.current = true; // a manual run also satisfies the auto-run-once guard
    setBacklogTourActive(true);
  }, []);

  const finishBacklogTour = React.useCallback(() => {
    setBacklogTourActive(false);
    window.electron
      .invoke('backlog-tour:set-seen', true)
      .catch((e: unknown) => logger.warn('[SettingsPanel] backlog-tour:set-seen failed', e));
  }, []);

  // Auto-run once on the first Backlog-tab visit — but only after the first-run
  // bubble tour is done (guard against overlap) and only once per install.
  useEffect(() => {
    if (activeTab !== 'backlog') return;
    if (backlogAutoRanRef.current || backlogTourActive) return;
    if (!tourState || !tourState.hasSeenTour || tourState.hasSeenBacklogTour) return;
    backlogAutoRanRef.current = true;
    setBacklogTourActive(true);
  }, [activeTab, tourState, backlogTourActive]);

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
        if (config?.cursorUsage) setCursorUsageConfig(config.cursorUsage);
        if (config?.copilotUsage) setCopilotUsageConfig(config.copilotUsage);
        if (config?.antigravityUsage) setAntigravityUsageConfig(config.antigravityUsage);
        if (config?.scheduler) setSchedulerConfig(config.scheduler);
        if (config?.backlogScheduler) setBacklogSchedulerConfig(config.backlogScheduler);
        if (config?.backlogPopulation) setBacklogPopulationConfig(config.backlogPopulation);
        if (config?.bubble) setBubbleConfig(config.bubble);
        if (config?.attention) setAttentionConfig(config.attention);
        if (config?.statusLine) setStatusLineConfig(config.statusLine);
        const detectStatusLine = await window.electron.invoke('status-line:detect').catch(() => null);
        if (detectStatusLine) setStatusLineDetect(detectStatusLine);

        const initialUsage = await window.electron.invoke('usage:get-current').catch(() => null);
        if (initialUsage) setUsageStatus(initialUsage);
        const initialCodexUsage = await window.electron.invoke('codex-usage:get-current').catch(() => null);
        if (initialCodexUsage) setCodexUsageStatus(initialCodexUsage);
        const initialCursorUsage = await window.electron.invoke('cursor-usage:get-current').catch(() => null);
        if (initialCursorUsage) setCursorUsageStatus(initialCursorUsage);
        const initialCopilotUsage = await window.electron.invoke('copilot-usage:get-current').catch(() => null);
        if (initialCopilotUsage) setCopilotUsageStatus(initialCopilotUsage);
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
    const handler = (_event: unknown, incoming: CursorUsageStatus) => setCursorUsageStatus(incoming);
    window.electron.on('cursor-usage:updated', handler);
    return () => window.electron.off('cursor-usage:updated', handler);
  }, []);

  useEffect(() => {
    const handler = (_event: unknown, incoming: CopilotUsageStatus) => setCopilotUsageStatus(incoming);
    window.electron.on('copilot-usage:updated', handler);
    return () => window.electron.off('copilot-usage:updated', handler);
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

  useEffect(() => {
    const handler = (_event: unknown, incoming: BacklogSchedulerConfig) => setBacklogSchedulerConfig(incoming);
    window.electron.on('backlog:scheduler:config-updated', handler);
    return () => window.electron.off('backlog:scheduler:config-updated', handler);
  }, []);

  useEffect(() => {
    const handler = (_event: unknown, incoming: BacklogPopulationConfig) => setBacklogPopulationConfig(incoming);
    window.electron.on('backlog:population:config-updated', handler);
    return () => window.electron.off('backlog:population:config-updated', handler);
  }, []);

  useEffect(() => {
    const handler = (_event: unknown, incoming: StatusLineConfig) => setStatusLineConfig(incoming);
    window.electron.on('status-line:config-updated', handler);
    return () => window.electron.off('status-line:config-updated', handler);
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

  const handleCursorUsageConfigChange = async (partial: Partial<CursorUsageConfigUI>) => {
    try {
      const updated = await window.electron.invoke('cursor-usage:update-config', partial);
      setCursorUsageConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update Cursor usage config', e);
    }
  };

  const handleCursorUsageRefresh = () => {
    window.electron.send('cursor-usage:refresh-now');
  };

  const handleCopilotUsageConfigChange = async (partial: Partial<CopilotUsageConfigUI>) => {
    try {
      const updated = await window.electron.invoke('copilot-usage:update-config', partial);
      setCopilotUsageConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update Copilot usage config', e);
    }
  };

  const handleCopilotUsageRefresh = () => {
    window.electron.send('copilot-usage:refresh-now');
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

  const handleBacklogSchedulerConfigChange = async (partial: Partial<BacklogSchedulerConfig>) => {
    // Optimistic apply for instant feedback, then reconcile with the validated
    // config the main process returns.
    setBacklogSchedulerConfig((prev) => (prev ? { ...prev, ...partial } : prev));
    try {
      const updated = await window.electron.invoke('backlog:scheduler:update-config', partial);
      setBacklogSchedulerConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update backlog scheduler config', e);
    }
  };

  const handleBacklogPopulationConfigChange = async (partial: Partial<BacklogPopulationConfig>) => {
    setBacklogPopulationConfig((prev) => (prev ? { ...prev, ...partial } : prev));
    try {
      const updated = await window.electron.invoke('backlog:population:update-config', partial);
      setBacklogPopulationConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update backlog population config', e);
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

  const handleAttentionConfigChange = async (partial: Partial<AttentionConfig>) => {
    // Optimistic apply for instant feedback, then reconcile with the validated
    // config the main process returns.
    setAttentionConfig((prev) => (prev ? { ...prev, ...partial } : prev));
    try {
      const updated = await window.electron.invoke('attention:update-config', partial);
      setAttentionConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update attention config', e);
    }
  };

  const handleStatusLineConfigChange = async (partial: Partial<StatusLineConfig>) => {
    // Optimistic apply for an instant preview, then reconcile with the
    // validated config the main process returns.
    setStatusLineConfig((prev) => (prev ? { ...prev, ...partial } : prev));
    try {
      const updated = await window.electron.invoke('status-line:update-config', partial);
      setStatusLineConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to update status-line config', e);
    }
  };

  const handleStatusLineReset = async () => {
    try {
      const updated = await window.electron.invoke('status-line:reset-config');
      if (updated) setStatusLineConfig(updated);
    } catch (e) {
      logger.error('[SettingsPanel] failed to reset status-line config', e);
    }
  };

  const refreshStatusLineDetect = async () => {
    const detect = await window.electron.invoke('status-line:detect').catch(() => null);
    if (detect) setStatusLineDetect(detect);
  };

  const handleStatusLineInstall = async (replace?: boolean) => {
    try {
      const result = await window.electron.invoke('status-line:install', { replace });
      if (result?.reason === 'no-runtime') {
        void appAlert(
          'No script runtime (Node, Python, or PowerShell) was found on your PATH. Install Node.js to enable the status line.',
          'Status line',
        );
      } else if (result?.reason === 'error') {
        void appAlert('Failed to install status line: ' + (result.message ?? 'unknown error'), 'Status line');
      }
    } catch (e) {
      logger.error('[SettingsPanel] failed to install status line', e);
    } finally {
      await refreshStatusLineDetect();
    }
  };

  const handleStatusLineRemove = async () => {
    try {
      await window.electron.invoke('status-line:remove');
    } catch (e) {
      logger.error('[SettingsPanel] failed to remove status line', e);
    } finally {
      await refreshStatusLineDetect();
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
      void appAlert('Failed to install hook: ' + e, 'Hooks');
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
      void appAlert('Failed to uninstall hook: ' + e, 'Hooks');
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
    <div className='h-screen overflow-y-auto apple-scroll settings-liquid-bg text-strong p-8 font-sans'>
      {/* Header */}
      <div className='mb-10 flex items-start gap-3'>
        <IconButton
          size='lg'
          tone='outline'
          className='mt-1'
          onClick={handleBack}
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
        </IconButton>
        <img
          src='./assets/logo-transparent.png'
          alt='Agent Pulse'
          className='w-10 h-10 object-contain shrink-0'
        />
        <div className='flex-1'>
          <h1 className='text-3xl font-bold tracking-tight'>Agent Pulse</h1>
          <p className='text-muted mt-1 text-sm'>{activeTabMeta.description}</p>
        </div>
        <ThemeIconToggle />
      </div>

      {/* Tab navigation */}
      <Tabs
        className='glass-primary rounded-xl mb-8'
        ariaLabel='Settings sections'
        tone='glass'
        fill
        tabs={TABS.map((t) => ({
          value: t.id,
          label: t.label,
          icon: <t.Icon />,
          badge: t.id === 'updates' && updatePending,
        }))}
        value={activeTab}
        onChange={(v) => setActiveTab(v as TabId)}
      />

      {/* Tab body — cross-fades on tab switch (settle-in from below). Modals
          below stay outside so they aren't torn down when the tab changes. */}
      <AnimatePresence mode='wait'>
        <motion.div
          key={activeTab}
          variants={tabContent}
          initial='initial'
          animate='animate'
          exit='exit'
          transition={tabContentTransition}
        >
      {activeTab === 'hooks' && (loading ? (
        <div className='flex items-center gap-3 text-muted'>
          <Spinner size='md' />
          Detecting tools…
        </div>
      ) : (
        <>
        <SetupChecklist
          anyHookInstalled={Object.values(tools).some((t) => t.hookInstalled)}
          anyBubbleEnabled={Object.values(tools).some((t) => t.enabled)}
        />
        <GeneralSection />
        <div className='grid grid-cols-1 md:grid-cols-2 gap-5'>
          {(Object.keys(TOOL_META) as ToolId[]).map((toolId) => {
            const meta = TOOL_META[toolId];
            const config = tools[toolId];
            if (!config) return null;

            const toolDetected = !!config.location || config.appInstalled;

            return (
              <motion.div
                key={toolId}
                whileHover={{ scale: 1.006 }}
                transition={smooth}
                className={`glass-primary p-5 flex flex-col gap-4 ${
                  !toolDetected ? 'opacity-60' : ''
                }`}
              >
                {/* Tool header */}
                <div className='flex items-center gap-4'>
                  <div className='w-11 h-11 rounded-xl bg-control/60 flex items-center justify-center shrink-0'>
                    <img
                      src={meta.icon}
                      alt={meta.label}
                      className='w-7 h-7 object-contain'
                    />
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-1.5 flex-wrap'>
                      <p className='font-semibold text-strong leading-tight'>
                        {meta.label}
                      </p>
                      {meta.badges?.map((badge) => (
                        <span
                          key={badge}
                          className='px-1.5 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-info text-[10px] font-semibold uppercase tracking-wide'
                        >
                          {badge}
                        </span>
                      ))}
                      <button
                        onClick={() => setActiveInfo(toolId)}
                        className='flex-shrink-0 w-4 h-4 rounded-full bg-control-strong/70 hover:bg-blue-500/60 border border-edge-strong/50 hover:border-blue-400/50 text-muted hover:text-info text-[9px] font-bold flex items-center justify-center cursor-pointer transition-colors'
                        aria-label={`How ${meta.label} hook is installed`}
                      >
                        i
                      </button>
                    </div>
                    {toolDetected ? (
                      <>
                        <p className='text-xs text-muted mt-0.5'>
                          {config.hookInstalled
                            ? '✓ Hook installed'
                            : 'Hook not installed'}
                        </p>
                        {config.location && (
                          <Tooltip content={`Open: ${config.location}`}>
                            <button
                              onClick={() =>
                                window.electron.invoke(
                                  'open-path',
                                  config.location,
                                )
                              }
                              className='flex items-center gap-1 mt-0.5 max-w-full cursor-pointer group text-left'
                            >
                              <svg
                                xmlns='http://www.w3.org/2000/svg'
                                viewBox='0 0 16 16'
                                fill='currentColor'
                                className='w-2.5 h-2.5 text-muted group-hover:text-info shrink-0 transition-colors'
                              >
                                <path d='M2 3.5A1.5 1.5 0 0 1 3.5 2h2.879a1.5 1.5 0 0 1 1.06.44l1.122 1.12A1.5 1.5 0 0 0 9.62 4H12.5A1.5 1.5 0 0 1 14 5.5v1H2v-3ZM2 8.5A1.5 1.5 0 0 1 3.5 7h9A1.5 1.5 0 0 1 14 8.5v4A1.5 1.5 0 0 1 12.5 14h-9A1.5 1.5 0 0 1 2 12.5v-4Z' />
                              </svg>
                              <span className='text-[10px] text-faint group-hover:text-info font-mono truncate transition-colors'>
                                {config.location}
                              </span>
                            </button>
                          </Tooltip>
                        )}
                      </>
                    ) : (
                      <p className='text-xs text-faint mt-0.5 italic'>
                        Not installed on this machine
                      </p>
                    )}
                  </div>
                  {/* Bubble toggle */}
                  <GlassToggle
                    checked={config.enabled}
                    onChange={() => handleToggleBubble(toolId, !config.enabled)}
                    disabled={!toolDetected}
                    size='lg'
                    label='Toggle bubble'
                  />
                </div>

                {/* Actions */}
                <div className='flex gap-2'>
                  {/* Once installed there's nothing left to press — this reads
                      as a status, so it stops being a (disabled) button. */}
                  {config.hookInstalled ? (
                    <Badge tone='ok' variant='pill' size='md' className='flex-1 justify-center'>
                      Hook Active
                    </Badge>
                  ) : (
                    <Button
                      onClick={() => handleInstallHook(toolId)}
                      disabled={!toolDetected}
                      className='flex-1'
                    >
                      Install Hook
                    </Button>
                  )}
                  <Button
                    variant='secondary'
                    onClick={() => handleUninstallHook(toolId)}
                    disabled={!config.hookInstalled}
                    className='flex-1'
                  >
                    Uninstall
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
        </>
      ))}

      {activeTab === 'hooks' && !loading && <StatesReference />}

      {activeTab === 'bubble' && (
        bubbleConfig ? (
          <div className='flex flex-col gap-6'>
            <BubbleSection config={bubbleConfig} onChange={handleBubbleConfigChange} />
            {attentionConfig && (
              <AttentionSection config={attentionConfig} onChange={handleAttentionConfigChange} />
            )}
          </div>
        ) : (
          <p className='text-muted text-sm'>Bubble settings are loading…</p>
        )
      )}

      {activeTab === 'usage' && (() => {
        // One sub-tab per provider; Claude Code's pill also hosts the scheduler
        // and status-line settings. A pill only appears once its config has
        // loaded, so it always maps to renderable content.
        const providers: { toolId: ToolId; hasConfig: boolean }[] = [
          { toolId: 'claude-code', hasConfig: !!usageConfig },
          { toolId: 'openai-codex', hasConfig: !!codexUsageConfig },
          { toolId: 'cursor', hasConfig: !!cursorUsageConfig },
          { toolId: 'vscode-copilot', hasConfig: !!copilotUsageConfig },
          { toolId: 'antigravity-cli', hasConfig: !!antigravityUsageConfig },
        ];
        const available = providers.filter((p) => p.hasConfig);
        if (available.length === 0) {
          return <p className='text-muted text-sm'>Usage settings are loading…</p>;
        }
        // Fall back to the first available provider if the remembered one isn't
        // (yet) loaded, so the view is never empty.
        const active = available.some((p) => p.toolId === usageSubTab)
          ? usageSubTab
          : available[0].toolId;

        return (
          <div>
            <Tabs
              className='glass-secondary flex-wrap mb-2 w-fit'
              tone='blue'
              tabs={available.map((p) => ({
                value: p.toolId,
                label: (
                  <span className='flex items-center gap-2'>
                    <img
                      src={TOOL_META[p.toolId].icon}
                      alt=''
                      className='w-4 h-4 object-contain'
                    />
                    {TOOL_META[p.toolId].label}
                  </span>
                ),
              }))}
              value={active}
              onChange={(v) => setUsageSubTab(v as ToolId)}
            />

            {active === 'claude-code' && (
              <>
                {usageConfig && (
                  <UsageSection
                    config={usageConfig}
                    status={usageStatus}
                    onChange={handleUsageConfigChange}
                    onRefresh={handleUsageRefresh}
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
                {backlogSchedulerConfig && (
                  <BacklogSchedulerSection
                    config={backlogSchedulerConfig}
                    status={backlogStatus}
                    onChange={handleBacklogSchedulerConfigChange}
                  />
                )}
                {backlogPopulationConfig && (
                  <BacklogPopulationSection
                    config={backlogPopulationConfig}
                    onChange={handleBacklogPopulationConfigChange}
                  />
                )}
                <BacklogMcpSection />
                {statusLineConfig && statusLineDetect && (
                  <StatusLineSection
                    config={statusLineConfig}
                    detect={statusLineDetect}
                    onChange={handleStatusLineConfigChange}
                    onInstall={handleStatusLineInstall}
                    onRemove={handleStatusLineRemove}
                    onReset={handleStatusLineReset}
                  />
                )}
              </>
            )}

            {active === 'openai-codex' && codexUsageConfig && (
              <CodexUsageSection
                config={codexUsageConfig}
                status={codexUsageStatus}
                onChange={handleCodexUsageConfigChange}
                onRefresh={handleCodexUsageRefresh}
              />
            )}

            {active === 'cursor' && cursorUsageConfig && (
              <CursorUsageSection
                config={cursorUsageConfig}
                status={cursorUsageStatus}
                onChange={handleCursorUsageConfigChange}
                onRefresh={handleCursorUsageRefresh}
              />
            )}

            {active === 'vscode-copilot' && copilotUsageConfig && (
              <CopilotUsageSection
                config={copilotUsageConfig}
                status={copilotUsageStatus}
                onChange={handleCopilotUsageConfigChange}
                onRefresh={handleCopilotUsageRefresh}
              />
            )}

            {active === 'antigravity-cli' && antigravityUsageConfig && (
              <AntigravityUsageSection
                config={antigravityUsageConfig}
                status={antigravityUsageStatus}
                onChange={handleAntigravityUsageConfigChange}
                onRefresh={handleAntigravityUsageRefresh}
              />
            )}
          </div>
        );
      })()}

      {activeTab === 'backlog' && <BacklogBoardTab onStartTour={startBacklogTour} />}

      {activeTab === 'analytics' && <AnalyticsTabContainer />}

      {activeTab === 'guardrails' && <GuardrailsParent />}

      {activeTab === 'updates' && <UpdatesTab />}
        </motion.div>
      </AnimatePresence>

      {/* Backlog planner guided tour — hoisted out of the tab AnimatePresence so
          the spotlight survives the walk into Usage → Claude Code. */}
      <BacklogTour
        active={backlogTourActive}
        projectCount={backlogProjectCount}
        activeTab={activeTab}
        usageSubTab={usageSubTab}
        setActiveTab={setActiveTab}
        setUsageSubTab={setUsageSubTab}
        onFinish={finishBacklogTour}
      />

      <AnimatePresence>
        {activeInfo && (
          <HookInfoModal
            info={TOOL_META[activeInfo].hookInfo}
            label={TOOL_META[activeInfo].label}
            onClose={() => setActiveInfo(null)}
          />
        )}
      </AnimatePresence>

      {/* Styled alert/confirm host — replaces the renderer-blocking native dialogs. */}
      <AppDialogHost />
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { AnalyticsConfig } from '../../../common/timeline-types';
import { logger } from '../../../common/logger';
import { DigestCard } from './analytics/DigestCard';
import { WindowValueCard } from './analytics/WindowValueCard';
import { HeatmapCard } from './analytics/HeatmapCard';
import { HourRhythmCard } from './analytics/HourRhythmCard';
import { ToolMixCard } from './analytics/ToolMixCard';
import { ModelUsageCard } from './analytics/ModelUsageCard';
import { ProjectBreakdownCard } from './analytics/ProjectBreakdownCard';
import { TokensTimelineCard } from './analytics/TokensTimelineCard';
import { GuardrailsCard } from './analytics/GuardrailsCard';
import { Card } from './analytics/shared';
import { bustCache } from './analytics/useAnalytics';
import { PRICING_LAST_UPDATED } from '../../../common/pricing';

interface TimelineStatus {
  available: boolean;
  reason?: string;
}

const UnavailableBanner: React.FC<{ reason: string }> = ({ reason }) => (
  <div className='mb-5 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-5'>
    <div className='flex items-start gap-3'>
      <div className='w-8 h-8 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-300 shrink-0'>
        !
      </div>
      <div className='flex-1'>
        <p className='font-semibold text-amber-200 leading-tight'>Pulse Timeline isn't running</p>
        <p className='text-sm text-amber-100/80 mt-1'>{reason}</p>
        <p className='text-xs text-amber-100/70 mt-2 font-mono bg-slate-900/40 border border-slate-700/40 rounded-lg px-3 py-2'>
          npm run rebuild:native
        </p>
        <p className='text-[11px] text-amber-100/60 mt-2'>
          Run that in your terminal, then restart the app. The rest of Agent Pulse works without the timeline.
        </p>
      </div>
    </div>
  </div>
);

interface Props {
  config: AnalyticsConfig;
  onConfigChange: (partial: Partial<AnalyticsConfig>) => void;
}

const PrivacyAndSettings: React.FC<Props> = ({ config, onConfigChange }) => {
  const [gap, setGap] = useState<number>(config.idleGapMinutes);
  useEffect(() => { setGap(config.idleGapMinutes); }, [config.idleGapMinutes]);

  return (
    <Card title='Settings' subtitle='Local-only. None of this leaves your machine.'>
      <div className='flex items-center justify-between gap-4 mb-4'>
        <div className='flex-1'>
          <p className='font-medium text-white text-sm leading-tight'>Redact task text</p>
          <p className='text-xs text-slate-400 mt-1'>
            Drop task summaries when storing events. Use for screen-sharing — existing rows stay intact.
          </p>
        </div>
        <button
          onClick={() => onConfigChange({ redactTaskText: !config.redactTaskText })}
          className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 cursor-pointer ${
            config.redactTaskText ? 'bg-blue-500' : 'bg-slate-600'
          }`}
          aria-label='Toggle task-text redaction'
        >
          <span
            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
              config.redactTaskText ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      <div className='flex items-center justify-between gap-4'>
        <div className='flex-1'>
          <p className='font-medium text-white text-sm leading-tight'>Idle gap before closing a session</p>
          <p className='text-xs text-slate-400 mt-1'>
            How long an agent must be quiet before its session closes. Shorter = more sessions, less aggregation.
          </p>
        </div>
        <div className='flex items-center gap-2 shrink-0'>
          <input
            type='range'
            min={1}
            max={30}
            step={1}
            value={gap}
            onChange={(e) => setGap(parseInt(e.target.value, 10))}
            onMouseUp={() => onConfigChange({ idleGapMinutes: gap })}
            onTouchEnd={() => onConfigChange({ idleGapMinutes: gap })}
            className='w-32 cursor-pointer'
          />
          <span className='text-xs font-mono text-slate-300 w-12 text-right'>{gap} min</span>
        </div>
      </div>
    </Card>
  );
};

export const AnalyticsTab: React.FC<Props & { status: TimelineStatus }> = ({ config, onConfigChange, status }) => {
  // Bust the renderer cache when the user changes settings so subsequent
  // queries reflect new redaction / idle-gap behavior immediately.
  const handleConfigChange = (partial: Partial<AnalyticsConfig>) => {
    bustCache();
    onConfigChange(partial);
  };

  return (
    <div>
      {!status.available && (
        <UnavailableBanner reason={status.reason ?? 'Pulse Timeline is currently unavailable.'} />
      )}
      <DigestCard />
      <WindowValueCard />
      <HeatmapCard />
      <TokensTimelineCard />
      <div className='grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-5'>
        <HourRhythmCard />
        <ToolMixCard />
      </div>
      <ModelUsageCard />
      <ProjectBreakdownCard />
      <GuardrailsCard />
      <PrivacyAndSettings config={config} onConfigChange={handleConfigChange} />
      <p className='text-[11px] text-slate-500 text-center mt-1 mb-3'>
        Costs are estimates at public API list prices (updated {PRICING_LAST_UPDATED}), not your actual plan billing.
        Only agents that expose token usage can be priced.
      </p>
    </div>
  );
};

// Surface a small wrapper that loads/saves the analytics config so the parent
// SettingsPanel doesn't need to know how the IPC handlers are named.
export const AnalyticsTabContainer: React.FC = () => {
  const [config, setConfig] = useState<AnalyticsConfig | null>(null);
  const [status, setStatus] = useState<TimelineStatus>({ available: true });

  useEffect(() => {
    let cancelled = false;
    window.electron.invoke('get-config').then((cfg: { analytics?: AnalyticsConfig }) => {
      if (cancelled) return;
      if (cfg?.analytics) setConfig(cfg.analytics);
      else setConfig({ redactTaskText: false, idleGapMinutes: 5 });
    }).catch((e) => logger.warn('[AnalyticsTab] failed to load config', e));
    window.electron.invoke('analytics:get-status').then((s: TimelineStatus | null) => {
      if (cancelled || !s) return;
      setStatus(s);
    }).catch(() => { /* status is best-effort */ });
    return () => { cancelled = true; };
  }, []);

  const handleChange = async (partial: Partial<AnalyticsConfig>) => {
    try {
      const next = await window.electron.invoke('analytics:update-config', partial);
      setConfig(next);
    } catch (e) {
      logger.warn('[AnalyticsTab] failed to update config', e);
    }
  };

  if (!config) {
    return <p className='text-slate-400 text-sm'>Analytics loading…</p>;
  }
  return <AnalyticsTab config={config} onConfigChange={handleChange} status={status} />;
};

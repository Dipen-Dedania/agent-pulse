import React, { useEffect, useState } from 'react';
import { AnalyticsConfig, TimelineRange } from '../../../common/timeline-types';
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
import { SecretProtectionCard } from './analytics/SecretProtectionCard';
import { SummaryHeroCard } from './analytics/SummaryHeroCard';
import { Card, Segmented } from './analytics/shared';
import { refreshAnalytics, useAnalyticsFreshness } from './analytics/useAnalytics';
import { AnalyticsRangeProvider, RANGE_OPTIONS } from './analytics/rangeContext';
import { usePricingSync } from '../../pricing-sync';

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

// "updated 12s ago ↻" — freshness of the newest fetch plus a manual refresh
// that re-queries every mounted card at once.
const FreshnessControl: React.FC = () => {
  const fetchedAt = useAnalyticsFreshness();
  const ago = fetchedAt != null ? Math.max(0, Math.round((Date.now() - fetchedAt) / 1000)) : null;
  const label = ago == null ? 'loading…' : ago < 5 ? 'just now' : ago < 90 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
  return (
    <div className='flex items-center gap-1.5 text-[11px] text-slate-500'>
      <span>updated {label}</span>
      <button
        onClick={refreshAnalytics}
        aria-label='Refresh analytics'
        title='Refresh'
        className='w-6 h-6 rounded-md border border-slate-700/60 bg-slate-800/60 text-slate-400 hover:text-white hover:border-slate-500/70 transition-colors cursor-pointer'
      >
        ↻
      </button>
    </div>
  );
};

const PrivacyAndSettings: React.FC<Props> = ({ config, onConfigChange }) => {
  const [gap, setGap] = useState<number>(config.idleGapMinutes);
  const [open, setOpen] = useState(false);
  useEffect(() => { setGap(config.idleGapMinutes); }, [config.idleGapMinutes]);

  // Collapsed by default: settings are visited rarely and shouldn't sit in the
  // middle of the reading flow between analytics cards and the footer.
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className='w-full mb-5 bg-slate-800/40 border border-slate-700/50 rounded-2xl px-5 py-3 flex items-center justify-between text-left cursor-pointer hover:border-slate-600/70 transition-colors'
      >
        <span className='text-sm font-medium text-slate-300'>Analytics settings</span>
        <span className='text-xs text-slate-500'>Redaction · idle gap · show ▾</span>
      </button>
    );
  }

  return (
    <Card
      title='Settings'
      subtitle='Local-only. None of this leaves your machine.'
      right={
        <button onClick={() => setOpen(false)} className='text-xs text-slate-500 hover:text-white cursor-pointer'>
          hide ▴
        </button>
      }
    >
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
  // One range scopes every range-aware card below the filter row.
  const [range, setRange] = useState<TimelineRange>('30d');

  // Refresh (cache-drop + refetch) when the user changes settings so queries
  // reflect new redaction / idle-gap behavior immediately.
  const handleConfigChange = (partial: Partial<AnalyticsConfig>) => {
    refreshAnalytics();
    onConfigChange(partial);
  };

  // Provenance of the rates behind every cost on this tab.
  const pricing = usePricingSync();
  const priceProvenance =
    pricing.source === 'litellm'
      ? `from LiteLLM, updated ${pricing.lastUpdated}`
      : `updated ${pricing.lastUpdated}`;

  return (
    <AnalyticsRangeProvider value={range}>
      <div>
        {!status.available && (
          <UnavailableBanner reason={status.reason ?? 'Pulse Timeline is currently unavailable.'} />
        )}

        {/* Filter row: the range scopes every card below it (the digest and
            trailing-window cards keep their intrinsic windows and say so). */}
        <div className='mb-4 flex items-center justify-between gap-3 flex-wrap'>
          <Segmented
            value={range}
            onChange={(v) => setRange(v as TimelineRange)}
            options={RANGE_OPTIONS}
          />
          <FreshnessControl />
        </div>

        <SummaryHeroCard />
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
        <SecretProtectionCard />
        <PrivacyAndSettings config={config} onConfigChange={handleConfigChange} />
        <p className='text-[11px] text-slate-500 text-center mt-1 mb-3'>
          Costs are estimates at public API list prices ({priceProvenance}), not your actual plan billing.
          Only agents that expose token usage can be priced.
        </p>
      </div>
    </AnalyticsRangeProvider>
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

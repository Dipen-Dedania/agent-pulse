import React, { useEffect, useState } from 'react';
import { BacklogPopulationConfig, IssueFilterMode } from '../../../common/backlog-types';
import { GlassToggle, Select } from '../Shared';

// Settings → Usage → Claude Code: issue population config (Phase 3), sibling of
// the Backlog Scheduler section. Governs GitLab + Linear population defaults.
// The per-project link + scan + review live on the board itself; this governs
// defaults + the optional background refresh. See backlog-phase3-gitlab-population-plan.md.

interface Props {
  config: BacklogPopulationConfig;
  onChange: (partial: Partial<BacklogPopulationConfig>) => void;
}

const MODEL_PRESETS: { value: string; label: string }[] = [
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5 (cheap · default)' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'claude-opus-4-8', label: 'Opus 4.8' },
];

const isPresetModel = (m: string) => MODEL_PRESETS.some((p) => p.value === m);

export const BacklogPopulationSection: React.FC<Props> = ({ config, onChange }) => {
  const [custom, setCustom] = useState(!isPresetModel(config.scoutModel));
  const [modelText, setModelText] = useState(config.scoutModel);
  useEffect(() => {
    setCustom(!isPresetModel(config.scoutModel));
    setModelText(config.scoutModel);
  }, [config.scoutModel]);

  return (
    <section className='mt-6 glass-primary p-6' data-tour='backlog-population'>
      <div className='flex items-start gap-4'>
        <div className='flex-1 min-w-0'>
          <h2 className='text-lg font-bold text-strong'>Issue population</h2>
          <p className='text-sm text-muted mt-1'>
            Fill the <span className='text-body'>Backlog</span> board from your open issues in
            <span className='text-body'> GitLab</span> or <span className='text-body'>Linear</span>. Link a
            project on the board — GitLab reads the repo’s <span className='font-mono'>origin</span> remote,
            Linear links to a team you pick — then scan and review &amp; import; imported issues land in
            Refinement. Uses your org connectors, so there’s no token to manage.
          </p>
        </div>
        <GlassToggle checked={config.enabled} onChange={(v) => onChange({ enabled: v })} label='Toggle GitLab population' />
      </div>

      <div className='mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4'>
        <label className='flex flex-col gap-1'>
          <span className='text-xs font-medium text-muted'>Default issue filter (for newly linked projects)</span>
          <Select
            value={config.defaultFilterMode}
            ariaLabel='Default issue filter'
            className='w-full px-3 py-1.5 text-sm'
            options={[
              { value: 'assigned', label: 'Assigned to me' },
              { value: 'all', label: 'All open' },
              { value: 'label', label: 'By label' },
            ]}
            onChange={(v) => onChange({ defaultFilterMode: v as IssueFilterMode })}
          />
        </label>

        <label className='flex flex-col gap-1'>
          <span className='text-xs font-medium text-muted'>Scout model</span>
          <Select
            value={custom ? '__custom' : config.scoutModel}
            ariaLabel='GitLab scout model'
            className='w-full px-3 py-1.5 text-sm'
            options={[...MODEL_PRESETS, { value: '__custom', label: 'Custom…' }]}
            onChange={(v) => {
              if (v === '__custom') { setCustom(true); return; }
              setCustom(false);
              onChange({ scoutModel: v });
            }}
          />
          {custom && (
            <input
              value={modelText}
              onChange={(e) => setModelText(e.target.value)}
              onBlur={() => onChange({ scoutModel: modelText.trim() })}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              placeholder='claude-…'
              aria-label='Custom scout model id'
              className='px-2 py-1 rounded-lg text-xs bg-control/50 text-body placeholder:text-ghost outline-none focus:bg-control-strong'
            />
          )}
          <span className='text-[11px] text-faint'>A scan is pure extraction — the cheap default is plenty (~$0.11/run).</span>
        </label>
      </div>

      <div className='mt-4 glass-secondary px-4 py-3 flex items-center gap-3 flex-wrap'>
        <GlassToggle
          checked={config.backgroundRefresh}
          onChange={(v) => onChange({ backgroundRefresh: v })}
          size='sm'
          label='Toggle background refresh'
        />
        <div className='flex-1 min-w-0'>
          <p className='text-sm text-strong'>Background refresh</p>
          <p className='text-xs text-muted'>
            Periodically re-scan linked projects to keep the “Review issues” badge fresh. Off by default —
            each scan spends real Claude usage.
          </p>
        </div>
        {config.backgroundRefresh && (
          <label className='flex items-center gap-2 text-xs text-muted'>
            every
            <input
              type='number'
              min={15}
              max={1440}
              value={config.refreshIntervalMinutes}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) onChange({ refreshIntervalMinutes: Math.min(1440, Math.max(15, Math.round(n))) });
              }}
              aria-label='Background refresh interval (minutes)'
              className='w-20 px-2 py-1 rounded-lg text-xs bg-control/50 text-body outline-none focus:bg-control-strong'
            />
            min
          </label>
        )}
      </div>
    </section>
  );
};
